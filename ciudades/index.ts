/**
 * Registro de ciudades: la única puerta de entrada. `src/` y `scripts/` llegan
 * a las ciudades por aquí y nunca importan una config suelta. `pipeline/` no
 * importa este archivo (regla 8, y una regla de lint lo impide).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CityConfig } from '../pipeline/types.ts';
import { jaen } from './jaen/config.ts';
import { leon } from './leon/config.ts';
import { vitoria } from './vitoria/config.ts';

/** En el orden en el que entran en producción. */
export const ciudades: readonly CityConfig[] = [jaen, leon, vitoria];

export const idsCiudades: readonly string[] = ciudades.map((ciudad) => ciudad.id);

export function buscarCiudad(id: string): CityConfig | undefined {
  return ciudades.find((ciudad) => ciudad.id === id);
}

/** Como `buscarCiudad`, pero falla con un mensaje útil si el id no existe. */
export function getCiudad(id: string): CityConfig {
  const ciudad = buscarCiudad(id);
  if (!ciudad) {
    throw new Error(`No existe la ciudad "${id}". Las que hay: ${idsCiudades.join(', ')}.`);
  }
  return ciudad;
}

/**
 * La ciudad del build o del comando en curso, que llega por la variable
 * `CIUDAD`. Cada web se construye una vez por ciudad: `CIUDAD=jaen npm run build`.
 */
export function ciudadActual(): CityConfig {
  const id = process.env.CIUDAD;
  if (!id) {
    throw new Error(`Falta la variable CIUDAD. Ejemplo: CIUDAD=${idsCiudades[0]} npm run build.`);
  }
  return getCiudad(id);
}

/** El toque local de la guía de estilo (`ciudades/<id>/prompts/local.md`), si lo hay. */
export async function cargarPromptLocal(id: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(import.meta.dirname, id, 'prompts', 'local.md'), 'utf8');
  } catch {
    return undefined;
  }
}
