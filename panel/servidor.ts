/**
 * Panel de revisión: ver, editar, regenerar y aprobar los borradores de cada
 * ciudad. Sustituye a la revisión por Pull Request.
 *
 * Solo escucha en local salvo que se diga otra cosa. En el VPS va detrás de un
 * control de acceso (propuesta: Cloudflare Access) y con HTTPS: el panel no
 * tiene usuarios propios.
 *
 * Aprobar = `estado: publicada`, sin los avisos (son para revisar, no para el
 * lector) y, según `git`, commit y push de ese único archivo.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readdir } from 'node:fs/promises';
import { buscarCiudad, ciudades } from '../ciudades/index.ts';
import { editionUrl, editionsDir, readEdition, writeEdition } from '../pipeline/lib/edicion.ts';
import { renderWhatsapp } from '../pipeline/render/whatsapp.ts';
import type { CityConfig, Edition } from '../pipeline/types.ts';
import { readReport, type BorradorResult } from '../scripts/borrador.ts';
import { publishCommit, type GitMode } from './git.ts';
import { vistaEdicion, vistaError, vistaInicio, type EditionView } from './vistas.ts';

export interface PanelOptions {
  root?: string;
  git?: GitMode;
  /** Regenera el borrador; por defecto, el mismo que `npm run edicion`. */
  regenerate: (city: CityConfig, fecha: string) => Promise<BorradorResult>;
  /** Ediciones por ciudad en la portada. */
  limit?: number;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 1_000_000;

class HttpProblem extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createPanel(options: PanelOptions): Server {
  const root = options.root ?? process.cwd();
  const git = options.git ?? 'off';
  const limit = options.limit ?? 20;

  async function inicio(res: ServerResponse): Promise<void> {
    const bloques = await Promise.all(
      ciudades.map(async (city) => ({ city, editions: await ediciones(city.id, root, limit) })),
    );
    enviar(res, 200, vistaInicio(bloques));
  }

  async function verEdicion(
    res: ServerResponse,
    city: CityConfig,
    fecha: string,
    flash?: EditionView['flash'],
  ): Promise<void> {
    const edition = await leer(city, fecha, root);
    const report = await readReport(city.id, fecha, root);
    enviar(
      res,
      flash?.error ? 400 : 200,
      vistaEdicion({
        city,
        edition,
        whatsapp: renderWhatsapp(edition.body, { editionUrl: editionUrl(city, fecha) }),
        ...(report === undefined ? {} : { report }),
        ...(flash === undefined ? {} : { flash }),
      }),
    );
  }

  async function accion(
    req: IncomingMessage,
    res: ServerResponse,
    city: CityConfig,
    fecha: string,
    nombre: string,
  ): Promise<void> {
    comprobarOrigen(req);
    const form = new URLSearchParams(await leerCuerpo(req));

    if (nombre === 'guardar') {
      const edition = await leer(city, fecha, root);
      const cuerpo = (form.get('cuerpo') ?? '').replace(/\r\n/g, '\n').trim();
      if (cuerpo === '') throw new HttpProblem(400, 'La edición no puede quedarse vacía.');
      const archivo = await writeEdition({ ...edition, body: cuerpo }, root);
      // Corregir una ya publicada es volver a publicarla.
      if (edition.frontmatter.estado === 'publicada') {
        const mensaje = `:pencil2: Corrige la edición nº ${String(edition.frontmatter.numero)} de ${city.name} (${fecha}).`;
        await publishCommit(archivo, mensaje, git, root);
      }
      return redirigir(res, city, fecha, 'guardado');
    }

    if (nombre === 'aprobar') {
      const edition = await leer(city, fecha, root);
      if (form.get('revisado') !== 'on') {
        return verEdicion(res, city, fecha, {
          texto: 'Marca la casilla de revisión antes de aprobar.',
          error: true,
        });
      }
      if (edition.frontmatter.estado === 'publicada') {
        return verEdicion(res, city, fecha, { texto: 'Esta edición ya estaba publicada.' });
      }
      const frontmatter = { ...edition.frontmatter, estado: 'publicada' as const };
      delete frontmatter.avisos;
      const archivo = await writeEdition({ frontmatter, body: edition.body }, root);
      const mensaje = `:speech_balloon: Publica la edición nº ${String(edition.frontmatter.numero)} de ${city.name} (${fecha}).`;
      await publishCommit(archivo, mensaje, git, root);
      return redirigir(res, city, fecha, 'publicada');
    }

    if (nombre === 'regenerar') {
      const edition = await leer(city, fecha, root);
      if (edition.frontmatter.estado === 'publicada') {
        return verEdicion(res, city, fecha, {
          texto: 'Esta edición ya está publicada: no se regenera desde el panel.',
          error: true,
        });
      }
      const resultado = await options.regenerate(city, fecha);
      if (!resultado.ok)
        return verEdicion(res, city, fecha, { texto: resultado.motivo, error: true });
      return redirigir(res, city, fecha, 'regenerado');
    }

    throw new HttpProblem(404, 'Esa acción no existe.');
  }

  async function atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://panel.invalid');
    const partes = url.pathname.split('/').filter((parte) => parte !== '');

    if (partes.length === 0 && req.method === 'GET') return inicio(res);

    const [ciudadId, fecha, nombre, ...sobra] = partes;
    const city = ciudadId === undefined ? undefined : buscarCiudad(ciudadId);
    if (city === undefined || fecha === undefined || !FECHA.test(fecha) || sobra.length > 0) {
      throw new HttpProblem(404, 'Aquí no hay nada.');
    }

    if (nombre === undefined && req.method === 'GET') {
      const hecho = url.searchParams.get('hecho');
      const textos: Record<string, string> = {
        guardado: 'Cambios guardados.',
        publicada:
          git === 'off'
            ? 'Aprobada. (Sin git: el archivo queda escrito, sin commit.)'
            : 'Aprobada y publicada.',
        regenerado: 'Borrador regenerado.',
      };
      const texto = hecho === null ? undefined : textos[hecho];
      return verEdicion(res, city, fecha, texto === undefined ? undefined : { texto });
    }
    if (nombre !== undefined && req.method === 'POST') return accion(req, res, city, fecha, nombre);

    throw new HttpProblem(405, 'Método no permitido.');
  }

  return createServer((req, res) => {
    atender(req, res).catch((error: unknown) => {
      const status = error instanceof HttpProblem ? error.status : 500;
      const texto = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) enviar(res, status, vistaError(status, texto));
      else res.end();
    });
  });
}

async function ediciones(cityId: string, root: string, limit: number): Promise<Edition[]> {
  let archivos: string[];
  try {
    archivos = await readdir(editionsDir(cityId, root));
  } catch {
    return [];
  }
  const fechas = archivos
    .filter((archivo) => /^\d{4}-\d{2}-\d{2}\.md$/.test(archivo))
    .map((archivo) => archivo.slice(0, 10))
    .sort()
    .reverse()
    .slice(0, limit);
  return Promise.all(fechas.map((fecha) => readEdition(cityId, fecha, root)));
}

async function leer(city: CityConfig, fecha: string, root: string): Promise<Edition> {
  try {
    return await readEdition(city.id, fecha, root);
  } catch {
    throw new HttpProblem(404, `No hay edición de ${city.name} para ${fecha}.`);
  }
}

/**
 * Contra CSRF: una acción solo vale si la pide el propio panel. Los
 * navegadores mandan `Sec-Fetch-Site` y `Origin` en los POST.
 */
function comprobarOrigen(req: IncomingMessage): void {
  const sitio = req.headers['sec-fetch-site'];
  if (sitio !== undefined && sitio !== 'same-origin' && sitio !== 'none') {
    throw new HttpProblem(403, 'Petición de otro sitio.');
  }
  const origen = req.headers.origin;
  if (origen !== undefined && origen !== 'null') {
    let host: string;
    try {
      host = new URL(origen).host;
    } catch {
      throw new HttpProblem(403, 'Origen no válido.');
    }
    if (host !== req.headers.host) throw new HttpProblem(403, 'Petición de otro sitio.');
  }
}

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  const trozos: Buffer[] = [];
  let total = 0;
  for await (const trozo of req as AsyncIterable<Buffer>) {
    total += trozo.length;
    if (total > MAX_BODY) throw new HttpProblem(413, 'Demasiado texto.');
    trozos.push(trozo);
  }
  return Buffer.concat(trozos).toString('utf8');
}

function enviar(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
  });
  res.end(html);
}

function redirigir(res: ServerResponse, city: CityConfig, fecha: string, hecho: string): void {
  res.writeHead(303, { location: `/${city.id}/${fecha}/?hecho=${hecho}` });
  res.end();
}
