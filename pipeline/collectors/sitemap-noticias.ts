/**
 * Colector genérico de sitemaps de noticias (el formato de Google News).
 *
 * Hay medios que no publican RSS pero sí este sitemap, porque es lo que les
 * pide Google para indexar sus noticias: una lista de los artículos recientes
 * con su titular y su fecha. Está hecho para que lo lean máquinas, así que es
 * una fuente tan legítima como un feed.
 *
 * No trae resumen: a Claude solo le llega el titular, así que decide con menos
 * contexto que con un feed. Por eso, en una ciudad, conviene declararlo detrás
 * de los feeds: ante un duplicado gana la primera aparición, la que tiene
 * resumen.
 */
import { DateTime } from 'luxon';
import { makeItemId } from '../lib/items.ts';
import type { Collector, Item } from '../types.ts';
import {
  crearParser,
  fechaIso,
  limpiarHtml,
  pasaFiltroDeRuta,
  texto,
  type Nodo,
  type PathFilter,
} from './comun.ts';

export interface NewsSitemapCollectorOptions extends PathFilter {
  /** 'sitemap-diario-jaen'. Es también el `source` de sus items. */
  id: string;
  url: string;
  section: string;
  /** Artículos que se quedan, de los más recientes. */
  limit?: number;
}

const DEFAULT_LIMIT = 20;

export function newsSitemapCollector(options: NewsSitemapCollectorOptions): Collector {
  return {
    id: options.id,
    section: options.section,
    async collect(ctx) {
      const { body } = await ctx.http.get(options.url);
      return parseNewsSitemap(body, options);
    },
  };
}

const parser = crearParser(['url']);

/** De un sitemap de noticias a items del pipeline, del más reciente al más antiguo. */
export function parseNewsSitemap(
  xml: string,
  source: Omit<NewsSitemapCollectorOptions, 'url'>,
): Item[] {
  const doc = parser.parse(xml) as Nodo;
  const urlset = doc.urlset as Nodo | undefined;
  const entradas = Array.isArray(urlset?.url) ? (urlset.url as Nodo[]) : [];

  const items: Item[] = [];
  for (const entrada of entradas) {
    // Una URL sin su bloque de noticia es una página normal del sitio.
    const noticia = entrada.news as Nodo | undefined;
    if (noticia === undefined) continue;

    const url = texto(entrada.loc).trim();
    const title = limpiarHtml(texto(noticia.title));
    if (url === '' || title === '') continue;
    if (!pasaFiltroDeRuta(url, source)) continue;

    const item: Item = {
      id: makeItemId(source.id, url),
      source: source.id,
      section: source.section,
      title,
      url,
    };
    const publishedAt = fechaIso(texto(noticia.publication_date));
    if (publishedAt !== undefined) item.publishedAt = publishedAt;

    items.push(item);
  }

  // El sitemap no garantiza ningún orden: el tope se aplica a lo más reciente.
  items.sort((a, b) => fechaOrden(b) - fechaOrden(a));
  return items.slice(0, source.limit ?? DEFAULT_LIMIT);
}

function fechaOrden(item: Item): number {
  return item.publishedAt === undefined ? 0 : DateTime.fromISO(item.publishedAt).toMillis();
}
