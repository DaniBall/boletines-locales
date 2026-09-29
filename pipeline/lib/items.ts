/**
 * Identidad de los items. El id tiene que ser estable entre ejecuciones: es lo
 * que Claude cita en `item_id` y lo que el validador comprueba (regla 2).
 */
import { createHash } from 'node:crypto';
import { urlKey } from './dedupe.ts';

/**
 * `hash(fuente + url o título)`. La URL se reduce antes a su identidad, para
 * que el mismo artículo con parámetros de seguimiento distintos no cambie de id.
 */
export function makeItemId(source: string, urlOrTitle: string): string {
  const clave = /^https?:\/\//i.test(urlOrTitle) ? urlKey(urlOrTitle) : urlOrTitle.trim();
  const hash = createHash('sha256').update(`${source}\n${clave}`).digest('hex').slice(0, 12);
  return `${source}:${hash}`;
}
