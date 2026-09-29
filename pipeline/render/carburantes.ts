/**
 * Plantilla de «⛽ Gasolina más barata». Determinista de principio a fin: las
 * cifras salen del colector y el texto, de aquí (regla 1).
 *
 *   - **Gasóleo A**: 1,879 € en 3 gasolineras: BALLENOIL, ECONOIL y PETROPRIX
 *   - **Gasolina 95**: 1,855 € en SHELL (CARRETERA A-44 KM. 32)
 *   _Precios oficiales del Ministerio, a las 06:15._
 */
import { DateTime } from 'luxon';
import { LOCALE, TIMEZONE } from '../config.ts';
import type { FuelData } from '../collectors/carburantes.ts';
import type { Item } from '../types.ts';

/** Rótulos que se nombran antes de resumir con «y N más». */
const MAX_ROTULOS = 3;

const euros = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const lista = new Intl.ListFormat(LOCALE, { type: 'conjunction' });

/** Las líneas de la sección, o ninguna si no hay datos: nunca «sin información». */
export function renderFuelLines(items: readonly Item[]): string[] {
  const datos = items.flatMap((item) => (esFuelData(item.data) ? [item.data] : []));
  if (datos.length === 0) return [];

  const lineas = datos.map(
    (dato) => `- **${dato.producto}**: ${euros.format(dato.precio)} € ${dondeRepostar(dato)}`,
  );

  const hora = horaDeActualizacion(datos);
  if (hora !== undefined) lineas.push(`_Precios oficiales del Ministerio, a las ${hora}._`);

  return lineas;
}

function dondeRepostar(dato: FuelData): string {
  const [unica] = dato.estaciones;
  if (dato.estaciones.length === 1 && unica !== undefined) {
    return unica.direccion === ''
      ? `en ${unica.rotulo}`
      : `en ${unica.rotulo} (${unica.direccion})`;
  }

  // Varias estaciones de la misma marca no repiten nombre: se cuentan arriba.
  const rotulos = [...new Set(dato.estaciones.map((estacion) => estacion.rotulo))];
  const nombrados = rotulos.slice(0, MAX_ROTULOS);
  const resto = rotulos.length - nombrados.length;
  // «y 1 más» se leería como una gasolinera más; son marcas, y así se dice.
  const otras = resto === 1 ? 'otra marca' : `${String(resto)} marcas más`;
  const nombres = resto > 0 ? `${nombrados.join(', ')} y ${otras}` : lista.format(nombrados);

  return `en ${String(dato.estaciones.length)} gasolineras: ${nombres}`;
}

function horaDeActualizacion(datos: readonly FuelData[]): string | undefined {
  const iso = datos.find((dato) => dato.actualizado !== undefined)?.actualizado;
  if (iso === undefined) return undefined;
  const fecha = DateTime.fromISO(iso, { zone: TIMEZONE });
  return fecha.isValid ? fecha.toFormat('HH:mm') : undefined;
}

/** `data` llega sin tipo: se comprueba antes de fiarse de él. */
function esFuelData(data: unknown): data is FuelData {
  if (data === null || typeof data !== 'object') return false;
  const dato = data as Partial<FuelData>;
  return (
    typeof dato.producto === 'string' &&
    typeof dato.precio === 'number' &&
    Array.isArray(dato.estaciones) &&
    dato.estaciones.length > 0
  );
}
