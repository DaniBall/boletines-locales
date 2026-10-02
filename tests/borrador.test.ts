import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readEdition, writeEdition } from '../pipeline/lib/edicion.ts';
import type { HttpClient } from '../pipeline/lib/http.ts';
import type { CityConfig } from '../pipeline/types.ts';
import { anthropicApiKey, generarBorrador, readReport } from '../scripts/borrador.ts';

const ciudad: CityConfig = {
  id: 'prueba',
  name: 'Villa Prueba',
  brand: { name: 'Prueba', domain: 'https://ejemplo.invalid', channelUrl: '' },
  scope: ['Villa Prueba'],
  aemetMunicipality: '00000',
  sections: [{ id: 'te_afecta', title: '📰 Te afecta', writer: 'ai' }],
  collectors: [
    {
      id: 'diario',
      section: 'te_afecta',
      collect: () =>
        Promise.resolve([
          { id: 'd1', source: 'diario', section: 'te_afecta', title: 'Cortan la calle Mayor' },
        ]),
    },
  ],
  holidays: ['2026-10-12'],
};

const http = {} as HttpClient;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'boletines-borrador-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('generarBorrador', () => {
  it('escribe la edición y el informe de revisión', async () => {
    const resultado = await generarBorrador(ciudad, '2026-09-30', { root, http, sinIa: true });

    expect(resultado.ok).toBe(true);
    const edicion = await readEdition('prueba', '2026-09-30', root);
    expect(edicion.frontmatter).toMatchObject({ numero: 1, estado: 'borrador' });
    expect(edicion.frontmatter.avisos).toContain('Edición generada sin IA (--sin-ia).');
    expect((await readReport('prueba', '2026-09-30', root))?.health[0]?.status).toBe('ok');
  });

  it('no genera en festivo ni en fin de semana si no se fuerza', async () => {
    const festivo = await generarBorrador(ciudad, '2026-10-12', { root, http, sinIa: true });
    const sabado = await generarBorrador(ciudad, '2026-10-03', { root, http, sinIa: true });
    const forzado = await generarBorrador(ciudad, '2026-10-12', {
      root,
      http,
      sinIa: true,
      forzar: true,
    });

    expect(festivo.ok || festivo.motivo).toMatch(/festivo/);
    expect(sabado.ok).toBe(false);
    expect(forzado.ok).toBe(true);
  });

  it('no pisa una edición publicada', async () => {
    await writeEdition(
      {
        frontmatter: {
          ciudad: 'prueba',
          fecha: '2026-09-30',
          numero: 1,
          estado: 'publicada',
          fuentes: [],
        },
        body: 'Ya publicada.',
      },
      root,
    );

    const resultado = await generarBorrador(ciudad, '2026-09-30', { root, http, sinIa: true });

    expect(resultado.ok || resultado.motivo).toMatch(/publicada/);
    expect((await readEdition('prueba', '2026-09-30', root)).body).toBe('Ya publicada.');
  });

  it('sin clave de Anthropic sale sin IA y lo dice', async () => {
    const guardadas = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      BOLETINES_ANTHROPIC_API_KEY: process.env.BOLETINES_ANTHROPIC_API_KEY,
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.BOLETINES_ANTHROPIC_API_KEY;
    try {
      const resultado = await generarBorrador(ciudad, '2026-09-30', { root, http });
      expect(resultado.ok && resultado.report.sinIa).toMatch(/falta ANTHROPIC_API_KEY/);
    } finally {
      for (const [nombre, valor] of Object.entries(guardadas)) {
        if (valor !== undefined) process.env[nombre] = valor;
      }
    }
  });
});

describe('anthropicApiKey', () => {
  it('lee ANTHROPIC_API_KEY y, si no está, el nombre alternativo', () => {
    expect(anthropicApiKey({ ANTHROPIC_API_KEY: 'a', BOLETINES_ANTHROPIC_API_KEY: 'b' })).toBe('a');
    expect(anthropicApiKey({ BOLETINES_ANTHROPIC_API_KEY: ' b ' })).toBe('b');
    expect(anthropicApiKey({ ANTHROPIC_API_KEY: '' })).toBeUndefined();
  });
});
