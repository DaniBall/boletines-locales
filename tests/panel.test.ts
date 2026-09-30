import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseGitMode, publishCommit } from '../panel/git.ts';
import { createPanel } from '../panel/servidor.ts';
import { escapeHtml } from '../panel/vistas.ts';
import { readEdition, writeEdition } from '../pipeline/lib/edicion.ts';
import type { Edition } from '../pipeline/types.ts';
import type { BorradorResult } from '../scripts/borrador.ts';

const exec = promisify(execFile);
const FECHA = '2026-09-30';

const borrador: Edition = {
  frontmatter: {
    ciudad: 'jaen',
    fecha: FECHA,
    numero: 2,
    estado: 'borrador',
    fuentes: [],
    avisos: ['Sin redactar: 📰 Te afecta.'],
  },
  body: '¡Buenos días, Jaén! Miércoles 30 de septiembre, edición nº 2.\n\n## 📰 Te afecta\n\n- **Obras** <script>',
};

let root: string;
let base: string;
let cerrar: () => Promise<void>;
let regeneradas: string[];

async function arrancar(regenerar?: () => Promise<BorradorResult>): Promise<void> {
  regeneradas = [];
  const panel = createPanel({
    root,
    regenerate: (city, fecha) => {
      regeneradas.push(`${city.id}/${fecha}`);
      return regenerar ? regenerar() : Promise.resolve({ ok: false, motivo: 'Sin fuentes.' });
    },
  });
  await new Promise<void>((resolve) => panel.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((panel.address() as AddressInfo).port)}`;
  cerrar = () => new Promise((resolve) => panel.close(() => resolve()));
}

function enviar(
  ruta: string,
  campos: Record<string, string>,
  cabeceras: Record<string, string> = {},
) {
  return fetch(`${base}${ruta}`, {
    method: 'POST',
    body: new URLSearchParams(campos),
    redirect: 'manual',
    headers: cabeceras,
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'boletines-panel-'));
  await writeEdition(borrador, root);
  await arrancar();
});

afterEach(async () => {
  await cerrar();
  await rm(root, { recursive: true, force: true });
});

describe('el panel de revisión', () => {
  it('lista las ediciones de cada ciudad con su estado', async () => {
    const html = await (await fetch(`${base}/`)).text();

    expect(html).toContain(`href="/jaen/${FECHA}/"`);
    expect(html).toContain('borrador');
    expect(html).toContain('León');
  });

  it('enseña la edición, sus avisos y el texto de WhatsApp, todo escapado', async () => {
    const respuesta = await fetch(`${base}/jaen/${FECHA}/`);
    const html = await respuesta.text();

    expect(respuesta.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(html).toContain('Sin redactar: 📰 Te afecta.');
    expect(html).toContain('*📰 Te afecta*');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('guarda los cambios del Markdown y conserva el frontmatter', async () => {
    const respuesta = await enviar(`/jaen/${FECHA}/guardar`, { cuerpo: 'Texto nuevo.\r\n' });

    expect(respuesta.status).toBe(303);
    expect(respuesta.headers.get('location')).toBe(`/jaen/${FECHA}/?hecho=guardado`);
    const guardada = await readEdition('jaen', FECHA, root);
    expect(guardada.body).toBe('Texto nuevo.');
    expect(guardada.frontmatter.numero).toBe(2);
  });

  it('no aprueba sin la casilla de revisión', async () => {
    const respuesta = await enviar(`/jaen/${FECHA}/aprobar`, {});

    expect(respuesta.status).toBe(400);
    expect((await readEdition('jaen', FECHA, root)).frontmatter.estado).toBe('borrador');
  });

  it('aprobar la publica y le quita los avisos, que eran para revisar', async () => {
    const respuesta = await enviar(`/jaen/${FECHA}/aprobar`, { revisado: 'on' });

    expect(respuesta.status).toBe(303);
    const publicada = await readEdition('jaen', FECHA, root);
    expect(publicada.frontmatter.estado).toBe('publicada');
    expect(publicada.frontmatter.avisos).toBeUndefined();
    expect(publicada.body).toBe(borrador.body);
  });

  it('no regenera una edición ya publicada', async () => {
    await enviar(`/jaen/${FECHA}/aprobar`, { revisado: 'on' });

    const respuesta = await enviar(`/jaen/${FECHA}/regenerar`, {});

    expect(respuesta.status).toBe(400);
    expect(regeneradas).toEqual([]);
  });

  it('regenera el borrador y, si no puede, dice por qué', async () => {
    const respuesta = await enviar(`/jaen/${FECHA}/regenerar`, {});

    expect(regeneradas).toEqual([`jaen/${FECHA}`]);
    expect(respuesta.status).toBe(400);
    expect(await respuesta.text()).toContain('Sin fuentes.');
  });

  it('rechaza las acciones que llegan desde otro sitio', async () => {
    const otroSitio = await enviar(
      `/jaen/${FECHA}/aprobar`,
      { revisado: 'on' },
      { 'sec-fetch-site': 'cross-site' },
    );
    const otroOrigen = await enviar(
      `/jaen/${FECHA}/aprobar`,
      { revisado: 'on' },
      { origin: 'https://malo.invalid' },
    );

    expect(otroSitio.status).toBe(403);
    expect(otroOrigen.status).toBe(403);
    expect((await readEdition('jaen', FECHA, root)).frontmatter.estado).toBe('borrador');
  });

  it('no sirve rutas raras: ciudades o fechas que no existen', async () => {
    expect((await fetch(`${base}/madrid/${FECHA}/`)).status).toBe(404);
    expect((await fetch(`${base}/jaen/..%2F..%2Fetc/`)).status).toBe(404);
    expect((await fetch(`${base}/jaen/2026-10-01/`)).status).toBe(404);
  });
});

describe('publishCommit', () => {
  it('hace commit solo de la edición, con el mensaje del proyecto', async () => {
    await exec('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await exec('git', ['config', 'user.email', 'panel@ejemplo.invalid'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Panel'], { cwd: root });
    await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });
    const otro = path.join(root, 'otro.txt');
    await exec('sh', ['-c', `echo hola > "${otro}" && git add otro.txt`], { cwd: root });

    const archivo = path.join(root, 'content', 'jaen', 'ediciones', `${FECHA}.md`);
    const sha = await publishCommit(
      archivo,
      ':speech_balloon: Publica la edición nº 2.',
      'commit',
      root,
    );

    expect(sha).toMatch(/^[0-9a-f]{7,}$/);
    const { stdout } = await exec('git', ['show', '--name-only', '--format=%s', 'HEAD'], {
      cwd: root,
    });
    expect(stdout.trim().split('\n')).toEqual([
      ':speech_balloon: Publica la edición nº 2.',
      '',
      `content/jaen/ediciones/${FECHA}.md`,
    ]);
    expect(await readFile(otro, 'utf8')).toBe('hola\n');
  });

  it('en modo off no toca git', async () => {
    await expect(publishCommit('x', 'y', 'off', root)).resolves.toBeUndefined();
  });

  it('solo admite off, commit o push', () => {
    expect(parseGitMode(undefined)).toBe('off');
    expect(parseGitMode('push')).toBe('push');
    expect(() => parseGitMode('merge')).toThrow(/off, commit o push/);
  });
});

describe('escapeHtml', () => {
  it('escapa lo que podría romper el HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
