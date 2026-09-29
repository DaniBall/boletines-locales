/**
 * Colector de precios de carburantes: la API REST del Ministerio, abierta y sin
 * clave, que se actualiza cada media hora.
 *
 * Es una sección determinista (regla 1): el colector deja los precios en
 * `data` y la plantilla de `render/carburantes.ts` escribe el texto. Claude no
 * toca una sola cifra.
 *
 * El municipio sale de `city.fuelMunicipalityId`, que es el `IDMunicipio` del
 * listado provincial de la propia API.
 */
import { DateTime } from 'luxon';
import { z } from 'zod';
import { TIMEZONE } from '../config.ts';
import { makeItemId } from '../lib/items.ts';
import type { Collector, Item } from '../types.ts';

export const FUEL_API =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes';

export interface FuelProduct {
  /** Campo de la API, tal cual: 'Precio Gasoleo A'. */
  field: string;
  /** Como lo lee la gente: 'Gasóleo A'. */
  name: string;
}

/** Los dos que llena casi todo el mundo. */
export const DEFAULT_FUEL_PRODUCTS: readonly FuelProduct[] = [
  { field: 'Precio Gasoleo A', name: 'Gasóleo A' },
  { field: 'Precio Gasolina 95 E5', name: 'Gasolina 95' },
];

export interface FuelCollectorOptions {
  id?: string;
  section?: string;
  products?: readonly FuelProduct[];
}

/** Lo que el colector deja en `data` de cada item, uno por producto. */
export interface FuelData {
  producto: string;
  /** Euros por litro. */
  precio: number;
  /** Todas las estaciones empatadas en el precio mínimo, por orden de rótulo. */
  estaciones: { rotulo: string; direccion: string; horario: string }[];
  /** Momento de los precios, según el Ministerio, en ISO. */
  actualizado?: string;
}

export function fuelCollector(options: FuelCollectorOptions = {}): Collector {
  const id = options.id ?? 'carburantes';
  const section = options.section ?? 'carburantes';
  return {
    id,
    section,
    async collect(ctx) {
      const municipio = ctx.city.fuelMunicipalityId;
      // Sin municipio configurado no hay nada que pedir: la sección se omite.
      if (municipio === undefined) return [];

      const respuesta = await ctx.http.getJson<unknown>(
        `${FUEL_API}/EstacionesTerrestres/FiltroMunicipio/${encodeURIComponent(municipio)}`,
      );
      return parseFuelPrices(respuesta, { ...options, id, section });
    },
  };
}

/**
 * Lo mínimo que se necesita de la respuesta. Las estaciones se validan como
 * diccionarios de texto y no campo a campo: el Ministerio añade combustibles
 * nuevos de vez en cuando y eso no debe romper la sección.
 */
const respuestaSchema = z.object({
  Fecha: z.string(),
  ResultadoConsulta: z.string(),
  ListaEESSPrecio: z.array(z.record(z.string(), z.string())),
});

export function parseFuelPrices(
  respuesta: unknown,
  options: FuelCollectorOptions & { id: string; section: string },
): Item[] {
  const datos = respuestaSchema.parse(respuesta);
  if (datos.ResultadoConsulta !== 'OK') {
    throw new Error(`El Ministerio respondió «${datos.ResultadoConsulta}».`);
  }

  const actualizado = fechaDelMinisterio(datos.Fecha);
  // Las de venta restringida (cooperativas, solo para socios) no le valen al
  // lector: publicar su precio como «el más barato» sería engañarle.
  const estaciones = datos.ListaEESSPrecio.filter((estacion) => estacion['Tipo Venta'] !== 'R');

  const items: Item[] = [];
  for (const producto of options.products ?? DEFAULT_FUEL_PRODUCTS) {
    const conPrecio = estaciones.flatMap((estacion) => {
      const precio = parsePrecio(estacion[producto.field]);
      return precio === undefined ? [] : [{ estacion, precio }];
    });
    if (conPrecio.length === 0) continue;

    const minimo = Math.min(...conPrecio.map((entrada) => entrada.precio));
    // Los empates son lo normal: se nombran todos, en orden neutral, para no
    // elegir por el lector (y que nadie pueda ver ahí un trato de favor).
    const empatadas = conPrecio
      .filter((entrada) => milesimas(entrada.precio) === milesimas(minimo))
      .map(({ estacion }) => ({
        rotulo: (estacion['Rótulo'] ?? '').trim(),
        direccion: (estacion['Dirección'] ?? '').trim(),
        horario: (estacion.Horario ?? '').trim(),
      }))
      .sort(
        (a, b) =>
          a.rotulo.localeCompare(b.rotulo, 'es') || a.direccion.localeCompare(b.direccion, 'es'),
      );

    const data: FuelData = { producto: producto.name, precio: minimo, estaciones: empatadas };
    if (actualizado !== undefined) data.actualizado = actualizado;

    items.push({
      id: makeItemId(options.id, producto.field),
      source: options.id,
      section: options.section,
      title: `${producto.name}, el más barato`,
      data: { ...data },
    });
  }

  return items;
}

/** '1,879' → 1.879. Vacío, cero o ilegible → sin precio. */
export function parsePrecio(valor: string | undefined): number | undefined {
  if (valor === undefined) return undefined;
  const numero = Number.parseFloat(valor.trim().replace(',', '.'));
  return Number.isFinite(numero) && numero > 0 ? numero : undefined;
}

function milesimas(precio: number): number {
  return Math.round(precio * 1000);
}

/** '30/09/2026 0:08:58', en hora de Madrid. */
function fechaDelMinisterio(valor: string): string | undefined {
  const fecha = DateTime.fromFormat(valor.trim(), 'd/M/yyyy H:mm:ss', { zone: TIMEZONE });
  return fecha.isValid ? (fecha.toISO() ?? undefined) : undefined;
}
