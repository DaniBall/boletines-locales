import { readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { limits, paths } from '../config.ts';
import type { CityConfig, Edition, EditionFrontmatter } from '../types.ts';
import { normalizeIsoDate, previousDates, type IsoDate } from './fechas.ts';

/** content/<ciudad>/ediciones */
export function editionsDir(cityId: string, root = process.cwd()): string {
  return path.join(root, paths.content, cityId, 'ediciones');
}

export function editionPath(cityId: string, date: IsoDate, root = process.cwd()): string {
  return path.join(editionsDir(cityId, root), `${date}.md`);
}

/** URL pública de una edición, a partir del dominio de la ciudad. */
export function editionUrl(city: CityConfig, date: IsoDate): string {
  return `${city.brand.domain.replace(/\/$/, '')}/ediciones/${date}/`;
}

export async function readEdition(
  cityId: string,
  date: IsoDate,
  root = process.cwd(),
): Promise<Edition> {
  const file = editionPath(cityId, date, root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(`No hay edición de ${cityId} para ${date} (${path.relative(root, file)}).`);
  }

  const parsed = matter(raw);
  const data = parsed.data as Omit<EditionFrontmatter, 'fecha'> & { fecha: string | Date };
  return {
    frontmatter: { ...data, fecha: normalizeIsoDate(data.fecha) },
    body: parsed.content.trim(),
  };
}

/** URLs de los enlaces de un Markdown, tal y como están escritas. */
function urlsDelCuerpo(body: string): string[] {
  return [...body.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * Lo enlazado en las ediciones recientes de una ciudad, para que `select` no
 * repita lo que ya se contó. Las ediciones que falten (festivos, fines de
 * semana o días sin edición) simplemente no suman.
 */
export async function publishedUrls(
  cityId: string,
  date: IsoDate,
  days: number = limits.dedupeWindowDays,
  root = process.cwd(),
): Promise<string[]> {
  const urls: string[] = [];

  for (const dia of previousDates(date, days)) {
    let edicion: Edition;
    try {
      edicion = await readEdition(cityId, dia, root);
    } catch {
      continue;
    }
    urls.push(...urlsDelCuerpo(edicion.body));
    for (const fuente of edicion.frontmatter.fuentes ?? []) {
      if (fuente.url) urls.push(fuente.url);
    }
  }

  return urls;
}
