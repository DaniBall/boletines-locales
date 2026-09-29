import { describe, expect, it } from 'vitest';
import type { HttpClient } from '../pipeline/lib/http.ts';
import { collect, formatHealthTable } from '../pipeline/steps/collect.ts';
import type { CityConfig, Collector, Item } from '../pipeline/types.ts';

const http = {} as HttpClient;

function item(id: string, section = 'te_afecta'): Item {
  return { id, source: 'prueba', section, title: `Noticia ${id}` };
}

function colector(id: string, collect: Collector['collect'], section = 'te_afecta'): Collector {
  return { id, section, collect };
}

function ciudad(collectors: Collector[]): CityConfig {
  return {
    id: 'prueba',
    name: 'Villa Prueba',
    brand: { name: 'Prueba', domain: 'https://ejemplo.invalid', channelUrl: '' },
    scope: ['Villa Prueba'],
    aemetMunicipality: '00000',
    sections: [
      { id: 'te_afecta', title: '📰 Te afecta', writer: 'ai' },
      { id: 'nieve', title: '❄️ Nieve', writer: 'code', season: { from: '11-01', to: '03-31' } },
    ],
    collectors,
    holidays: [],
  };
}

describe('collect', () => {
  it('junta los items en el orden de los colectores, no en el de llegada', async () => {
    const lento = colector(
      'lento',
      () => new Promise((resolve) => setTimeout(() => resolve([item('a')]), 20)),
    );
    const rapido = colector('rapido', () => Promise.resolve([item('b')]));

    const { items, health } = await collect(ciudad([lento, rapido]), '2026-09-29', http);

    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(health.map((h) => h.status)).toEqual(['ok', 'ok']);
  });

  it('aísla el fallo de una fuente: las demás siguen (regla 5)', async () => {
    const rota = colector('rota', () => Promise.reject(new Error('La fuente respondió 500.')));
    const buena = colector('buena', () => Promise.resolve([item('x')]));

    const { items, health } = await collect(ciudad([rota, buena]), '2026-09-29', http);

    expect(items.map((i) => i.id)).toEqual(['x']);
    expect(health[0]).toMatchObject({
      id: 'rota',
      status: 'error',
      items: 0,
      error: 'La fuente respondió 500.',
    });
  });

  it('distingue una fuente vacía de una caída', async () => {
    const vacia = colector('vacia', () => Promise.resolve([]));

    const { health } = await collect(ciudad([vacia]), '2026-09-29', http);

    expect(health[0]?.status).toBe('vacia');
  });

  it('no pide nada a una fuente de una sección fuera de temporada', async () => {
    let llamadas = 0;
    const nieve = colector(
      'nieve-dgt',
      () => {
        llamadas += 1;
        return Promise.resolve([item('n', 'nieve')]);
      },
      'nieve',
    );

    const septiembre = await collect(ciudad([nieve]), '2026-09-29', http);
    expect(septiembre.health[0]?.status).toBe('fuera-de-temporada');
    expect(llamadas).toBe(0);

    const enero = await collect(ciudad([nieve]), '2027-01-15', http);
    expect(enero.health[0]?.status).toBe('ok');
    expect(llamadas).toBe(1);
  });

  it('corta al colector que no termina, sin dejar la ejecución colgada', async () => {
    const colgado = colector('colgado', () => new Promise(() => {}));

    const { health } = await collect(ciudad([colgado]), '2026-09-29', http, {
      collectorTimeoutMs: 30,
    });

    expect(health[0]?.status).toBe('error');
    expect(health[0]?.error).toContain('no terminó en 30 ms');
  });

  it('pasa a cada colector la ciudad, la fecha y el cliente compartido', async () => {
    const vistos: unknown[] = [];
    const espia = colector('espia', (ctx) => {
      vistos.push(ctx.city.id, ctx.date, ctx.http);
      return Promise.resolve([]);
    });

    await collect(ciudad([espia]), '2026-09-29', http);

    expect(vistos).toEqual(['prueba', '2026-09-29', http]);
  });
});

describe('formatHealthTable', () => {
  it('pinta una fila por fuente, con el error si lo hay', () => {
    const tabla = formatHealthTable([
      { id: 'rss-a', section: 'te_afecta', status: 'ok', items: 10, ms: 120 },
      {
        id: 'rss-b',
        section: 'te_afecta',
        status: 'error',
        items: 0,
        ms: 10_000,
        error: 'No contestó en 10000 ms.',
      },
    ]);

    expect(tabla.split('\n')).toEqual([
      '| Fuente | Sección | Estado | Items | Tiempo |',
      '|---|---|---|---:|---:|',
      '| rss-a | te_afecta | ✅ bien | 10 | 120 ms |',
      '| rss-b | te_afecta | ❌ error — No contestó en 10000 ms. | 0 | 10000 ms |',
    ]);
  });

  it('no deja que una barra en el error rompa la tabla', () => {
    const tabla = formatHealthTable([
      { id: 'x', section: 's', status: 'error', items: 0, ms: 1, error: 'a | b' },
    ]);

    expect(tabla).toContain('a / b');
  });
});
