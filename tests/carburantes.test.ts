import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FUEL_API,
  fuelCollector,
  parseFuelPrices,
  parsePrecio,
  type FuelData,
} from '../pipeline/collectors/carburantes.ts';
import type { HttpClient } from '../pipeline/lib/http.ts';
import { renderFuelLines } from '../pipeline/render/carburantes.ts';
import type { CityConfig, Item } from '../pipeline/types.ts';

/**
 * La fixture tiene exactamente las 41 claves de la respuesta real de la API,
 * pero las estaciones son inventadas (regla 4).
 */
const fixture = path.resolve(import.meta.dirname, 'fixtures', 'carburantes', 'municipio.json');
const leer = async (): Promise<unknown> => JSON.parse(await readFile(fixture, 'utf8')) as unknown;
const opciones = { id: 'carburantes', section: 'carburantes' };

function datosDe(items: Item[], producto: string): FuelData {
  const item = items.find((i) => (i.data as FuelData | undefined)?.producto === producto);
  if (!item) throw new Error(`No hay ${producto}.`);
  return item.data as unknown as FuelData;
}

describe('parsePrecio', () => {
  it('lee la coma decimal del Ministerio', () => {
    expect(parsePrecio('1,879')).toBe(1.879);
  });

  it('trata como sin precio lo vacío, el cero y lo ilegible', () => {
    expect(parsePrecio('')).toBeUndefined();
    expect(parsePrecio('0,000')).toBeUndefined();
    expect(parsePrecio('n/d')).toBeUndefined();
    expect(parsePrecio(undefined)).toBeUndefined();
  });
});

describe('parseFuelPrices', () => {
  it('saca un item por producto, con el precio mínimo', async () => {
    const items = parseFuelPrices(await leer(), opciones);

    expect(items.map((i) => i.title)).toEqual([
      'Gasóleo A, el más barato',
      'Gasolina 95, el más barato',
    ]);
    expect(datosDe(items, 'Gasóleo A').precio).toBe(1.879);
    expect(datosDe(items, 'Gasolina 95').precio).toBe(1.855);
  });

  it('deja fuera la venta restringida aunque sea la más barata', async () => {
    const gasoleo = datosDe(parseFuelPrices(await leer(), opciones), 'Gasóleo A');

    // La cooperativa está a 1,799, pero solo vende a sus socios.
    expect(gasoleo.precio).toBe(1.879);
    expect(gasoleo.estaciones.map((e) => e.rotulo)).not.toContain('COOPERATIVA DEL OLIVAR');
  });

  it('nombra todas las empatadas, en orden neutral por rótulo', async () => {
    const gasoleo = datosDe(parseFuelPrices(await leer(), opciones), 'Gasóleo A');

    expect(gasoleo.estaciones.map((e) => `${e.rotulo} · ${e.direccion}`)).toEqual([
      'BAJOCOSTE · CALLE FICTICIA 2',
      'BAJOCOSTE · POLÍGONO SIMULADO 4',
      'ECOPRECIO · RONDA DE PRUEBA 3',
    ]);
  });

  it('ignora a quien no vende ese producto', async () => {
    const gasolina = datosDe(parseFuelPrices(await leer(), opciones), 'Gasolina 95');

    expect(gasolina.estaciones.map((e) => e.rotulo)).toEqual(['BAJOCOSTE', 'BAJOCOSTE']);
  });

  it('guarda la hora de los precios en hora de Madrid', async () => {
    const gasoleo = datosDe(parseFuelPrices(await leer(), opciones), 'Gasóleo A');

    expect(gasoleo.actualizado).toBe('2026-09-30T06:15:02.000+02:00');
  });

  it('da ids estables, uno por producto', async () => {
    const primera = parseFuelPrices(await leer(), opciones).map((i) => i.id);
    const segunda = parseFuelPrices(await leer(), opciones).map((i) => i.id);

    expect(primera).toEqual(segunda);
    expect(new Set(primera).size).toBe(2);
  });

  it('falla con un mensaje claro si el Ministerio no dice OK', () => {
    expect(() =>
      parseFuelPrices({ Fecha: '', ResultadoConsulta: 'ERROR', ListaEESSPrecio: [] }, opciones),
    ).toThrow(/respondió «ERROR»/);
  });

  it('falla si la respuesta no tiene la forma esperada, en vez de publicar basura', () => {
    expect(() => parseFuelPrices({ inesperado: true }, opciones)).toThrow();
  });
});

describe('fuelCollector', () => {
  const ciudad = (fuelMunicipalityId?: string) =>
    (fuelMunicipalityId === undefined ? {} : { fuelMunicipalityId }) as CityConfig;

  it('pide el municipio de la ciudad a la API del Ministerio', async () => {
    const respuesta = await leer();
    const pedidas: string[] = [];
    const http = {
      getJson: (url: string) => {
        pedidas.push(url);
        return Promise.resolve(respuesta);
      },
    } as unknown as HttpClient;

    const items = await fuelCollector().collect({ city: ciudad('3543'), date: '2026-09-30', http });

    expect(pedidas).toEqual([`${FUEL_API}/EstacionesTerrestres/FiltroMunicipio/3543`]);
    expect(items).toHaveLength(2);
  });

  it('no pide nada si la ciudad no tiene municipio configurado', async () => {
    const http = {
      getJson: () => Promise.reject(new Error('No debería llamarse.')),
    } as unknown as HttpClient;

    await expect(
      fuelCollector().collect({ city: ciudad(), date: '2026-09-30', http }),
    ).resolves.toEqual([]);
  });
});

describe('renderFuelLines', () => {
  it('escribe la sección con los empates contados y sin repetir marca', async () => {
    const lineas = renderFuelLines(parseFuelPrices(await leer(), opciones));

    expect(lineas).toEqual([
      '- **Gasóleo A**: 1,879 € en 3 gasolineras: BAJOCOSTE y ECOPRECIO',
      '- **Gasolina 95**: 1,855 € en 2 gasolineras: BAJOCOSTE',
      '_Precios oficiales del Ministerio, a las 06:15._',
    ]);
  });

  it('da la dirección cuando la más barata es una sola', () => {
    const item: Item = {
      id: 'x',
      source: 'carburantes',
      section: 'carburantes',
      title: 'Gasóleo A, el más barato',
      data: {
        producto: 'Gasóleo A',
        precio: 1.9,
        estaciones: [{ rotulo: 'SURTIDOR', direccion: 'AVENIDA 1', horario: '24H' }],
      },
    };

    expect(renderFuelLines([item])).toEqual(['- **Gasóleo A**: 1,900 € en SURTIDOR (AVENIDA 1)']);
  });

  it('resume con «y N más» cuando hay muchas marcas empatadas', () => {
    const estaciones = ['A', 'B', 'C', 'D', 'E'].map((rotulo) => ({
      rotulo,
      direccion: `CALLE ${rotulo}`,
      horario: '',
    }));
    const item: Item = {
      id: 'x',
      source: 'carburantes',
      section: 'carburantes',
      title: 't',
      data: { producto: 'Gasóleo A', precio: 1.8, estaciones },
    };

    expect(renderFuelLines([item])[0]).toBe(
      '- **Gasóleo A**: 1,800 € en 5 gasolineras: A, B, C y 2 marcas más',
    );
  });

  it('dice «otra marca» cuando solo queda una por nombrar', () => {
    const estaciones = ['A', 'B', 'C', 'D'].map((rotulo) => ({
      rotulo,
      direccion: '',
      horario: '',
    }));
    const item: Item = {
      id: 'x',
      source: 'carburantes',
      section: 'carburantes',
      title: 't',
      data: { producto: 'Gasóleo A', precio: 1.8, estaciones },
    };

    expect(renderFuelLines([item])[0]).toBe(
      '- **Gasóleo A**: 1,800 € en 4 gasolineras: A, B, C y otra marca',
    );
  });

  it('no escribe nada si no hay datos: la sección se omite', () => {
    expect(renderFuelLines([])).toEqual([]);
  });
});
