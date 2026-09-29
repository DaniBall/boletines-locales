import type { CityConfig } from '../../pipeline/types.ts';
import { seccionesComunes } from '../secciones-comunes.ts';

const name = 'Vitoria-Gasteiz';

export const vitoria: CityConfig = {
  id: 'vitoria',
  name,

  // Provisional: el nombre y el dominio están sin decidir.
  brand: {
    name: `Boletín de ${name}`,
    domain: 'https://boletin-vitoria.dbolamartinez.workers.dev',
    channelUrl: '',
  },

  // El municipio coincide con la Cuadrilla de Vitoria, concejos incluidos.
  scope: ['Vitoria-Gasteiz'],

  aemetMunicipality: '01059',
  // fuelMunicipalityId: pendiente del listado de la provincia.

  sections: [
    ...seccionesComunes(name),
    // Propias, a validar.
    { id: 'tuvisa', title: '🚋 TUVISA y tranvía', writer: 'code' },
    { id: 'anillo_verde', title: '🌳 Anillo Verde', writer: 'ai' },
  ],

  collectors: [],

  holidays: [],
};
