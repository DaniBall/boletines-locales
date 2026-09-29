/**
 * Colector genérico de RSS y Atom. Es el que alimenta «Te afecta» en todas las
 * ciudades: cada una declara sus feeds en su config y el motor no conoce
 * ninguno (regla 8).
 *
 * Solo se queda con lo que necesita el pipeline: titular, enlace, fecha y un
 * resumen corto en texto plano. El resumen es de la fuente y solo viaja al
 * prompt; nunca se publica tal cual (regla 4).
 */
import { load } from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { DateTime } from 'luxon';
import { makeItemId } from '../lib/items.ts';
import type { Collector, Item } from '../types.ts';

export interface RssCollectorOptions {
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
    async collect(ctx) {
      const { body } = await ctx.http.get(options.url);
      return parseFeed(body, options);
    },
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // dc:date → date, content:encoded → encoded. Las etiquetas que importan no
  // chocan entre sí al quitar el prefijo.
  removeNSPrefix: true,
  htmlEntities: true,
  // Todo como texto: un titular «2026» no debe convertirse en número.
  parseTagValue: false,
  trimValues: true,
  isArray: (tagName) => ['item', 'entry', 'link', 'category'].includes(tagName),
});

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

type Nodo = Record<string, unknown>;

function entradasDe(doc: Record<string, unknown>): Nodo[] {
  const rss = doc.rss as Nodo | undefined;
  const channel = rss?.channel as Nodo | undefined;
  if (Array.isArray(channel?.item)) return channel.item as Nodo[];

  const feed = doc.feed as Nodo | undefined;
  if (Array.isArray(feed?.entry)) return feed.entry as Nodo[];

  return [];
}

/** El texto de un nodo, venga como cadena o como objeto con atributos. */
function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number') return String(valor);
  if (valor !== null && typeof valor === 'object' && '#text' in valor) {
    return texto((valor as Nodo)['#text']);
  }
  return '';
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
    const valor = texto(candidata).trim();
    if (valor === '') continue;

    const rfc = DateTime.fromRFC2822(valor, { setZone: true });
    if (rfc.isValid) return rfc.toISO() ?? undefined;

    const iso = DateTime.fromISO(valor, { setZone: true });
    if (iso.isValid) return iso.toISO() ?? undefined;
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

/** Muchos feeds meten HTML (y entidades) en la descripción y hasta en el título. */
function limpiarHtml(html: string): string {
  if (html.trim() === '') return '';
  return load(html, null, false).text().replace(/\s+/g, ' ').trim();
}

/** Corta por una palabra entera, nunca a mitad. */
function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}
