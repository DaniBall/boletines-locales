/**
 * La edición de un día, de punta a punta: collect → finde → select → draft →
 * validate → render. Devuelve la edición y un informe para la revisión; no
 * escribe nada, eso lo decide quien llama.
 */
import { editionUrl, publishedUrls } from '../lib/edicion.ts';
import { isFriday, type IsoDate } from '../lib/fechas.ts';
import type { HttpClient } from '../lib/http.ts';
import { renderWhatsapp } from '../render/whatsapp.ts';
import type { CityConfig, Draft, Edition, Item } from '../types.ts';
import { collect, type SourceHealth } from './collect.ts';
import { routeWeekend, type WeekendRoute } from './finde.ts';
import { renderEdition } from './render.ts';
import { select, type Discarded } from './select.ts';
import { dropInvalid, validateDraft, validateWhatsapp, type Issue } from './validate.ts';

/** Redacta con Claude. Sin ella, la edición sale en modo sin IA. */
export type DraftFn = (input: { city: CityConfig; date: IsoDate; items: Item[] }) => Promise<Draft>;

export interface EditionInput {
  city: CityConfig;
  date: IsoDate;
  http: HttpClient;
  numero: number;
  /** Qué sección de agenda pasa a cuál el viernes. */
  weekend?: WeekendRoute;
  draft?: DraftFn;
  /** Por qué no hay `draft`, para los avisos. Por defecto, «Edición generada sin IA.». */
  noDraftReason?: string;
  root?: string;
}

export interface EditionReport {
  health: SourceHealth[];
  discarded: Discarded[];
  errors: Issue[];
  warnings: Issue[];
  /** El texto de WhatsApp, tal cual saldría. */
  whatsapp: string;
  sinRedactar: string[];
  /** Lo que Claude decidió no contar, y por qué. */
  descartesIa: Draft['descartes'];
  /** Por qué no hubo redacción con Claude, si no la hubo. */
  sinIa?: string;
}

export async function generateEdition(
  input: EditionInput,
): Promise<{ edition: Edition; report: EditionReport }> {
  const { city, date } = input;

  const { items: recogidos, health } = await collect(city, date, input.http);
  const repartidos = input.weekend ? routeWeekend(recogidos, date, input.weekend) : recogidos;
  const { selected, discarded } = select(repartidos, city, date, {
    publishedUrls: await publishedUrls(city.id, date, undefined, input.root),
    ...(input.weekend ? { weekendSections: [input.weekend.to] } : {}),
    isWeekendEdition: isFriday(date),
  });

  // Fallos aislados (regla 5): si Claude falla, la edición sale igual.
  let draft: Draft | undefined;
  let sinIa: string | undefined;
  let errors: Issue[] = [];
  let warnings: Issue[] = [];
  if (input.draft === undefined) {
    sinIa = input.noDraftReason ?? 'Edición generada sin IA.';
  } else {
    try {
      const bruto = await input.draft({ city, date, items: selected });
      const validacion = validateDraft(bruto, selected, city);
      ({ errors, warnings } = validacion);
      draft = dropInvalid(bruto, validacion);
    } catch (error) {
      sinIa = `Falló la redacción con Claude: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const avisos = [
    ...(sinIa === undefined ? [] : [sinIa]),
    ...health
      .filter((fuente) => fuente.status === 'error')
      .map((fuente) => `${fuente.id}: ${fuente.error ?? 'error'}; su sección va sin esa fuente.`),
    ...errors.map((issue) => `Quitado del borrador: ${issue.message}`),
    ...warnings.map((issue) => issue.message),
  ];

  const sources = new Map(
    city.collectors.map((colector) => [
      colector.id,
      {
        name: colector.name ?? colector.id,
        ...(colector.homepage === undefined ? {} : { homepage: colector.homepage }),
      },
    ]),
  );

  const renderizada = renderEdition({
    city,
    date,
    numero: input.numero,
    items: selected,
    ...(draft === undefined ? {} : { draft }),
    avisos,
    sources,
  });

  const whatsapp = renderWhatsapp(renderizada.body, { editionUrl: editionUrl(city, date) });
  const largo = validateWhatsapp(whatsapp).warnings;
  const frontmatter =
    largo.length === 0
      ? renderizada.frontmatter
      : {
          ...renderizada.frontmatter,
          avisos: [...(renderizada.frontmatter.avisos ?? []), ...largo.map((w) => w.message)],
        };

  return {
    edition: { frontmatter, body: renderizada.body },
    report: {
      health,
      discarded,
      errors,
      warnings: [...warnings, ...largo],
      whatsapp,
      sinRedactar: renderizada.sinRedactar,
      descartesIa: draft?.descartes ?? [],
      ...(sinIa === undefined ? {} : { sinIa }),
    },
  };
}
