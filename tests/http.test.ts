import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HttpClient, HttpError, parseRobots } from '../pipeline/lib/http.ts';

/**
 * Todo se prueba contra un servidor local: los tests no salen a internet, ni
 * siquiera para el `robots.txt`.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let base: string;
let handler: Handler;
let cacheDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    handler(req, res);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Sin puerto.');
  base = `http://127.0.0.1:${String(address.port)}`;
  cacheDir = await mkdtemp(path.join(tmpdir(), 'boletines-cache-'));
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  await rm(cacheDir, { recursive: true, force: true });
});

afterEach(() => {
  handler = (_req, res) => {
    res.end();
  };
});

function cliente(options: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}): HttpClient {
  return new HttpClient({ cacheDir, respectRobots: false, retryDelayMs: 1, ...options });
}

describe('el cliente HTTP', () => {
  it('se identifica con el User-Agent de la red', async () => {
    let recibido: string | undefined;
    handler = (req, res) => {
      recibido = req.headers['user-agent'];
      res.end('vale');
    };

    const respuesta = await cliente({ userAgent: 'Boletines locales (+hola@ejemplo.es)' }).get(
      `${base}/agenda`,
    );

    expect(respuesta.body).toBe('vale');
    expect(recibido).toBe('Boletines locales (+hola@ejemplo.es)');
  });

  it('decodifica los acentos de una fuente en ISO-8859-15, como AEMET', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'text/plain; charset=ISO-8859-15');
      res.end(Buffer.from('Máxima en Jaén: 32°', 'latin1'));
    };

    const respuesta = await cliente().get(`${base}/tiempo`);

    expect(respuesta.body).toBe('Máxima en Jaén: 32°');
  });

  it('sin charset en la cabecera, lo lee de la declaración XML', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'application/xml');
      res.end(
        Buffer.from(
          '<?xml version="1.0" encoding="iso-8859-1"?><rss><title>Ayuntamiento de Jaén</title></rss>',
          'latin1',
        ),
      );
    };

    const respuesta = await cliente().get(`${base}/rss-municipal`);

    expect(respuesta.body).toContain('Ayuntamiento de Jaén');
  });

  it('sin charset en la cabecera, lo lee del meta del HTML', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(
        Buffer.from(
          '<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" /></head><body>Agenda de Jaén</body></html>',
          'latin1',
        ),
      );
    };

    expect((await cliente().get(`${base}/agenda-municipal`)).body).toContain('Agenda de Jaén');
  });

  it('la cabecera manda sobre lo que diga el documento', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'application/xml; charset=utf-8');
      res.end(Buffer.from('<?xml version="1.0" encoding="iso-8859-1"?><a>Jaén</a>', 'utf8'));
    };

    expect((await cliente().get(`${base}/contradictorio`)).body).toContain('Jaén');
  });

  it('falla cuando la fuente no contesta a tiempo', async () => {
    handler = () => {
      // Nunca responde: el timeout tiene que cortar.
    };

    await expect(cliente({ timeoutMs: 50, retries: 0 }).get(`${base}/lenta`)).rejects.toThrow(
      /50 ms/,
    );
  });

  it('reintenta una vez si el fallo es transitorio', async () => {
    let llamadas = 0;
    handler = (_req, res) => {
      llamadas += 1;
      if (llamadas === 1) {
        res.statusCode = 503;
        res.end('ahora no');
        return;
      }
      res.end('ya sí');
    };

    const respuesta = await cliente().get(`${base}/inestable`);

    expect(respuesta.body).toBe('ya sí');
    expect(llamadas).toBe(2);
  });

  it('no insiste ante un 404, que no mejora por repetirlo', async () => {
    let llamadas = 0;
    handler = (_req, res) => {
      llamadas += 1;
      res.statusCode = 404;
      res.end('no está');
    };

    await expect(cliente().get(`${base}/fantasma`)).rejects.toBeInstanceOf(HttpError);
    expect(llamadas).toBe(1);
  });

  it('hace una sola petición por página y ejecución', async () => {
    let llamadas = 0;
    handler = (_req, res) => {
      llamadas += 1;
      res.end('una vez');
    };

    const http = cliente();
    const [primera, segunda] = await Promise.all([
      http.get(`${base}/repetida`),
      http.get(`${base}/repetida`),
    ]);

    expect(llamadas).toBe(1);
    expect(primera.body).toBe('una vez');
    expect(segunda.body).toBe('una vez');
  });

  it('guarda el ETag y reutiliza el cuerpo cuando la fuente responde 304', async () => {
    const url = `${base}/con-etag`;
    let condicional: string | undefined;

    handler = (_req, res) => {
      res.setHeader('etag', '"v1"');
      res.end('primera versión');
    };
    const primera = await cliente().get(url);
    expect(primera.fromCache).toBe(false);

    handler = (req, res) => {
      condicional = req.headers['if-none-match'];
      res.statusCode = 304;
      res.end();
    };
    // Cliente nuevo, misma caché en disco: es lo que pasa entre dos ejecuciones.
    const segunda = await cliente().get(url);

    expect(condicional).toBe('"v1"');
    expect(segunda.fromCache).toBe(true);
    expect(segunda.body).toBe('primera versión');
  });

  it('devuelve el JSON ya parseado y avisa si no lo es', async () => {
    handler = (_req, res) => {
      res.end('{"precio": 1.42}');
    };
    await expect(cliente().getJson<{ precio: number }>(`${base}/carburantes`)).resolves.toEqual({
      precio: 1.42,
    });

    handler = (_req, res) => {
      res.end('<html>esto no es json</html>');
    };
    await expect(cliente().getJson(`${base}/roto`)).rejects.toThrow(/no es JSON válido/);
  });

  it('respeta el robots.txt de la fuente', async () => {
    handler = (req, res) => {
      if (req.url === '/robots.txt') {
        res.end('User-agent: *\nDisallow: /privado\n');
        return;
      }
      res.end('contenido');
    };

    const http = cliente({ respectRobots: true });

    await expect(http.get(`${base}/privado/agenda`)).rejects.toThrow(/robots\.txt/);
    await expect(http.get(`${base}/publico/agenda`)).resolves.toMatchObject({
      body: 'contenido',
    });
  });

  it('permite todo si la fuente no tiene robots.txt', async () => {
    handler = (req, res) => {
      if (req.url === '/robots.txt') {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.end('contenido');
    };

    await expect(cliente({ respectRobots: true }).get(`${base}/sin-robots`)).resolves.toMatchObject(
      { body: 'contenido' },
    );
  });
});

describe('parseRobots', () => {
  const robots = `
User-agent: *
Disallow: /

User-agent: Boletines
Disallow: /admin
Allow: /admin/publico
`;

  it('se queda con el grupo que nos nombra y no con el general', () => {
    const reglas = parseRobots(robots, 'Boletines locales (+hola@ejemplo.es)');
    expect(reglas.disallow).toEqual(['/admin']);
    expect(reglas.allow).toEqual(['/admin/publico']);
  });

  it('cae en el grupo general si no nos nombra nadie', () => {
    const reglas = parseRobots(robots, 'Otro lector');
    expect(reglas.disallow).toEqual(['/']);
  });

  it('ignora los comentarios y el Disallow vacío, que no prohíbe nada', () => {
    const reglas = parseRobots('User-agent: *\n# un comentario\nDisallow:\n', 'quien sea');
    expect(reglas.disallow).toEqual([]);
  });
});
