/**
 * `render`: monta el Markdown de la edición, la fuente de verdad que luego se
 * publica en la web y se copia a WhatsApp.
 *
 * Las secciones deterministas las escribe su plantilla (regla 1). Las de texto
 * salen del borrador de Claude y, si no lo hay, de los titulares recogidos tal
 * cual, con un aviso: sirven para revisar, no para publicar (regla 4).
 */
import { greetingDate, type IsoDate } from '../lib/fechas.ts';
import { renderFuelLines } from '../render/carburantes.ts';
import type { CityConfig, Draft, EditionFrontmatter, Item, SectionDef } from '../types.ts';

/** Plantillas de las secciones deterministas, por id de sección. */
export type SectionRenderer = (items: readonly Item[]) => string[];

export const DEFAULT_RENDERERS: Readonly<Record<string, SectionRenderer>> = {
  carburantes: renderFuelLines,
};

export interface RenderInput {
  city: CityConfig;
  date: IsoDate;
  numero: number;
  /** Lo que salió de `select`, en el orden de la edición. */
  items: readonly Item[];
  /** El borrador de Claude, ya validado y limpio. Sin él, modo sin IA. */
  draft?: Draft;
  /** Avisos para el frontmatter: fuentes caídas, validador, secciones sin redactar. */
  avisos?: readonly string[];
  /** Nombre y portada de cada fuente, por id de colector. */
  sources?: ReadonlyMap<string, { name: string; homepage?: string }>;
  renderers?: Readonly<Record<string, SectionRenderer>>;
}

export interface RenderResult {
  frontmatter: EditionFrontmatter;
  body: string;
  /** Secciones de texto que salen sin redactar, con los titulares de la fuente. */
  sinRedactar: string[];
}

const CIERRE = '¿Sabes algo que deberíamos contar? Escríbenos y lo miramos para mañana.';

export function renderEdition(input: RenderInput): RenderResult {
  const renderers = input.renderers ?? DEFAULT_RENDERERS;
  const porId = new Map(input.items.map((item) => [item.id, item]));
  const bloques: string[] = [];
  const sinRedactar: string[] = [];

  const titular = input.draft?.titular.trim();
  bloques.push(
    `¡Buenos días, ${input.city.name}! ${greetingDate(input.date)}, edición nº ${String(input.numero)}.` +
      (titular ? ` ${titular}` : ''),
  );

  for (const seccion of input.city.sections) {
    const items = input.items.filter((item) => item.section === seccion.id);
    const lineas = lineasDeSeccion(seccion, items, input.draft, porId, renderers);
    if (lineas === undefined) continue;
    if (lineas.sinRedactar) sinRedactar.push(seccion.title);
    bloques.push(`## ${seccion.title}\n\n${lineas.texto.join('\n')}`);
  }

  bloques.push(`---\n\n${CIERRE}`);

  const avisos = [...(input.avisos ?? [])];
  if (sinRedactar.length > 0) {
    avisos.unshift(
      `Sin redactar: ${sinRedactar.join(', ')}. Llevan los titulares de las fuentes tal cual y hay que reescribirlos antes de aprobar (regla 4).`,
    );
  }

  return {
    frontmatter: {
      ciudad: input.city.id,
      fecha: input.date,
      numero: input.numero,
      estado: 'borrador',
      fuentes: fuentesUsadas(input.items, input.sources),
      ...(avisos.length > 0 ? { avisos } : {}),
    },
    body: bloques.join('\n\n'),
    sinRedactar,
  };
}

function lineasDeSeccion(
  seccion: SectionDef,
  items: readonly Item[],
  draft: Draft | undefined,
  porId: ReadonlyMap<string, Item>,
  renderers: Readonly<Record<string, SectionRenderer>>,
): { texto: string[]; sinRedactar: boolean } | undefined {
  if (seccion.writer === 'code') {
    const renderer = renderers[seccion.id];
    const texto = renderer === undefined ? [] : renderer(items);
    // Sin plantilla o sin datos, la sección se omite: nunca «sin información».
    return texto.length === 0 ? undefined : { texto, sinRedactar: false };
  }

  const entradas = draft?.secciones[seccion.id];
  if (draft !== undefined) {
    if (entradas === undefined || entradas.length === 0) return undefined;
    const texto = entradas.map((entrada) => {
      const item = porId.get(entrada.item_id);
      return `- **${entrada.titulo.trim()}**: ${entrada.texto.trim()}${enlace(item)}`;
    });
    return { texto, sinRedactar: false };
  }

  if (items.length === 0) return undefined;
  return {
    texto: items.map((item) => `- **${item.title}**${enlace(item)}`),
    sinRedactar: true,
  };
}

/** El enlace lo pone siempre el código, desde el item: nunca la IA (regla 2). */
function enlace(item: Item | undefined): string {
  if (item?.url === undefined) return '';
  const etiqueta = item.startsAt === undefined ? 'Fuente' : 'Más info';
  return ` [${etiqueta}](${item.url})`;
}

function fuentesUsadas(
  items: readonly Item[],
  sources: ReadonlyMap<string, { name: string; homepage?: string }> | undefined,
): EditionFrontmatter['fuentes'] {
  const vistas = new Map<string, EditionFrontmatter['fuentes'][number]>();
  for (const item of items) {
    const fuente = sources?.get(item.source);
    const nombre = fuente?.name ?? item.source;
    // Dos colectores de la misma fuente (noticias y agenda) salen una vez.
    if ([...vistas.values()].some((vista) => vista.nombre === nombre)) continue;
    vistas.set(item.source, {
      id: item.source,
      nombre,
      ...(fuente?.homepage === undefined ? {} : { url: fuente.homepage }),
    });
  }
  return [...vistas.values()];
}
