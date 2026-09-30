import { aemetCollector } from '../../pipeline/collectors/aemet.ts';
import { fuelCollector } from '../../pipeline/collectors/carburantes.ts';
import type { CityConfig } from '../../pipeline/types.ts';
import { seccionesComunes } from '../secciones-comunes.ts';

const name = 'León';

export const leon: CityConfig = {
  id: 'leon',
  name,

  // Provisional: el nombre y el dominio están sin decidir.
  brand: {
    name: `Boletín de ${name}`,
    domain: 'https://boletin-leon.dbolamartinez.workers.dev',
    channelUrl: '',
  },

  // La capital y su alfoz.
  scope: ['León', 'San Andrés del Rabanedo', 'Villaquilambre', 'Valverde de la Virgen', 'Sariegos'],

  aemetMunicipality: '24089',
  // IDMunicipio del listado de la provincia 24 en la API del Ministerio.
  fuelMunicipalityId: '3674',

  sections: [
    ...seccionesComunes(name),
    // Propias, a validar. La de nieve solo aparece en invierno.
    {
      id: 'carreteras',
      title: '❄️ Carreteras y nieve',
      writer: 'code',
      season: { from: '11-01', to: '03-31' },
    },
    { id: 'tapa', title: '🍢 La tapa', writer: 'ai' },
  ],

  collectors: [aemetCollector(), fuelCollector()],

  holidays: [],
};
