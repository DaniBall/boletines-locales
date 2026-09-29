import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFeed, rssCollector } from '../pipeline/collectors/rss.ts';
import type { HttpClient } from '../pipeline/lib/http.ts';
import { makeItemId } from '../pipeline/lib/items.ts';
import type { CityConfig } from '../pipeline/types.ts';

/**
 * Las fixtures están escritas a mano en el formato real (RSS 2.0 y Atom), con
 * contenido inventado: no se commitea contenido de terceros (regla 4).
 */
const fixtures = path.resolve(import.meta.dirname, 'fixtures', 'rss');
const leer = (nombre: string) => readFile(path.join(fixtures, nombre), 'utf8');

const fuente = { id: 'rss-prueba', section: 'te_afecta' };

describe('parseFeed con RSS 2.0', () => {
  it('lee las entradas con titular y se salta la que no lo tiene', async () => {
    const items = parseFeed(await leer('medio-rss2.xml'), fuente);

    expect(items.map((item) => item.title)).toEqual([
      'Cortes de tráfico en la calle Mayor & la plaza',
      'Abre el plazo de las ayudas al comercio',
      'Una noticia con una entradilla muy larga',
      'Una entrada sin enlace de ningún tipo',
    ]);
    expect(items.every((item) => item.source === 'rss-prueba')).toBe(true);
    expect(items.every((item) => item.section === 'te_afecta')).toBe(true);
  });

  it('deja el resumen en texto plano, sin HTML ni entidades', async () => {
    const [cortes, ayudas] = parseFeed(await leer('medio-rss2.xml'), fuente);

    expect(cortes?.summary).toBe('El Ayuntamiento cortará la calle Mayor desde las 8:00. Más');
    expect(ayudas?.summary).toBe('La convocatoria está dotada con 200.000 euros.');
  });

  it('respeta la zona horaria de la fecha, que decide de qué día es la noticia', async () => {
    const [cortes, ayudas] = parseFeed(await leer('medio-rss2.xml'), fuente);

    expect(cortes?.publishedAt).toBe('2026-09-21T08:30:00.000+02:00');
    // dc:date en ISO, en lugar de pubDate.
    expect(ayudas?.publishedAt).toBe('2026-09-20T17:45:00.000Z');
  });

  it('usa el guid como enlace solo cuando es un enlace permanente', async () => {
    const items = parseFeed(await leer('medio-rss2.xml'), fuente);

    expect(items[1]?.url).toBe('https://medio-prueba.es/noticias/ayudas-comercio');
    // isPermaLink="false": es un identificador interno, no una URL publicable.
    expect(items[3]?.url).toBeUndefined();
    expect(items[3]?.summary).toBe('Solo trae el cuerpo en content:encoded.');
  });

  it('recorta la entradilla larga por una palabra entera', async () => {
    const larga = parseFeed(await leer('medio-rss2.xml'), fuente)[2];

    expect(larga?.summary?.length).toBeLessThanOrEqual(401);
    expect(larga?.summary?.endsWith('…')).toBe(true);
    expect(larga?.summary).not.toContain('Octava frase');
  });

  it('se queda solo con las primeras entradas si se le pone tope', async () => {
    expect(parseFeed(await leer('medio-rss2.xml'), { ...fuente, limit: 2 })).toHaveLength(2);
  });

  it('no convierte en número un titular que lo parece', () => {
    const xml = '<rss><channel><item><title>2027</title></item></channel></rss>';
    expect(parseFeed(xml, fuente)[0]?.title).toBe('2027');
  });
});

describe('parseFeed con Atom', () => {
  it('elige el enlace alternate aunque venga detrás de otro', async () => {
    const [concierto, mercadillo] = parseFeed(await leer('agenda-atom.xml'), fuente);

    expect(concierto?.url).toBe('https://agenda-prueba.es/eventos/concierto');
    // Sin rel, un enlace de Atom es alternate.
    expect(mercadillo?.url).toBe('https://agenda-prueba.es/eventos/mercadillo');
  });

  it('limpia el HTML del titular y prefiere la fecha de publicación', async () => {
    const [concierto, mercadillo] = parseFeed(await leer('agenda-atom.xml'), fuente);

    expect(concierto?.title).toBe('Concierto en el auditorio');
    expect(concierto?.publishedAt).toBe('2026-09-21T06:00:00.000Z');
    expect(mercadillo?.publishedAt).toBe('2026-09-20T09:00:00.000+02:00');
  });
});

describe('parseFeed ante lo que no es un feed', () => {
  it('devuelve una lista vacía con una página HTML', () => {
    expect(parseFeed('<html><body><p>No es un feed</p></body></html>', fuente)).toEqual([]);
  });

  it('devuelve una lista vacía con un feed sin entradas', () => {
    expect(parseFeed('<rss><channel><title>Vacío</title></channel></rss>', fuente)).toEqual([]);
  });
});

describe('ids de los items', () => {
  it('son estables aunque la URL cambie de parámetros de seguimiento', () => {
    expect(makeItemId('rss-prueba', 'https://medio.es/a?utm_source=rss')).toBe(
      makeItemId('rss-prueba', 'https://www.medio.es/a/'),
    );
  });

  it('distinguen la misma URL leída por dos fuentes', () => {
    expect(makeItemId('rss-a', 'https://medio.es/a')).not.toBe(
      makeItemId('rss-b', 'https://medio.es/a'),
    );
  });
});

describe('rssCollector', () => {
  it('pide el feed por el cliente compartido de la ejecución', async () => {
    const xml = await leer('agenda-atom.xml');
    const pedidas: string[] = [];
    const http = {
      get: (url: string) => {
        pedidas.push(url);
        return Promise.resolve({ url, status: 200, body: xml, fromCache: false });
      },
    } as unknown as HttpClient;

    const colector = rssCollector({
      id: 'rss-agenda',
      url: 'https://agenda-prueba.es/feed',
      section: 'agenda',
    });
    const items = await colector.collect({
      city: {} as CityConfig,
      date: '2026-09-21',
      http,
    });

    expect(pedidas).toEqual(['https://agenda-prueba.es/feed']);
    expect(colector.section).toBe('agenda');
    expect(items).toHaveLength(2);
    expect(items[0]?.source).toBe('rss-agenda');
  });
});
