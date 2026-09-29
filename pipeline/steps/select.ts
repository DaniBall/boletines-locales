/**
 * `select`: de todo lo recogido, lo que merece salir hoy en esta ciudad.
 *
 * Es el filtro entre `collect` y `draft`, y por tanto lo que decide qué ve
 * Claude. Cuanto menos llegue y mejor elegido, mejor sale la edición y menos
 * cuesta. Nada se tira en silencio: todo descarte lleva un motivo y se enseña
 * en el PR, para poder ajustar las fuentes viendo qué se queda fuera.
 */
import { limits } from '../config.ts';
import { dedupe, type DedupeOptions } from '../lib/dedupe.ts';
import { inSeason, shiftDate, toIsoDate, type IsoDate } from '../lib/fechas.ts';
import type { CityConfig, Item, SectionDef } from '../types.ts';

export type DiscardReason =
  | 'seccion-desconocida'
  | 'fuera-de-temporada'
  | 'fuera-de-fecha'
  | 'fuera-de-alcance'
  | 'ya-publicado'
  | 'duplicado'
  | 'exceso';

export interface Discarded {
  item: Item;
  reason: DiscardReason;
  /** Una línea para la sección «Avisos» del PR. */
  detail?: string;
}

export interface SelectResult {
  selected: Item[];
  discarded: Discarded[];
}

export interface SelectOptions {
  /** URLs de las ediciones recientes de esta ciudad: no se repiten. */
  publishedUrls?: Iterable<string>;
  /** Días hacia atrás que se aceptan en una noticia. */
  newsWindowDays?: number;
  /** Items por sección que pasan a la redacción. */
  maxPerSection?: number;
  /**
   * Secciones que el viernes miran también al sábado y al domingo. La ciudad
   * declara cuáles son: el motor no conoce ninguna (regla 8).
   */
  weekendSections?: readonly string[];
  /** Si hoy es viernes. Lo decide quien llama, que ya tiene la fecha.  */
  isWeekendEdition?: boolean;
  dedupe?: DedupeOptions;
}

const DEFAULT_NEWS_WINDOW_DAYS = 2;
const DEFAULT_MAX_PER_SECTION = 8;

export function select(
  items: readonly Item[],
  city: CityConfig,
  date: IsoDate,
  options: SelectOptions = {},
): SelectResult {
  const newsWindowDays = options.newsWindowDays ?? DEFAULT_NEWS_WINDOW_DAYS;
  const maxPerSection = options.maxPerSection ?? DEFAULT_MAX_PER_SECTION;
  const weekendSections = new Set(options.weekendSections ?? []);
  const secciones = new Map(city.sections.map((seccion) => [seccion.id, seccion]));

  const discarded: Discarded[] = [];
  const vivos: Item[] = [];

  for (const item of items) {
    const seccion = secciones.get(item.section);
    if (!seccion) {
      discarded.push({
        item,
        reason: 'seccion-desconocida',
        detail: `«${item.section}» no es una sección de ${city.name}.`,
      });
      continue;
    }

    if (seccion.season && !inSeason(date, seccion.season)) {
      discarded.push({ item, reason: 'fuera-de-temporada', detail: tituloSeccion(seccion) });
      continue;
    }

    const ventana = weekendSections.has(seccion.id) && (options.isWeekendEdition ?? false) ? 2 : 0;
    if (!enFecha(item, date, newsWindowDays, ventana)) {
      discarded.push(descarte(item, 'fuera-de-fecha', fechaDelItem(item)));
      continue;
    }

    if (!enAlcance(item, city.scope)) {
      discarded.push(descarte(item, 'fuera-de-alcance', item.place));
      continue;
    }

    vivos.push(item);
  }

  // El deduplicado va después de los filtros baratos: así no compara nada que
  // ya estaba descartado, y el motivo que se enseña es el primero que aplicó.
  const publicadas = new Set<string>();
  for (const url of options.publishedUrls ?? []) publicadas.add(url);

  const { kept, duplicates } = dedupe(vivos, {
    ...options.dedupe,
    seenUrls: publicadas,
  });

  for (const { item, duplicateOf } of duplicates) {
    // Sin pareja en este lote, el duplicado viene de una edición anterior.
    discarded.push(
      duplicateOf
        ? descarte(item, 'duplicado', `Ya entraba como «${duplicateOf.title}».`)
        : descarte(item, 'ya-publicado', item.url),
    );
  }

  const porSeccion = new Map<string, Item[]>();
  for (const item of kept) {
    const lista = porSeccion.get(item.section) ?? [];
    lista.push(item);
    porSeccion.set(item.section, lista);
  }

  const selected: Item[] = [];
  // Se respeta el orden de secciones de la ciudad, que es el de la edición.
  for (const seccion of city.sections) {
    const lista = porSeccion.get(seccion.id) ?? [];
    selected.push(...lista.slice(0, maxPerSection));
    for (const sobrante of lista.slice(maxPerSection)) {
      discarded.push({
        item: sobrante,
        reason: 'exceso',
        detail: `${tituloSeccion(seccion)}: ya había ${String(maxPerSection)}.`,
      });
    }
  }

  return { selected, discarded };
}

/** Arma un descarte sin colar un `detail: undefined`, que el tipo no admite. */
function descarte(item: Item, reason: DiscardReason, detail?: string): Discarded {
  return detail === undefined ? { item, reason } : { item, reason, detail };
}

/**
 * Ventana de fechas. Un evento vale si cae hoy (o dentro del tramo que se
 * mire); una noticia, si se publicó hoy o en los últimos días. Lo que no trae
 * fecha se deja pasar: las secciones deterministas no la necesitan.
 */
function enFecha(item: Item, date: IsoDate, newsWindowDays: number, extraDays: number): boolean {
  const empieza = item.startsAt ? toIsoDate(item.startsAt) : undefined;
  if (empieza !== undefined) {
    const acaba = (item.endsAt ? toIsoDate(item.endsAt) : undefined) ?? empieza;
    const hasta = shiftDate(date, extraDays);
    // Un evento de varios días entra si pisa el tramo que se mira.
    return acaba >= date && empieza <= hasta;
  }

  const publicado = item.publishedAt ? toIsoDate(item.publishedAt) : undefined;
  if (publicado !== undefined) {
    return publicado <= date && publicado >= shiftDate(date, -newsWindowDays);
  }

  return true;
}

/**
 * Alcance. Solo se descarta cuando el item dice dónde pasa y ese sitio no es de
 * aquí: sin `place` no hay forma de saberlo y se deja pasar, porque la mayoría
 * de lo que traen las fuentes locales es local.
 */
function enAlcance(item: Item, scope: readonly string[]): boolean {
  if (item.place === undefined || item.place.trim() === '') return true;
  const lugar = normalizar(item.place);
  return scope.some((municipio) => lugar.includes(normalizar(municipio)));
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function tituloSeccion(seccion: SectionDef): string {
  return seccion.title;
}

function fechaDelItem(item: Item): string | undefined {
  return item.startsAt ?? item.publishedAt;
}

/** Días hacia atrás que mira `select` para no repetir. Lo fija la config. */
export const DEDUPE_WINDOW_DAYS = limits.dedupeWindowDays;
