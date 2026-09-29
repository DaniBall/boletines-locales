/**
 * Deduplicado: dos fuentes cuentan lo mismo a menudo. Se detecta por dos vías,
 * la URL y el parecido del titular, porque ninguna de las dos basta sola: el
 * mismo enlace aparece con parámetros distintos, y la misma noticia aparece con
 * titulares distintos en dos medios.
 *
 * `urlKey` es identidad, no presentación: normaliza para comparar y su
 * resultado no se publica nunca. Lo que se enseña al lector lo limpia
 * `cleanUrl`, en el render de WhatsApp.
 */

/** Parámetros de seguimiento: no cambian el contenido de la página. */
const SEGUIMIENTO = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|ref$)/i;

/** Palabras que no distinguen un titular de otro. */
const VACIAS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'a',
  'ante',
  'con',
  'contra',
  'en',
  'entre',
  'hacia',
  'hasta',
  'para',
  'por',
  'segun',
  'sin',
  'sobre',
  'tras',
  'y',
  'e',
  'o',
  'u',
  'que',
  'se',
  'su',
  'sus',
  'lo',
  'le',
  'les',
  'es',
  'son',
  'esta',
  'estan',
  'ya',
  'mas',
]);

/** Clave de identidad de una URL: misma página, misma clave. */
export function urlKey(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.trim().toLowerCase();
  }

  parsed.hash = '';
  for (const clave of [...parsed.searchParams.keys()]) {
    if (SEGUIMIENTO.test(clave)) parsed.searchParams.delete(clave);
  }
  parsed.searchParams.sort();

  // http y https son la misma página; el www, también.
  parsed.protocol = 'https:';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

  const ruta = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = ruta === '' ? '/' : ruta;

  return parsed.toString().replace(/\?$/, '');
}

/** Titular reducido a lo que lo distingue: sin acentos, signos ni palabras vacías. */
export function titleKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(title: string): Set<string> {
  return new Set(
    titleKey(title)
      .split(' ')
      .filter((palabra) => palabra !== '' && !VACIAS.has(palabra)),
  );
}

/** Parecido entre dos titulares, de 0 a 1 (Jaccard sobre palabras con contenido). */
export function similarity(a: string, b: string): number {
  const unos = tokens(a);
  const otros = tokens(b);
  if (unos.size === 0 || otros.size === 0) return 0;

  let comunes = 0;
  for (const palabra of unos) if (otros.has(palabra)) comunes += 1;

  return comunes / (unos.size + otros.size - comunes);
}

/** A partir de aquí, dos titulares cuentan lo mismo. */
export const SIMILARITY_THRESHOLD = 0.7;

export interface DedupeOptions {
  threshold?: number;
  /** Claves ya vistas antes del lote, por ejemplo de ediciones anteriores. */
  seenUrls?: Iterable<string>;
}

export interface DedupeEntry<T> {
  item: T;
  /** El elemento que ya ocupaba su sitio, si el duplicado está en este lote. */
  duplicateOf?: T;
}

export interface DedupeResult<T> {
  kept: T[];
  duplicates: DedupeEntry<T>[];
}

/**
 * Se queda con la primera aparición de cada cosa. El orden importa: los
 * colectores van en el orden de la ciudad, así que la fuente primaria gana.
 */
export function dedupe<T extends { title: string; url?: string }>(
  items: readonly T[],
  options: DedupeOptions = {},
): DedupeResult<T> {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  const vistas = new Set<string>();
  for (const url of options.seenUrls ?? []) vistas.add(urlKey(url));

  const kept: T[] = [];
  const duplicates: DedupeEntry<T>[] = [];

  for (const item of items) {
    const clave = item.url ? urlKey(item.url) : undefined;
    if (clave !== undefined && vistas.has(clave)) {
      const anterior = kept.find((otro) => otro.url !== undefined && urlKey(otro.url) === clave);
      duplicates.push(anterior ? { item, duplicateOf: anterior } : { item });
      continue;
    }

    const parecido = kept.find((otro) => similarity(otro.title, item.title) >= threshold);
    if (parecido) {
      duplicates.push({ item, duplicateOf: parecido });
      continue;
    }

    if (clave !== undefined) vistas.add(clave);
    kept.push(item);
  }

  return { kept, duplicates };
}
