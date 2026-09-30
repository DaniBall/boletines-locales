import { DateTime } from 'luxon';
import { LOCALE, TIMEZONE } from '../config.ts';

/** Una fecha de edición, siempre AAAA-MM-DD en Europe/Madrid. */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_DAY = /^\d{2}-\d{2}$/;

export function parseIsoDate(date: IsoDate): DateTime {
  if (!ISO_DATE.test(date)) {
    throw new Error(`Fecha inválida: "${date}". Se espera AAAA-MM-DD.`);
  }
  const dt = DateTime.fromISO(date, { zone: TIMEZONE });
  if (!dt.isValid) {
    throw new Error(`Fecha inválida: "${date}". ${dt.invalidReason ?? ''}`.trim());
  }
  return dt.setLocale(LOCALE);
}

/** Hoy en Europe/Madrid, con el cambio de hora incluido. */
export function today(now: DateTime = DateTime.now()): IsoDate {
  return now.setZone(TIMEZONE).toISODate() as IsoDate;
}

/** «lunes 21 de septiembre de 2026», para el saludo y la web. */
export function longDate(date: IsoDate): string {
  return parseIsoDate(date).toFormat("cccc d 'de' LLLL 'de' yyyy");
}

/** «Miércoles 30 de septiembre», para el saludo: sin año y con mayúscula. */
export function greetingDate(date: IsoDate): string {
  const texto = parseIsoDate(date).toFormat("cccc d 'de' LLLL");
  return texto.charAt(0).toLocaleUpperCase(LOCALE) + texto.slice(1);
}

/** «lunes», en minúsculas. */
export function weekdayName(date: IsoDate): string {
  return parseIsoDate(date).toFormat('cccc');
}

/** De lunes a viernes. */
export function isWorkday(date: IsoDate): boolean {
  return parseIsoDate(date).weekday <= 5;
}

export function isFriday(date: IsoDate): boolean {
  return parseIsoDate(date).weekday === 5;
}

/** Los festivos son de cada ciudad, así que llegan por parámetro. */
export function isHoliday(date: IsoDate, holidays: readonly string[]): boolean {
  return holidays.includes(date);
}

/** Hay edición de lunes a viernes, salvo festivos de esa ciudad. */
export function hasEdition(date: IsoDate, holidays: readonly string[]): boolean {
  return isWorkday(date) && !isHoliday(date, holidays);
}

/** Las `days` fechas anteriores a `date`, de la más reciente a la más antigua. */
export function previousDates(date: IsoDate, days: number): IsoDate[] {
  const start = parseIsoDate(date);
  return Array.from(
    { length: days },
    (_, i) => start.minus({ days: i + 1 }).toISODate() as IsoDate,
  );
}

/** Suma (o resta, con negativos) días a una fecha de edición. */
export function shiftDate(date: IsoDate, days: number): IsoDate {
  return parseIsoDate(date).plus({ days }).toISODate() as IsoDate;
}

/**
 * El día al que pertenece un instante ISO, ya en Europe/Madrid. Las fuentes dan
 * las horas en su propio formato: un evento a las 00:30 con zona UTC es de la
 * madrugada de aquí, no del día anterior.
 */
export function toIsoDate(value: string): IsoDate | undefined {
  const dt = DateTime.fromISO(value, { zone: TIMEZONE });
  return dt.isValid ? dt.toISODate() : undefined;
}

/**
 * Si una sección de temporada está activa en esa fecha. `from` y `to` son MM-DD
 * y el tramo puede cruzar el cambio de año (por ejemplo, del 11-01 al 03-31).
 */
export function inSeason(date: IsoDate, season: { from: string; to: string }): boolean {
  for (const value of [season.from, season.to]) {
    if (!MONTH_DAY.test(value)) {
      throw new Error(`Temporada inválida: "${value}". Se espera MM-DD.`);
    }
  }
  const monthDay = parseIsoDate(date).toFormat('MM-dd');
  return season.from <= season.to
    ? monthDay >= season.from && monthDay <= season.to
    : monthDay >= season.from || monthDay <= season.to;
}

/**
 * El YAML sin comillas convierte `2026-09-18` en un `Date` a medianoche UTC.
 * Esto lo devuelve siempre como AAAA-MM-DD, venga como cadena o como fecha.
 */
export function normalizeIsoDate(value: string | Date): IsoDate {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Fecha inválida en el frontmatter.');
    return value.toISOString().slice(0, 10);
  }
  return parseIsoDate(value).toISODate() as IsoDate;
}
