/**
 * El viernes, la agenda del sábado y el domingo va a «Este finde». Los ids de
 * sección llegan por parámetro: el motor no conoce ninguno (regla 8).
 */
import { isFriday, shiftDate, toIsoDate, type IsoDate } from '../lib/fechas.ts';
import type { Item } from '../types.ts';

export interface WeekendRoute {
  /** Sección de la agenda del día: 'agenda'. */
  from: string;
  /** Sección del fin de semana: 'finde'. */
  to: string;
}

/**
 * Pasa a `to` los eventos de `from` que empiezan el sábado o el domingo. Lo que
 * ya está en marcha el viernes se queda en la agenda del día. Otro día que no
 * sea viernes, no toca nada.
 */
export function routeWeekend(items: readonly Item[], date: IsoDate, route: WeekendRoute): Item[] {
  if (!isFriday(date)) return [...items];

  const sabado = shiftDate(date, 1);
  const domingo = shiftDate(date, 2);
  return items.map((item) => {
    if (item.section !== route.from || item.startsAt === undefined) return item;
    const empieza = toIsoDate(item.startsAt);
    return empieza === sabado || empieza === domingo ? { ...item, section: route.to } : item;
  });
}
