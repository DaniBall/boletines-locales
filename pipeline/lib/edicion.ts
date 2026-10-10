import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { limits, paths } from '../config.ts';
import type { CityConfig, Edition, EditionFrontmatter } from '../types.ts';
import { normalizeIsoDate, previousDates, type IsoDate } from './fechas.ts';

/**
 * Dónde vive una edición: `ediciones` es lo publicable; `ensayo`, los
 * borradores de prueba que se enseñan a quien ayuda a comprobarlos. Nada de
 * `ensayo` puede acabar publicado por error: es otra carpeta y otra web.
 */
export type EditionKind = 'ediciones' | 'ensayo';

/** content/<ciudad>/ediciones (o /ensayo) */
export function editionsDir(
  cityId: string,
  root = process.cwd(),
  kind: EditionKind = 'ediciones',
): string {
  return path.join(root, paths.content, cityId, kind);
}

export function editionPath(
  cityId: string,
  date: IsoDate,
  root = process.cwd(),
  kind: EditionKind = 'ediciones',
): string {
  return path.join(editionsDir(cityId, root, kind), `${date}.md`);
}

/** URL pública de una edición, a partir del dominio de la ciudad. */
export function editionUrl(
  city: CityConfig,
  date: IsoDate,
  kind: EditionKind = 'ediciones',
): string {
  return `${city.brand.domain.replace(/\/$/, '')}/${kind}/${date}/`;
}

export async function readEdition(
  cityId: string,
  date: IsoDate,
  root = process.cwd(),
  kind: EditionKind = 'ediciones',
): Promise<Edition> {
  const file = editionPath(cityId, date, root, kind);
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
 * semana o días sin edición) simplemente no suman. Durante el ensayo se pasan
 * también los borradores de `ensayo`, que hacen de ediciones publicadas.
 */
export async function publishedUrls(
  cityId: string,
  date: IsoDate,
  days: number = limits.dedupeWindowDays,
  root = process.cwd(),
  kinds: readonly EditionKind[] = ['ediciones'],
): Promise<string[]> {
  const urls: string[] = [];

  for (const dia of previousDates(date, days)) {
    for (const kind of kinds) {
      let edicion: Edition;
      try {
        edicion = await readEdition(cityId, dia, root, kind);
      } catch {
        continue;
      }
      urls.push(...urlsDelCuerpo(edicion.body));
      for (const fuente of edicion.frontmatter.fuentes ?? []) {
        if (fuente.url) urls.push(fuente.url);
      }
    }
  }

  return urls;
}

/**
 * Número de la edición de ese día. Si ya existe (se regenera un borrador),
 * conserva el suyo; si no, el siguiente al mayor que haya. Correlativo por
 * ciudad, como pide el frontmatter.
 */
export async function editionNumber(
  cityId: string,
  date: IsoDate,
  root = process.cwd(),
  kind: EditionKind = 'ediciones',
): Promise<number> {
  let archivos: string[];
  try {
    archivos = await readdir(editionsDir(cityId, root, kind));
  } catch {
    return 1;
  }

  let maximo = 0;
  for (const archivo of archivos) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(archivo)) continue;
    const { frontmatter } = await readEdition(cityId, archivo.slice(0, 10), root, kind);
    if (frontmatter.fecha === date) return frontmatter.numero;
    maximo = Math.max(maximo, frontmatter.numero);
  }
  return maximo + 1;
}

/** Escribe la edición en content/<ciudad>/ediciones/AAAA-MM-DD.md (o en /ensayo). */
export async function writeEdition(
  edition: Edition,
  root = process.cwd(),
  kind: EditionKind = 'ediciones',
): Promise<string> {
  const { ciudad, fecha } = edition.frontmatter;
  const file = editionPath(ciudad, fecha, root, kind);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, matter.stringify(`\n${edition.body}\n`, edition.frontmatter), 'utf8');
  return file;
}
