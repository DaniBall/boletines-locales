/**
 * Cliente HTTP del motor: la única puerta por la que salen las peticiones a
 * fuentes externas. Implementa la regla 6 (scraping educado) en un solo sitio,
 * para que ningún colector tenga que acordarse de ella:
 *
 * - Timeout y un reintento, solo cuando el fallo es transitorio.
 * - User-Agent identificable, con el contacto de la red.
 * - Caché en disco con ETag e If-Modified-Since, fuera de git.
 * - `robots.txt` respetado, con su propia caché por ejecución.
 * - Una petición por página y ejecución: la segunda reutiliza la primera.
 *
 * Lo que devuelve es texto ya decodificado: hay fuentes, como AEMET, que
 * responden en ISO-8859-15, y los acentos se pierden si se lee como UTF-8.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { http as httpDefaults } from '../config.ts';

export interface HttpResponse {
  url: string;
  status: number;
  body: string;
  /** El servidor contestó 304 y el cuerpo sale de la caché. */
  fromCache: boolean;
}

export class HttpError extends Error {
  readonly url: string;
  readonly status: number | undefined;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = 'HttpError';
    this.url = url;
    this.status = status;
  }
}

export interface HttpClientOptions {
  userAgent?: string;
  timeoutMs?: number;
  /** Reintentos tras el primer intento. Por defecto, uno. */
  retries?: number;
  retryDelayMs?: number;
  cacheDir?: string;
  /** Solo para los tests: desactiva la consulta de `robots.txt`. */
  respectRobots?: boolean;
  /** Solo para los tests. */
  fetchImpl?: typeof fetch;
}

interface CacheEntry {
  url: string;
  etag?: string;
  lastModified?: string;
  body: string;
  storedAt: string;
}

interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/** Códigos que merecen un reintento: el resto son culpa nuestra o definitivos. */
const RETRIABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpClient {
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly cacheDir: string;
  private readonly respectRobots: boolean;
  private readonly fetchImpl: typeof fetch;

  /** Una petición por página y ejecución: aquí viven las ya hechas. */
  private readonly done = new Map<string, Promise<HttpResponse>>();
  private readonly robots = new Map<string, Promise<RobotsRules>>();

  constructor(options: HttpClientOptions = {}) {
    this.userAgent = options.userAgent ?? httpDefaults.userAgent;
    this.timeoutMs = options.timeoutMs ?? httpDefaults.timeoutMs;
    this.retries = options.retries ?? httpDefaults.retries;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.cacheDir = options.cacheDir ?? httpDefaults.cacheDir;
    this.respectRobots = options.respectRobots ?? true;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Texto de una página, decodificado según su cabecera. */
  get(url: string): Promise<HttpResponse> {
    const existing = this.done.get(url);
    if (existing) return existing;

    const pending = this.request(url);
    this.done.set(url, pending);
    return pending;
  }

  /** Como `get`, pero devuelve el JSON ya parseado. */
  async getJson<T>(url: string): Promise<T> {
    const response = await this.get(url);
    try {
      return JSON.parse(response.body) as T;
    } catch (error) {
      throw new HttpError(
        `La respuesta no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
        url,
        response.status,
      );
    }
  }

  private async request(url: string): Promise<HttpResponse> {
    if (this.respectRobots && !(await this.isAllowed(url))) {
      throw new HttpError('El robots.txt de la fuente no permite esta ruta.', url);
    }

    const cached = await this.readCache(url);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      if (attempt > 0) await delay(this.retryDelayMs);
      try {
        return await this.attempt(url, cached);
      } catch (error) {
        lastError = error;
        // Un 404 o un 403 no mejoran por insistir.
        if (
          error instanceof HttpError &&
          error.status !== undefined &&
          !RETRIABLE.has(error.status)
        ) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new HttpError(`Falló la petición: ${String(lastError)}`, url);
  }

  private async attempt(url: string, cached: CacheEntry | undefined): Promise<HttpResponse> {
    const headers: Record<string, string> = { 'user-agent': this.userAgent };
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;

    const response = await this.send(url, headers);

    if (response.status === 304 && cached) {
      return { url, status: 304, body: cached.body, fromCache: true };
    }

    if (!response.ok) {
      throw new HttpError(`La fuente respondió ${String(response.status)}.`, url, response.status);
    }

    const body = await decodeBody(response);
    await this.writeCache(url, response, body);
    return { url, status: response.status, body, fromCache: false };
  }

  private async send(url: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      return await this.fetchImpl(url, { headers, signal: controller.signal, redirect: 'follow' });
    } catch (error) {
      const motivo = controller.signal.aborted
        ? `No contestó en ${String(this.timeoutMs)} ms.`
        : error instanceof Error
          ? error.message
          : String(error);
      throw new HttpError(motivo, url);
    } finally {
      clearTimeout(timer);
    }
  }

  // --- robots.txt ---------------------------------------------------------

  private async isAllowed(url: string): Promise<boolean> {
    const target = new URL(url);
    if (target.pathname === '/robots.txt') return true;

    let pending = this.robots.get(target.origin);
    if (!pending) {
      pending = this.loadRobots(target.origin);
      this.robots.set(target.origin, pending);
    }
    return isPathAllowed(await pending, target.pathname + target.search);
  }

  private async loadRobots(origin: string): Promise<RobotsRules> {
    try {
      const response = await this.send(`${origin}/robots.txt`, { 'user-agent': this.userAgent });
      // Sin robots.txt (404) o con error del servidor, se permite: es lo que
      // dice el estándar y lo que hacen los buscadores.
      if (!response.ok) return { allow: [], disallow: [] };
      return parseRobots(await response.text(), this.userAgent);
    } catch {
      return { allow: [], disallow: [] };
    }
  }

  // --- caché --------------------------------------------------------------

  private cachePath(url: string): string {
    const name = createHash('sha256').update(url).digest('hex').slice(0, 32);
    return path.join(this.cacheDir, `${name}.json`);
  }

  private async readCache(url: string): Promise<CacheEntry | undefined> {
    try {
      const raw = await readFile(this.cachePath(url), 'utf8');
      const entry = JSON.parse(raw) as CacheEntry;
      return entry.url === url ? entry : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeCache(url: string, response: Response, body: string): Promise<void> {
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    if (!etag && !lastModified) return;

    const entry: CacheEntry = { url, body, storedAt: new Date().toISOString() };
    if (etag) entry.etag = etag;
    if (lastModified) entry.lastModified = lastModified;

    try {
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(this.cachePath(url), JSON.stringify(entry), 'utf8');
    } catch {
      // Una caché que no se puede escribir no debe tumbar la recogida.
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Decodifica el cuerpo según el `charset` de la cabecera; por defecto, UTF-8. */
async function decodeBody(response: Response): Promise<string> {
  const charset = parseCharset(response.headers.get('content-type'));
  const buffer = await response.arrayBuffer();
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function parseCharset(contentType: string | null): string {
  const match = contentType?.match(/charset=\s*"?([\w-]+)"?/i);
  return match?.[1]?.toLowerCase() ?? 'utf-8';
}

/**
 * Parser mínimo de `robots.txt`: grupos por `User-agent`, con `Allow` y
 * `Disallow`. Se queda con el grupo que nos nombra y, si no hay, con el de `*`.
 */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const nuestro = userAgent.toLowerCase();
  const grupos = new Map<string, RobotsRules>();
  let actuales: RobotsRules[] = [];
  let enCabecera = false;

  for (const linea of text.split(/\r?\n/)) {
    const limpia = linea.split('#')[0]?.trim() ?? '';
    if (limpia === '') continue;

    const separador = limpia.indexOf(':');
    if (separador === -1) continue;
    const campo = limpia.slice(0, separador).trim().toLowerCase();
    const valor = limpia.slice(separador + 1).trim();

    if (campo === 'user-agent') {
      const clave = valor.toLowerCase();
      if (!enCabecera) actuales = [];
      enCabecera = true;
      let grupo = grupos.get(clave);
      if (!grupo) {
        grupo = { allow: [], disallow: [] };
        grupos.set(clave, grupo);
      }
      actuales.push(grupo);
      continue;
    }

    enCabecera = false;
    if (campo !== 'allow' && campo !== 'disallow') continue;
    // Un `Disallow:` vacío no prohíbe nada.
    if (campo === 'disallow' && valor === '') continue;
    for (const grupo of actuales) grupo[campo].push(valor);
  }

  for (const [clave, reglas] of grupos) {
    if (clave !== '*' && nuestro.includes(clave)) return reglas;
  }
  return grupos.get('*') ?? { allow: [], disallow: [] };
}

/** Gana la regla más larga que case; en empate, `Allow`. */
function isPathAllowed(rules: RobotsRules, pathname: string): boolean {
  const disallow = longestMatch(rules.disallow, pathname);
  if (disallow === undefined) return true;
  const allow = longestMatch(rules.allow, pathname);
  return allow !== undefined && allow >= disallow;
}

function longestMatch(patterns: string[], pathname: string): number | undefined {
  let best: number | undefined;
  for (const pattern of patterns) {
    if (!matches(pattern, pathname)) continue;
    const length = pattern.length;
    if (best === undefined || length > best) best = length;
  }
  return best;
}

/** Soporta los comodines `*` y el ancla final `$` del estándar. */
function matches(pattern: string, pathname: string): boolean {
  const anclado = pattern.endsWith('$');
  const cuerpo = anclado ? pattern.slice(0, -1) : pattern;
  const trozos = cuerpo.split('*');

  let posicion = 0;
  for (const [indice, trozo] of trozos.entries()) {
    if (trozo === '') continue;
    const encontrado =
      indice === 0 ? (pathname.startsWith(trozo) ? 0 : -1) : pathname.indexOf(trozo, posicion);
    if (encontrado === -1) return false;
    posicion = encontrado + trozo.length;
  }

  if (!anclado) return true;
  const ultimo = trozos.at(-1) ?? '';
  return ultimo === '' ? true : pathname.endsWith(ultimo) && posicion === pathname.length;
}
