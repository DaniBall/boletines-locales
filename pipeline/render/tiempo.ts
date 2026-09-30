/**
 * Plantilla de «☀️ El tiempo». Determinista: las cifras salen de AEMET y el
 * texto, de aquí (regla 1). Una sola línea, que es lo que se lee de un vistazo:
 *
 *   Máxima de 32° y mínima de 18°. Poco nuboso. Viento del oeste a 30 km/h,
 *   con rachas de 55 km/h. Fuente: AEMET.
 *
 * Solo se menciona lo que cambia el día: la lluvia desde el 20 % de
 * probabilidad, el viento desde 20 km/h, las rachas desde 40 km/h y el UV
 * desde 8 (muy alto).
 */
import type { WeatherData } from '../collectors/aemet.ts';
import { LOCALE } from '../config.ts';
import type { Item } from '../types.ts';

const UMBRAL_LLUVIA = 20;
const UMBRAL_VIENTO = 20;
const UMBRAL_RACHA = 40;
const UMBRAL_UV = 8;

const DIRECCIONES: Readonly<Record<string, string>> = {
  N: 'del norte',
  NE: 'del nordeste',
  E: 'del este',
  SE: 'del sureste',
  S: 'del sur',
  SO: 'del suroeste',
  O: 'del oeste',
  NO: 'del noroeste',
};

/** La línea de la sección, o ninguna si no hay datos: nunca «sin información». */
export function renderWeatherLines(items: readonly Item[]): string[] {
  const [dato] = items.flatMap((item) => (esWeatherData(item.data) ? [item.data] : []));
  if (dato === undefined) return [];

  const frases = [`Máxima de ${grados(dato.maxima)} y mínima de ${grados(dato.minima)}.`];
  if (dato.cielo !== undefined) frases.push(`${mayuscula(dato.cielo)}.`);
  if (dato.lluvia !== undefined && dato.lluvia >= UMBRAL_LLUVIA) {
    frases.push(`Probabilidad de lluvia del ${String(Math.round(dato.lluvia))} %.`);
  }

  const viento = frasesDeViento(dato);
  if (viento !== undefined) frases.push(viento);

  if (dato.uv !== undefined && dato.uv >= UMBRAL_UV) {
    frases.push(`Índice UV de ${String(Math.round(dato.uv))}, muy alto: protégete del sol.`);
  }

  frases.push('Fuente: AEMET.');
  return [frases.join(' ')];
}

function frasesDeViento(dato: WeatherData): string | undefined {
  const racha =
    dato.racha !== undefined && dato.racha >= UMBRAL_RACHA ? Math.round(dato.racha) : undefined;
  const viento =
    dato.viento !== undefined && dato.viento.velocidad >= UMBRAL_VIENTO ? dato.viento : undefined;

  if (viento !== undefined) {
    const direccion = DIRECCIONES[viento.direccion];
    const base = `Viento${direccion === undefined ? '' : ` ${direccion}`} a ${String(Math.round(viento.velocidad))} km/h`;
    return racha === undefined ? `${base}.` : `${base}, con rachas de ${String(racha)} km/h.`;
  }
  return racha === undefined ? undefined : `Rachas de viento de hasta ${String(racha)} km/h.`;
}

function grados(valor: number): string {
  return `${String(Math.round(valor))}°`;
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase(LOCALE) + texto.slice(1);
}

/** `data` llega sin tipo: se comprueba antes de fiarse de él. */
function esWeatherData(data: unknown): data is WeatherData {
  if (data === null || typeof data !== 'object') return false;
  const dato = data as Partial<WeatherData>;
  return typeof dato.maxima === 'number' && typeof dato.minima === 'number';
}
