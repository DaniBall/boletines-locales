import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pasaFiltroDeRuta } from '../pipeline/collectors/comun.ts';
import { parseFeed } from '../pipeline/collectors/rss.ts';
import { parseNewsSitemap } from '../pipeline/collectors/sitemap-noticias.ts';

const fixtures = path.resolve(import.meta.dirname, 'fixtures', 'rss');
const leer = (nombre: string) => readFile(path.join(fixtures, nombre), 'utf8');
const fuente = { id: 'sitemap-prueba', section: 'te_afecta' };

describe('pasaFiltroDeRuta', () => {
  const url = 'https://medio.es/jaen/jaen/obras-en-la-calle-mayor';

  it('sin filtro, pasa todo, incluso lo que no tiene URL', () => {
    expect(pasaFiltroDeRuta(url, {})).toBe(true);
    expect(pasaFiltroDeRuta(undefined, {})).toBe(true);
  });

  it('con includePaths, solo pasa lo que empieza por alguno', () => {
    expect(pasaFiltroDeRuta(url, { includePaths: ['/jaen/jaen/'] })).toBe(true);
    expect(pasaFiltroDeRuta(url, { includePaths: ['/jaen/linares/'] })).toBe(false);
  });

  it('excludePaths gana aunque también case con includePaths', () => {
    const opinion = 'https://medio.es/jaen/opinion/columna';
    expect(
      pasaFiltroDeRuta(opinion, { includePaths: ['/jaen/'], excludePaths: ['/jaen/opinion/'] }),
    ).toBe(false);
  });

  it('con un filtro puesto, lo que no tiene URL no puede darse por bueno', () => {
    expect(pasaFiltroDeRuta(undefined, { excludePaths: ['/opinion/'] })).toBe(false);
  });
});

describe('el filtro de ruta en el colector de RSS', () => {
  it('aplica el tope después de filtrar', async () => {
    const xml = await leer('medio-rss2.xml');
    const items = parseFeed(xml, { ...fuente, includePaths: ['/noticias/'], limit: 2 });

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.url?.includes('/noticias/'))).toBe(true);
  });
});

describe('parseNewsSitemap', () => {
  it('lee los artículos y se salta las páginas que no son noticias', async () => {
    const items = parseNewsSitemap(await leer('sitemap-noticias.xml'), fuente);

    expect(items).toHaveLength(4);
    expect(items.some((item) => item.url?.endsWith('/aviso-legal'))).toBe(false);
  });

  it('los ordena del más reciente al más antiguo, aunque el sitemap no lo haga', async () => {
    const items = parseNewsSitemap(await leer('sitemap-noticias.xml'), fuente);

    expect(items.map((item) => item.publishedAt)).toEqual([
      '2026-09-21T09:30:00.000+02:00',
      '2026-09-21T08:00:00.000+02:00',
      '2026-09-21T07:00:00.000+02:00',
      '2026-09-20T12:00:00.000+02:00',
    ]);
  });

  it('decodifica las entidades del titular y no inventa un resumen', async () => {
    const [, , bici] = parseNewsSitemap(await leer('sitemap-noticias.xml'), fuente);

    expect(bici?.title).toBe('El pleno aprueba el carril bici de la avenida & la ronda');
    expect(bici?.summary).toBeUndefined();
  });

  it('filtra por la sección de la ruta: fuera la opinión y la comarca', async () => {
    const items = parseNewsSitemap(await leer('sitemap-noticias.xml'), {
      ...fuente,
      includePaths: ['/villa/'],
    });

    expect(items.map((item) => item.title)).toEqual([
      'Corte de agua en el centro el martes',
      'El pleno aprueba el carril bici de la avenida & la ronda',
    ]);
  });

  it('aplica el tope a lo más reciente', async () => {
    const items = parseNewsSitemap(await leer('sitemap-noticias.xml'), { ...fuente, limit: 1 });

    expect(items.map((item) => item.title)).toEqual(['Corte de agua en el centro el martes']);
  });

  it('devuelve una lista vacía con algo que no es un sitemap', () => {
    expect(parseNewsSitemap('<html><body>no</body></html>', fuente)).toEqual([]);
  });
});
