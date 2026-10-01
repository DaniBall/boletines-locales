/**
 * Colector del tiempo: la predicción diaria por municipio de AEMET OpenData.
 *
 * AEMET responde en dos pasos: la primera petición devuelve un sobre con la URL
 * de los datos en `datos`, y la segunda trae la predicción, a veces en
 * ISO-8859-15 (el cliente HTTP ya decodifica bien los acentos).
 *
 * Es una sección determinista (regla 1): el colector deja las cifras en `data`
 * y la plantilla de `render/tiempo.ts` escribe el texto, con «Fuente: AEMET».
 *
 * La clave va en la cabecera `api_key`, nunca en la URL, para que no acabe en
 * la caché ni en los mensajes de error.
 */
import { z } from 'zod';
import { toIsoDate } from '../lib/fechas.ts';
import { HttpError, type HttpClient, type RequestOptions } from '../lib/http.ts';
import { makeItemId } from '../lib/items.ts';
import type { Collector, Item } from '../types.ts';

export const AEMET_API = 'https://opendata.aemet.es/opendata/api';

export interface AemetCollectorOptions {
  id?: string;
  section?: string;
  /** Por defecto, `AEMET_API_KEY` del entorno, leída en cada ejecución. */
  apiKey?: string;
}

/** Lo que el colector deja en `data`. */
export interface WeatherData {
  /** AAAA-MM-DD del día de la predicción. */
  fecha: string;
  maxima: number;
  minima: number;
  /** «Poco nuboso», tal y como lo escribe AEMET. */
  cielo?: string;
  /** Probabilidad de precipitación, en %. */
  lluvia?: number;
  /** Viento medio; `direccion` es 'N', 'NE'… o 'C' (calma). */
  viento?: { direccion: string; velocidad: number };
  /** Racha máxima, en km/h. */
  racha?: number;
  uv?: number;
  /** Cuándo elaboró AEMET la predicción. */
  elaborado?: string;
}

export function aemetCollector(options: AemetCollectorOptions = {}): Collector {
  const id = options.id ?? 'aemet';
  const section = options.section ?? 'tiempo';
  return {
    id,
    section,
    name: 'AEMET',
    homepage: 'https://www.aemet.es/',
    async collect(ctx) {
      const apiKey = options.apiKey ?? process.env.AEMET_API_KEY;
      if (apiKey === undefined || apiKey === '') {
        throw new Error('Falta AEMET_API_KEY en el entorno.');
      }
      const headers = { api_key: apiKey };

      const sobre = parseEnvelope(
        await pedir(
          ctx.http,
          `${AEMET_API}/prediccion/especifica/municipio/diaria/${encodeURIComponent(ctx.city.aemetMunicipality)}`,
          { headers },
        ),
      );
      const prediccion = await pedir(ctx.http, sobre, { headers });
      return [parseDailyForecast(prediccion, ctx.date, { id, section })];
    },
  };
}

/**
 * AEMET limita las peticiones por minuto y no manda `Retry-After`: con una
 * ejecución diaria no debería pasar, y si pasa, que el aviso lo diga claro.
 */
async function pedir(http: HttpClient, url: string, options: RequestOptions): Promise<unknown> {
  try {
    return await http.getJson<unknown>(url, options);
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) {
      throw new Error(
        'AEMET: se ha alcanzado el límite de peticiones por minuto. Vuelve a intentarlo en un minuto.',
        { cause: error },
      );
    }
    throw error;
  }
}

const sobreSchema = z.object({
  descripcion: z.string().optional(),
  estado: z.number(),
  datos: z.string().optional(),
});

/** Primer paso: la URL de los datos, o un error claro con lo que dice AEMET. */
export function parseEnvelope(respuesta: unknown): string {
  const sobre = sobreSchema.parse(respuesta);
  if (sobre.estado !== 200 || sobre.datos === undefined) {
    throw new Error(
      `AEMET respondió ${String(sobre.estado)}: ${sobre.descripcion ?? 'sin descripción'}.`,
    );
  }
  return sobre.datos;
}

/** AEMET deja cadenas vacías donde no hay dato: se leen como «sin dato». */
const numero = z.union([z.number(), z.string()]).transform((valor) => {
  if (typeof valor === 'number') return valor;
  const leido = Number.parseFloat(valor.replace(',', '.'));
  return Number.isFinite(leido) ? leido : undefined;
});

const periodo = z.string().optional();

const diaSchema = z.object({
  fecha: z.string(),
  probPrecipitacion: z.array(z.object({ value: numero, periodo })).default([]),
  estadoCielo: z
    .array(z.object({ value: z.string().optional(), periodo, descripcion: z.string().optional() }))
    .default([]),
  viento: z
    .array(z.object({ direccion: z.string().optional(), velocidad: numero, periodo }))
    .default([]),
  rachaMax: z.array(z.object({ value: numero, periodo })).default([]),
  temperatura: z.object({ maxima: numero, minima: numero }),
  uvMax: numero.optional(),
});

const prediccionSchema = z
  .array(
    z.object({
      elaborado: z.string().optional(),
      prediccion: z.object({ dia: z.array(diaSchema) }),
    }),
  )
  .min(1);

/** Para el cielo: el tramo que resume el día; si no está, el primero que tenga dato. */
const TRAMOS_PREFERIDOS = ['00-24', '12-24', '06-12', '12-18'];

function delDia<T extends { periodo?: string | undefined }>(
  entradas: readonly T[],
  tieneDato: (entrada: T) => boolean,
): T | undefined {
  for (const tramo of TRAMOS_PREFERIDOS) {
    const entrada = entradas.find((e) => e.periodo === tramo && tieneDato(e));
    if (entrada !== undefined) return entrada;
  }
  return entradas.find(tieneDato);
}

/**
 * Para lluvia, viento y rachas: la entrada con el valor más alto de todos los
 * tramos. En el día en curso, AEMET deja a 0 o vacíos los tramos que ya han
 * empezado (`00-24`, `00-12`) y el dato bueno está en los de seis horas; en los
 * demás días, el `00-24` resume bien el día. El máximo sirve para los dos casos.
 */
function maximo<T>(
  entradas: readonly T[],
  valor: (entrada: T) => number | undefined,
): T | undefined {
  return entradas.reduce<T | undefined>((mejor, e) => {
    const v = valor(e);
    if (v === undefined) return mejor;
    return mejor === undefined || v > (valor(mejor) ?? -Infinity) ? e : mejor;
  }, undefined);
}

export function parseDailyForecast(
  respuesta: unknown,
  date: string,
  options: { id: string; section: string },
): Item {
  const [municipio] = prediccionSchema.parse(respuesta);
  if (municipio === undefined) throw new Error('AEMET no devolvió ninguna predicción.');

  const dia = municipio.prediccion.dia.find((d) => toIsoDate(d.fecha) === date);
  if (dia === undefined) throw new Error(`AEMET no trae la predicción del ${date}.`);

  const { maxima, minima } = dia.temperatura;
  if (maxima === undefined || minima === undefined) {
    throw new Error(`AEMET no trae las temperaturas del ${date}.`);
  }

  const data: WeatherData = { fecha: date, maxima, minima };

  const cielo = delDia(dia.estadoCielo, (e) => (e.descripcion ?? '').trim() !== '');
  if (cielo?.descripcion !== undefined) data.cielo = cielo.descripcion.trim();

  const lluvia = maximo(dia.probPrecipitacion, (e) => e.value)?.value;
  if (lluvia !== undefined) data.lluvia = lluvia;

  const viento = maximo(dia.viento, (e) => e.velocidad);
  if (viento?.velocidad !== undefined) {
    data.viento = { direccion: (viento.direccion ?? '').trim(), velocidad: viento.velocidad };
  }

  const racha = maximo(dia.rachaMax, (e) => e.value)?.value;
  if (racha !== undefined) data.racha = racha;

  if (dia.uvMax !== undefined) data.uv = dia.uvMax;
  if (municipio.elaborado !== undefined) data.elaborado = municipio.elaborado;

  return {
    id: makeItemId(options.id, date),
    source: options.id,
    section: options.section,
    title: `El tiempo del ${date}`,
    data: { ...data },
  };
}
