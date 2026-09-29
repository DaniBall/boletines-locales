/**
 * Agenda del Ayuntamiento de Jaén. No tiene RSS (el servicio que da el de
 * noticias responde 500 para la agenda), así que se lee su listado HTML: una
 * tabla con Título, Fecha y Precio. Es la vista «Actividades de la semana»,
 * que cabe en una sola página y cubre el fin de semana para la edición del
 * viernes.
 *
 * Es propio de Jaén y por eso vive aquí y no en el motor (regla 8).
 */
import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { TIMEZONE } from '../../../pipeline/config.ts';
import { makeItemId } from '../../../pipeline/lib/items.ts';
import type { Collector, Item } from '../../../pipeline/types.ts';

const BASE = 'https://www.aytojaen.es/portal/';
export const AGENDA_SEMANA_URL = `${BASE}p_138_contenedoragenda.jsp?seccion=s_lact_d11_v1.jsp&codbusqueda=78&layout=p_138_contenedoragenda.jsp&codResi=1&language=es&codMenu=95&codMenuPN=2`;

const ID = 'ayto-jaen-agenda';

export function agendaAyuntamientoJaen(): Collector {
  return {
    id: ID,
    section: 'agenda',
    async collect(ctx) {
      const { body } = await ctx.http.get(AGENDA_SEMANA_URL);
      return parseAgenda(body);
    },
  };
}

/** Lo que dice la columna de precio cuando la actividad ya no se celebra. */
const ANULADA = /suspendid|cancelad|aplazad|anulad/i;

export function parseAgenda(html: string): Item[] {
  const $ = load(html);
  const items: Item[] = [];

  $('a.linkTb01[href*="contenido="]').each((_, enlace) => {
    const fila = $(enlace).closest('tr');
    const celdas = fila.find('td');
    const title = $(enlace).text().replace(/\s+/g, ' ').trim();
    const fechas = parseRango(celdas.eq(2).text());
    const precio = celdas.eq(3).text().replace(/\s+/g, ' ').trim();
    const href = $(enlace).attr('href');
    if (title === '' || fechas === undefined || href === undefined) return;
    if (ANULADA.test(precio)) return;

    const url = new URL(href, BASE).toString();
    const item: Item = {
      id: makeItemId(ID, url),
      source: ID,
      section: 'agenda',
      title,
      url,
      startsAt: fechas.desde,
      endsAt: fechas.hasta,
    };
    if (precio !== '') item.summary = `Precio: ${precio}`;
    items.push(item);
  });

  return items;
}

const MESES: Record<string, number> = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

/** «02 oct. 2026 - 04 oct. 2026» → inicio y fin del tramo, en hora de Madrid. */
export function parseRango(texto: string): { desde: string; hasta: string } | undefined {
  const fechas = [...texto.toLowerCase().matchAll(/(\d{1,2})\s+([a-zñ]+)\.?\s+(\d{4})/g)].flatMap(
    ([, dia, mes, anio]) => {
      const numeroMes = mes === undefined ? undefined : MESES[mes];
      if (dia === undefined || anio === undefined || numeroMes === undefined) return [];
      const fecha = DateTime.fromObject(
        { year: Number(anio), month: numeroMes, day: Number(dia) },
        { zone: TIMEZONE },
      );
      return fecha.isValid ? [fecha] : [];
    },
  );

  const [desde, hasta = desde] = fechas;
  if (desde === undefined || hasta === undefined) return undefined;
  // Sin hora en el listado: el tramo va del principio del primer día al final
  // del último, que es lo que necesita `select` para saber si «es hoy».
  return {
    desde: desde.startOf('day').toISO() ?? '',
    hasta: hasta.endOf('day').toISO() ?? '',
  };
}
