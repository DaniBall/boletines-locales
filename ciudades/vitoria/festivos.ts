import { FESTIVOS_NACIONALES_2026 } from '../festivos-comunes.ts';

/**
 * Días sin edición en Vitoria-Gasteiz. Fuentes:
 * - Euskadi: Decreto 82/2025, de 8 de abril (BOPV núm. 78, 25-04-2025). En 2026
 *   el 1 de noviembre y el 6 de diciembre caen en domingo y Euskadi no los
 *   traslada al lunes: en su lugar fija el 19 de marzo y el 25 de julio.
 * - Locales de Vitoria-Gasteiz: resolución de la Delegación Territorial de
 *   Trabajo de Álava (BOTHA núm. 82, 21-07-2025) para el 5 de agosto; el 28 de
 *   abril, según los días inhábiles del Ayuntamiento.
 */
export const festivos: readonly string[] = [
  ...FESTIVOS_NACIONALES_2026,
  '2026-03-19', // San José
  '2026-04-02', // Jueves Santo
  '2026-04-06', // Lunes de Pascua
  '2026-04-28', // Local: San Prudencio
  '2026-07-25', // Santiago Apóstol (sábado)
  '2026-08-05', // Local: Virgen Blanca
].toSorted();
