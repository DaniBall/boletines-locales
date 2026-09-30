/**
 * Colector genérico de RSS y Atom. Es el que alimenta «Te afecta» en todas las
 * ciudades: cada una declara sus feeds en su config y el motor no conoce
 * ninguno (regla 8).
 *
 * Solo se queda con lo que necesita el pipeline: titular, enlace, fecha y un
 * resumen corto en texto plano. El resumen es de la fuente y solo viaja al
 * prompt; nunca se publica tal cual (regla 4).
 */
import { makeItemId } from '../lib/items.ts';
import type { Collector, Item } from '../types.ts';
import {
  crearParser,
  fechaIso,
  limpiarHtml,
  pasaFiltroDeRuta,
  texto,
  type Nodo,
  type PathFilter,
} from './comun.ts';

export interface RssCollectorOptions extends PathFilter {
  /** Como se cita en la edición: 'Hora Jaén'. */
  name?: string;
  /** Portada del medio, para la lista de fuentes. */
  homepage?: string;
  /** 'rss-diario-jaen'. Es también el `source` de sus items. */
  id: string;
  url: string;
  /** Id de la sección de la ciudad, normalmente 'te_afecta'. */
  section: string;
  /** Entradas que se leen del feed, de las más recientes. */
  limit?: number;
}

const DEFAULT_LIMIT = 20;
/** Lo justo para que Claude entienda de qué va, sin pagar párrafos enteros. */
const MAX_SUMMARY_CHARS = 400;

export function rssCollector(options: RssCollectorOptions): Collector {
  return {
    id: options.id,
    section: options.section,
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.homepage === undefined ? {} : { homepage: options.homepage }),
    async collect(ctx) {
      const { body } = await ctx.http.get(options.url);
      return parseFeed(body, options);
    },
  };
}

const parser = crearParser(['item', 'entry', 'link', 'category']);

/** De un feed RSS 2.0 o Atom a items del pipeline. */
export function parseFeed(xml: string, source: Omit<RssCollectorOptions, 'url'>): Item[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const limit = source.limit ?? DEFAULT_LIMIT;

  const entradas = entradasDe(doc);
  const items: Item[] = [];

  for (const entrada of entradas) {
    if (items.length >= limit) break;

    const title = limpiarHtml(texto(entrada.title));
    if (title === '') continue;

    const url = enlaceDe(entrada);
    // El tope cuenta después del filtro: diez noticias de la capital, no diez
    // entradas de las que luego sobreviven tres.
    if (!pasaFiltroDeRuta(url, source)) continue;

    const item: Item = {
      id: makeItemId(source.id, url ?? title),
      source: source.id,
      section: source.section,
      title,
    };

    const summary = resumen(entrada);
    if (summary !== '') item.summary = summary;
    if (url !== undefined) item.url = url;

    const publishedAt = fechaDe(entrada);
    if (publishedAt !== undefined) item.publishedAt = publishedAt;

    items.push(item);
  }

  return items;
}

function entradasDe(doc: Record<string, unknown>): Nodo[] {
  const rss = doc.rss as Nodo | undefined;
  const channel = rss?.channel as Nodo | undefined;
  if (Array.isArray(channel?.item)) return channel.item as Nodo[];

  const feed = doc.feed as Nodo | undefined;
  if (Array.isArray(feed?.entry)) return feed.entry as Nodo[];

  return [];
}

/**
 * RSS pone el enlace como texto; Atom, como atributo, y puede traer varios:
 * vale el `alternate` o el que no dice `rel`. Si no hay, el `guid` cuando es
 * un enlace permanente.
 */
function enlaceDe(entrada: Nodo): string | undefined {
  const enlaces = Array.isArray(entrada.link) ? (entrada.link as unknown[]) : [];

  for (const enlace of enlaces) {
    if (typeof enlace === 'string' && esUrl(enlace)) return enlace.trim();
  }
  for (const enlace of enlaces) {
    if (enlace === null || typeof enlace !== 'object') continue;
    const nodo = enlace as Nodo;
    const rel = typeof nodo['@_rel'] === 'string' ? nodo['@_rel'] : 'alternate';
    const href = nodo['@_href'];
    if (rel === 'alternate' && typeof href === 'string' && esUrl(href)) return href.trim();
  }

  const guid = entrada.guid;
  const permanente =
    guid === null || typeof guid !== 'object' || (guid as Nodo)['@_isPermaLink'] !== 'false';
  const valorGuid = texto(guid);
  if (permanente && esUrl(valorGuid)) return valorGuid.trim();

  return undefined;
}

function esUrl(valor: string): boolean {
  return /^https?:\/\//i.test(valor.trim());
}

/** RSS usa RFC 2822; Atom y `dc:date`, ISO 8601. Se devuelve siempre ISO. */
function fechaDe(entrada: Nodo): string | undefined {
  const candidatas = [entrada.pubDate, entrada.date, entrada.published, entrada.updated];
  for (const candidata of candidatas) {
    const fecha = fechaIso(texto(candidata));
    if (fecha !== undefined) return fecha;
  }
  return undefined;
}

/** El resumen más corto que haya, en texto plano y recortado. */
function resumen(entrada: Nodo): string {
  const candidatas = [entrada.description, entrada.summary, entrada.encoded, entrada.content];
  for (const candidata of candidatas) {
    const limpio = limpiarHtml(texto(candidata));
    if (limpio !== '') return recortar(limpio, MAX_SUMMARY_CHARS);
  }
  return '';
}

/** Corta por una palabra entera, nunca a mitad. */
function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}
