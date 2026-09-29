/**
 * Piezas que comparten los colectores de feeds: leer XML, limpiar el HTML que
 * los medios meten en títulos y resúmenes, normalizar fechas y filtrar por la
 * sección que indica la ruta de la URL.
 */
import { load } from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { DateTime } from 'luxon';

export type Nodo = Record<string, unknown>;

/** Parser común: todo como texto y sin prefijos de espacio de nombres. */
export function crearParser(arrays: readonly string[]): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // dc:date → date, news:title → title. Las etiquetas que importan no chocan
    // entre sí al quitar el prefijo.
    removeNSPrefix: true,
    htmlEntities: true,
    // Un titular «2026» no debe convertirse en número.
    parseTagValue: false,
    trimValues: true,
    isArray: (tagName) => arrays.includes(tagName),
  });
}

/** El texto de un nodo, venga como cadena o como objeto con atributos. */
export function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number') return String(valor);
  if (valor !== null && typeof valor === 'object' && '#text' in valor) {
    return texto((valor as Nodo)['#text']);
  }
  return '';
}

/** Muchos medios meten HTML (y entidades) en la descripción y hasta en el título. */
export function limpiarHtml(html: string): string {
  if (html.trim() === '') return '';
  return load(html, null, false).text().replace(/\s+/g, ' ').trim();
}

/** RFC 2822 (RSS) o ISO 8601 (Atom, sitemaps), siempre de vuelta en ISO. */
export function fechaIso(valor: string): string | undefined {
  const limpio = valor.trim();
  if (limpio === '') return undefined;

  const rfc = DateTime.fromRFC2822(limpio, { setZone: true });
  if (rfc.isValid) return rfc.toISO() ?? undefined;

  const iso = DateTime.fromISO(limpio, { setZone: true });
  if (iso.isValid) return iso.toISO() ?? undefined;

  return undefined;
}

/**
 * Filtro por sección. Los medios dicen de qué va cada artículo en la ruta
 * (`/jaen/jaen/…` es la capital, `/opinion/…` es opinión), y es la señal más
 * fiable que dan: sus feeds no traen categorías.
 */
export interface PathFilter {
  /** Si se da, la ruta tiene que empezar por alguno de estos prefijos. */
  includePaths?: readonly string[];
  /** Rutas que se descartan siempre, aunque casen con `includePaths`. */
  excludePaths?: readonly string[];
}

export function pasaFiltroDeRuta(url: string | undefined, filtro: PathFilter): boolean {
  const incluir = filtro.includePaths ?? [];
  const excluir = filtro.excludePaths ?? [];
  if (incluir.length === 0 && excluir.length === 0) return true;

  // Sin URL no hay ruta que mirar: con un filtro puesto, no se puede dar por buena.
  if (url === undefined) return false;
  let ruta: string;
  try {
    ruta = new URL(url).pathname;
  } catch {
    return false;
  }

  if (excluir.some((prefijo) => ruta.startsWith(prefijo))) return false;
  return incluir.length === 0 || incluir.some((prefijo) => ruta.startsWith(prefijo));
}
