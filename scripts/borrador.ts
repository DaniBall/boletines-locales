/**
 * Generar el borrador de una edición: lo usan el CLI (`npm run edicion`) y el
 * panel de revisión. Une el motor con la ciudad y deja dos archivos:
 *
 * - la edición, en content/<id>/ediciones/AAAA-MM-DD.md, con `estado: borrador`;
 * - el informe de revisión, en .cache/revision/<id>/AAAA-MM-DD.json. Lleva
 *   titulares de terceros, así que va a la caché, fuera de git (regla 4).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cargarPromptLocal } from '../ciudades/index.ts';
import { http as httpConfig } from '../pipeline/config.ts';
import { editionNumber, readEdition, writeEdition } from '../pipeline/lib/edicion.ts';
import { hasEdition, type IsoDate } from '../pipeline/lib/fechas.ts';
import { HttpClient } from '../pipeline/lib/http.ts';
import { createClaudeDrafter, loadStylePrompt } from '../pipeline/steps/draft.ts';
import { generateEdition, type DraftFn, type EditionReport } from '../pipeline/steps/edition.ts';
import type { CityConfig, Edition } from '../pipeline/types.ts';

export interface BorradorOptions {
  /** Genera aunque sea festivo o fin de semana, o aunque ya esté publicada. */
  forzar?: boolean;
  sinIa?: boolean;
  root?: string;
  /** Solo para los tests. */
  http?: HttpClient;
  draft?: DraftFn;
}

export type BorradorResult =
  | { ok: true; edition: Edition; report: EditionReport; archivo: string; informe: string }
  | { ok: false; motivo: string };

export function reportPath(cityId: string, fecha: IsoDate, root = process.cwd()): string {
  return path.join(root, httpConfig.cacheDir, 'revision', cityId, `${fecha}.json`);
}

/** El informe de revisión de una edición, si se generó en esta máquina. */
export async function readReport(
  cityId: string,
  fecha: IsoDate,
  root = process.cwd(),
): Promise<EditionReport | undefined> {
  try {
    return JSON.parse(await readFile(reportPath(cityId, fecha, root), 'utf8')) as EditionReport;
  } catch {
    return undefined;
  }
}

export async function generarBorrador(
  ciudad: CityConfig,
  fecha: IsoDate,
  options: BorradorOptions = {},
): Promise<BorradorResult> {
  const root = options.root ?? process.cwd();
  const forzar = options.forzar ?? false;

  if (!hasEdition(fecha, ciudad.holidays) && !forzar) {
    return {
      ok: false,
      motivo: `${fecha} no tiene edición en ${ciudad.name} (fin de semana o festivo). Usa --forzar para generarla igual.`,
    };
  }

  // Nunca se pisa una edición ya publicada sin pedirlo.
  const existente = await readEdition(ciudad.id, fecha, root).catch(() => undefined);
  if (existente?.frontmatter.estado === 'publicada' && !forzar) {
    return {
      ok: false,
      motivo: `La edición de ${fecha} ya está publicada. Usa --forzar para regenerarla.`,
    };
  }

  const redaccion = await elegirRedaccion(ciudad, options);
  const { edition, report } = await generateEdition({
    city: ciudad,
    date: fecha,
    http: options.http ?? new HttpClient(),
    numero: await editionNumber(ciudad.id, fecha, root),
    weekend: { from: 'agenda', to: 'finde' },
    root,
    ...redaccion,
  });

  const archivo = await writeEdition(edition, root);
  const informe = reportPath(ciudad.id, fecha, root);
  await mkdir(path.dirname(informe), { recursive: true });
  await writeFile(informe, JSON.stringify(report, null, 2), 'utf8');

  return { ok: true, edition, report, archivo, informe };
}

/** Con Claude si hay clave; sin clave o con `sinIa`, la edición sale igual. */
async function elegirRedaccion(
  ciudad: CityConfig,
  options: BorradorOptions,
): Promise<{ draft: DraftFn } | { noDraftReason: string }> {
  if (options.sinIa) return { noDraftReason: 'Edición generada sin IA (--sin-ia).' };
  if (options.draft) return { draft: options.draft };
  if ((process.env.ANTHROPIC_API_KEY ?? '') === '') {
    return { noDraftReason: 'Edición generada sin IA: falta ANTHROPIC_API_KEY en el entorno.' };
  }

  const local = await cargarPromptLocal(ciudad.id);
  return {
    draft: createClaudeDrafter({
      style: await loadStylePrompt(options.root),
      ...(local === undefined ? {} : { local }),
    }),
  };
}
