/**
 * Agenda del Ayuntamiento de Jaén. No tiene RSS (el servicio que da el de
 * noticias responde 500 para la agenda), así que se lee su listado HTML: una
 * tabla con Título, Fecha y Precio. Es la vista «Actividades de la semana»,
 * que cabe en una sola página y cubre el fin de semana para la edición del
 * viernes.
 *
 * El listado solo trae título, fecha y precio. Para que la redacción no tenga
 * que adivinar, se lee además la ficha de cada actividad (una petición por
 * página y ejecución, con caché): descripción, lugar y horario. Si una ficha
 * falla, la actividad sigue con lo del listado.
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
    name: 'Ayuntamiento de Jaén',
    homepage: 'https://www.aytojaen.es/',
    async collect(ctx) {
      const { body } = await ctx.http.get(AGENDA_SEMANA_URL);
      const items = parseAgenda(body);
      const fichas = await Promise.allSettled(
        items.map(async (item) =>
          item.url === undefined ? undefined : parseFicha((await ctx.http.get(item.url)).body),
        ),
      );
      return items.map((item, i) => {
        const ficha = fichas[i];
        return ficha?.status === 'fulfilled' && ficha.value !== undefined
          ? completarConFicha(item, ficha.value, ctx.city.name)
          : item;
      });
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

/** Lo que trae la ficha de una actividad. */
export interface Ficha {
  descripcion?: string;
  lugar?: string;
  /** «20:30 h», tal cual. */
  horario?: string;
}

/** Máximo de descripción que se guarda: basta para redactar dos frases. */
const MAX_DESCRIPCION = 500;

/**
 * La ficha es una secuencia plana de párrafos: primero la descripción y luego
 * bloques con etiqueta («Precio:», «Lugar celebración:», «Otros datos de
 * interés:») seguidos de sus párrafos.
 */
export function parseFicha(html: string): Ficha {
  const $ = load(html);
  const descripcion: string[] = [];
  const bloques = new Map<string, string[]>();
  let actual: string | undefined;

  $('#colD')
    .first()
    .find('p')
    .each((_, p) => {
      const clase = $(p).attr('class') ?? '';
      if (clase === 'herramientas' || clase === 'descdch') return;
      const texto = $(p).clone().children('p').remove().end().text().replace(/\s+/g, ' ').trim();
      if (texto === '') return;

      const etiqueta = /^([^:]{3,40}):\s*(.*)$/.exec(texto);
      if (clase === 'ficha' && etiqueta?.[1] !== undefined) {
        actual = normalizarEtiqueta(etiqueta[1]);
        bloques.set(actual, etiqueta[2] ? [etiqueta[2]] : []);
        return;
      }
      if (actual === undefined) descripcion.push(texto);
      else bloques.get(actual)?.push(texto);
    });

  const ficha: Ficha = {};
  const texto = descripcion.join(' ');
  if (texto !== '') {
    ficha.descripcion =
      texto.length <= MAX_DESCRIPCION ? texto : `${texto.slice(0, MAX_DESCRIPCION - 1)}…`;
  }
  // Algunos lugares vienen con punto final («Jardines de Jabalcuz.»).
  const lugar = bloques.get('lugar celebracion')?.[0]?.replace(/\.+$/, '');
  if (lugar) ficha.lugar = lugar;
  for (const linea of bloques.get('otros datos de interes') ?? []) {
    const horario = /horario:\s*(.+)/i.exec(linea)?.[1]?.trim();
    if (horario) {
      ficha.horario = horario;
      break;
    }
  }
  return ficha;
}

function normalizarEtiqueta(etiqueta: string): string {
  return etiqueta
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Suma la ficha al item: el resumen lleva precio y horario delante (son lo que
 * más importa y así sobreviven a cualquier recorte) y después la descripción.
 * El lugar se completa con la ciudad, porque es su agenda municipal y el
 * filtro de alcance de `select` necesita reconocerla.
 */
export function completarConFicha(item: Item, ficha: Ficha, ciudad: string): Item {
  const partes = [
    item.summary,
    ficha.horario === undefined ? undefined : `Horario: ${ficha.horario}`,
    ficha.descripcion,
  ].filter((parte): parte is string => parte !== undefined && parte !== '');

  const completo: Item = { ...item };
  if (partes.length > 0) completo.summary = partes.join('. ').replace(/\.\./g, '.');
  if (ficha.lugar !== undefined) {
    completo.place = ficha.lugar.toLowerCase().includes(ciudad.toLowerCase())
      ? ficha.lugar
      : `${ficha.lugar}, ${ciudad}`;
  }
  return completo;
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
