import type { CityConfig } from '../../pipeline/types.ts';
import { seccionesComunes } from '../secciones-comunes.ts';

const name = 'Jaén';

export const jaen: CityConfig = {
  id: 'jaen',
  name,

  // Provisional. Candidatos al nombre: «El Lagarto», «Pipirrana».
  brand: {
    name: `Boletín de ${name}`,
    domain: 'https://boletin-jaen.dbolamartinez.workers.dev',
    channelUrl: '',
  },

  // La capital y lo del entorno que afecte a quien vive en ella.
  scope: [
    'Jaén',
    'La Guardia de Jaén',
    'Los Villares',
    'Mancha Real',
    'Torredelcampo',
    'Torredonjimeno',
  ],

  aemetMunicipality: '23050',
  // fuelMunicipalityId: pendiente de sacarlo del listado de la provincia en la
  // API del Ministerio. Mientras no esté, la sección de carburantes se omite.

  sections: [
    ...seccionesComunes(name),
    // Propia: el precio en origen, del día anterior.
    { id: 'aceite', title: '🫒 El aceite', writer: 'code' },
  ],

  collectors: [],

  holidays: [],
};
