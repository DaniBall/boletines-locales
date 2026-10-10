import { FESTIVOS_NACIONALES_2026 } from '../festivos-comunes.ts';

/**
 * Días sin edición en León. Fuentes:
 * - Castilla y León: Decreto 9/2025, de 29 de mayo (BOCYL núm. 103, 02-06-2025).
 * - Locales de León: resolución de fiestas de 2026 de la Universidad de León,
 *   que recoge las del municipio. Falta contrastarlas con el anuncio de la
 *   Oficina Territorial de Trabajo en el BOP de León (17-09-2025).
 */
export const festivos: readonly string[] = [
  ...FESTIVOS_NACIONALES_2026,
  '2026-04-02', // Jueves Santo
  '2026-04-23', // Fiesta de la Comunidad
  '2026-06-24', // Local: San Juan
  '2026-10-05', // Local: San Froilán
  '2026-11-02', // Lunes siguiente a Todos los Santos
  '2026-12-07', // Lunes siguiente al Día de la Constitución
].toSorted();
