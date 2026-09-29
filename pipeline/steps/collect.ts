/**
 * `collect`: lanza todos los colectores de una ciudad en paralelo y aísla sus
 * fallos (regla 5). Una fuente caída no tumba la edición: su sección se queda
 * sin sus items y el fallo aparece en la tabla de salud, que va al PR.
 */
import { inSeason, type IsoDate } from '../lib/fechas.ts';
import type { HttpClient } from '../lib/http.ts';
import type { CityConfig, Collector, Item } from '../types.ts';

export type SourceStatus = 'ok' | 'vacia' | 'error' | 'fuera-de-temporada';

export interface SourceHealth {
  id: string;
  section: string;
  status: SourceStatus;
  items: number;
  /** Lo que tardó, en milisegundos. */
  ms: number;
  error?: string;
}

export interface CollectResult {
  /** En el orden de los colectores de la ciudad: el dedupe se queda con el primero. */
  items: Item[];
  health: SourceHealth[];
}

export interface CollectOptions {
  /**
   * Tope por colector. El cliente HTTP ya corta cada petición, pero un colector
   * puede hacer varias: esto garantiza que ninguno retrasa la edición.
   */
  collectorTimeoutMs?: number;
  /** Solo para los tests. */
  now?: () => number;
}

const DEFAULT_COLLECTOR_TIMEOUT_MS = 60_000;

export async function collect(
  city: CityConfig,
  date: IsoDate,
  http: HttpClient,
  options: CollectOptions = {},
): Promise<CollectResult> {
  const timeoutMs = options.collectorTimeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS;
  const now = options.now ?? (() => performance.now());
  const secciones = new Map(city.sections.map((seccion) => [seccion.id, seccion]));

  // Cada colector captura su propio fallo, así que ninguna promesa rechaza: es
  // el `Promise.allSettled` de la regla 5, con la salud ya calculada.
  const resultados = await Promise.all(
    city.collectors.map(async (collector): Promise<{ health: SourceHealth; items: Item[] }> => {
      // Una sección de temporada fuera de su tramo no se pide: es una petición
      // a una fuente ajena que no sirve para nada (regla 6).
      const season = secciones.get(collector.section)?.season;
      if (season && !inSeason(date, season)) {
        return { health: salud(collector, 'fuera-de-temporada', 0, 0), items: [] };
      }

      const inicio = now();
      try {
        const items = await conTope(
          collector.collect({ city, date, http }),
          timeoutMs,
          collector.id,
        );
        const ms = Math.round(now() - inicio);
        return {
          health: salud(collector, items.length === 0 ? 'vacia' : 'ok', items.length, ms),
          items,
        };
      } catch (error) {
        const ms = Math.round(now() - inicio);
        return {
          health: {
            ...salud(collector, 'error', 0, ms),
            error: error instanceof Error ? error.message : String(error),
          },
          items: [],
        };
      }
    }),
  );

  return {
    items: resultados.flatMap((resultado) => resultado.items),
    health: resultados.map((resultado) => resultado.health),
  };
}

function salud(
  collector: Collector,
  status: SourceStatus,
  items: number,
  ms: number,
): SourceHealth {
  return { id: collector.id, section: collector.section, status, items, ms };
}

/** Rechaza si el colector no acaba a tiempo; nunca deja la ejecución colgada. */
async function conTope<T>(promesa: Promise<T>, ms: number, id: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${id} no terminó en ${String(ms)} ms.`));
    }, ms);
  });
  try {
    return await Promise.race([promesa, tope]);
  } finally {
    clearTimeout(timer);
  }
}

const ICONOS: Record<SourceStatus, string> = {
  ok: '✅',
  vacia: '⚠️',
  error: '❌',
  'fuera-de-temporada': '⏸️',
};

const ETIQUETAS: Record<SourceStatus, string> = {
  ok: 'bien',
  vacia: 'sin items',
  error: 'error',
  'fuera-de-temporada': 'fuera de temporada',
};

/** La tabla de salud de las fuentes, en Markdown: para el PR y para la terminal. */
export function formatHealthTable(health: readonly SourceHealth[]): string {
  const filas = health.map((fuente) => {
    const estado = `${ICONOS[fuente.status]} ${ETIQUETAS[fuente.status]}`;
    const detalle = fuente.error === undefined ? '' : ` — ${fuente.error.replace(/\|/g, '/')}`;
    return `| ${fuente.id} | ${fuente.section} | ${estado}${detalle} | ${String(fuente.items)} | ${String(fuente.ms)} ms |`;
  });

  return [
    '| Fuente | Sección | Estado | Items | Tiempo |',
    '|---|---|---|---:|---:|',
    ...filas,
  ].join('\n');
}
