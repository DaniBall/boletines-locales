import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AEMET_API,
  aemetCollector,
  parseDailyForecast,
  parseEnvelope,
  type WeatherData,
} from '../pipeline/collectors/aemet.ts';
import type { HttpClient, RequestOptions } from '../pipeline/lib/http.ts';
import { renderWeatherLines } from '../pipeline/render/tiempo.ts';
import type { CityConfig, Item } from '../pipeline/types.ts';

/**
 * La fixture sigue la forma de la predicción diaria por municipio de AEMET
 * OpenData, con un municipio y unas cifras inventadas.
 */
const fixture = path.resolve(import.meta.dirname, 'fixtures', 'aemet', 'prediccion.json');
const leer = async (): Promise<unknown> => JSON.parse(await readFile(fixture, 'utf8')) as unknown;
const opciones = { id: 'aemet', section: 'tiempo' };

const datosDe = (item: Item): WeatherData => item.data as unknown as WeatherData;

function tiempo(data: Partial<WeatherData>): Item {
  return {
    id: 'x',
    source: 'aemet',
    section: 'tiempo',
    title: 't',
    data: { fecha: '2026-09-30', maxima: 27, minima: 15, ...data },
  };
}

describe('parseEnvelope', () => {
  it('devuelve la URL de los datos del primer paso', () => {
    expect(
      parseEnvelope({
        descripcion: 'exito',
        estado: 200,
        datos: 'https://opendata.aemet.es/opendata/sh/abc',
        metadatos: 'https://opendata.aemet.es/opendata/sh/def',
      }),
    ).toBe('https://opendata.aemet.es/opendata/sh/abc');
  });

  it('falla con lo que dice AEMET si no hay datos', () => {
    expect(() => parseEnvelope({ descripcion: 'API key invalido', estado: 401 })).toThrow(
      'AEMET respondió 401: API key invalido.',
    );
  });
});

describe('parseDailyForecast', () => {
  it('saca las cifras del día de la edición', async () => {
    const item = parseDailyForecast(await leer(), '2026-09-30', opciones);

    expect(datosDe(item)).toEqual({
      fecha: '2026-09-30',
      maxima: 27,
      minima: 15,
      // El tramo 00-24 viene vacío: se toma el de la tarde.
      cielo: 'Intervalos nubosos con lluvia escasa',
      lluvia: 40,
      viento: { direccion: 'O', velocidad: 25 },
      racha: 45,
      uv: 5,
      elaborado: '2026-09-30T05:42:11',
    });
    expect(item.section).toBe('tiempo');
  });

  it('lee otro día de la misma respuesta y tolera los huecos de AEMET', async () => {
    const item = parseDailyForecast(await leer(), '2026-10-02', opciones);

    expect(datosDe(item)).toEqual({
      fecha: '2026-10-02',
      maxima: 30,
      minima: 16,
      elaborado: '2026-09-30T05:42:11',
    });
  });

  it('falla si la predicción no trae el día, en vez de publicar el de otro', async () => {
    await expect(async () =>
      parseDailyForecast(await leer(), '2026-10-09', opciones),
    ).rejects.toThrow('AEMET no trae la predicción del 2026-10-09.');
  });

  it('da el mismo id para el mismo día', async () => {
    const primera = parseDailyForecast(await leer(), '2026-09-30', opciones);
    const segunda = parseDailyForecast(await leer(), '2026-09-30', opciones);

    expect(primera.id).toBe(segunda.id);
  });
});

describe('aemetCollector', () => {
  const ciudad = { aemetMunicipality: '00000' } as CityConfig;

  it('pide en dos pasos y manda la clave en la cabecera, no en la URL', async () => {
    const prediccion = await leer();
    const pedidas: { url: string; clave: string | undefined }[] = [];
    const http = {
      getJson: (url: string, options?: RequestOptions) => {
        pedidas.push({ url, clave: options?.headers?.api_key });
        return Promise.resolve(
          url.startsWith(AEMET_API)
            ? { descripcion: 'exito', estado: 200, datos: 'https://opendata.aemet.invalid/sh/1' }
            : prediccion,
        );
      },
    } as unknown as HttpClient;

    const items = await aemetCollector({ apiKey: 'clave-de-prueba' }).collect({
      city: ciudad,
      date: '2026-09-30',
      http,
    });

    expect(pedidas).toEqual([
      {
        url: `${AEMET_API}/prediccion/especifica/municipio/diaria/00000`,
        clave: 'clave-de-prueba',
      },
      { url: 'https://opendata.aemet.invalid/sh/1', clave: 'clave-de-prueba' },
    ]);
    expect(items).toHaveLength(1);
  });

  it('sin clave falla con un mensaje claro y no pide nada', async () => {
    const http = {
      getJson: () => Promise.reject(new Error('No debería llamarse.')),
    } as unknown as HttpClient;

    await expect(
      aemetCollector({ apiKey: '' }).collect({ city: ciudad, date: '2026-09-30', http }),
    ).rejects.toThrow('Falta AEMET_API_KEY en el entorno.');
  });
});

describe('renderWeatherLines', () => {
  it('escribe una línea con lo que cambia el día y cita a AEMET', async () => {
    const item = parseDailyForecast(await leer(), '2026-09-30', opciones);

    expect(renderWeatherLines([item])).toEqual([
      'Máxima de 27° y mínima de 15°. Intervalos nubosos con lluvia escasa. Probabilidad de lluvia del 40 %. Viento del oeste a 25 km/h, con rachas de 45 km/h. Fuente: AEMET.',
    ]);
  });

  it('calla la lluvia, el viento y el UV cuando no son noticia', () => {
    expect(
      renderWeatherLines([
        tiempo({ cielo: 'despejado', lluvia: 10, viento: { direccion: 'C', velocidad: 5 }, uv: 6 }),
      ]),
    ).toEqual(['Máxima de 27° y mínima de 15°. Despejado. Fuente: AEMET.']);
  });

  it('avisa de las rachas sin viento medio fuerte y del UV muy alto', () => {
    expect(renderWeatherLines([tiempo({ racha: 52.4, uv: 9 })])).toEqual([
      'Máxima de 27° y mínima de 15°. Rachas de viento de hasta 52 km/h. Índice UV de 9, muy alto: protégete del sol. Fuente: AEMET.',
    ]);
  });

  it('no escribe nada si no hay datos: la sección se omite', () => {
    expect(renderWeatherLines([])).toEqual([]);
  });
});
