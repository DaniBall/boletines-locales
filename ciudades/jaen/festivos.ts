import { FESTIVOS_NACIONALES_2026 } from '../festivos-comunes.ts';

/**
 * Días sin edición en Jaén. Fuentes:
 * - Andalucía: Decreto 101/2025, de 14 de mayo (BOJA núm. 93, 19-05-2025).
 * - Locales de Jaén: Resolución de 6 de octubre de 2025 de la Dirección General
 *   de Trabajo, Seguridad y Salud Laboral (BOJA núm. 197, 14-10-2025). Sus
 *   modificaciones de 18-12-2025, 12-02-2026 y 20-04-2026 no tocan la capital.
 */
export const festivos: readonly string[] = [
  ...FESTIVOS_NACIONALES_2026,
  '2026-02-28', // Día de Andalucía (sábado)
  '2026-04-02', // Jueves Santo
  '2026-06-11', // Local: Virgen de la Capilla
  '2026-11-02', // Lunes siguiente a Todos los Santos
  '2026-11-25', // Local: Santa Catalina
  '2026-12-07', // Lunes siguiente al Día de la Constitución
].toSorted();
