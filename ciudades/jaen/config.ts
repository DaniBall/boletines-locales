import { fuelCollector } from '../../pipeline/collectors/carburantes.ts';
import { rssCollector } from '../../pipeline/collectors/rss.ts';
import { newsSitemapCollector } from '../../pipeline/collectors/sitemap-noticias.ts';
import type { CityConfig } from '../../pipeline/types.ts';
import { seccionesComunes } from '../secciones-comunes.ts';
import { agendaAyuntamientoJaen } from './collectors/agenda-ayuntamiento.ts';

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
  // IDMunicipio del listado de la provincia 23 en la API del Ministerio.
  fuelMunicipalityId: '3543',

  sections: [
    ...seccionesComunes(name),
    // Propia: el precio en origen, del día anterior.
    { id: 'aceite', title: '🫒 El aceite', writer: 'code' },
  ],

  // Verificados el 29 de septiembre de 2026: responden, su robots.txt los
  // permite y pasan por el colector sin tocar nada. El orden importa: ante un
  // duplicado gana el primero, así que van delante los que traen resumen.
  collectors: [
    // Diez noticias locales, todas con resumen.
    rssCollector({
      id: 'rss-hora-jaen',
      url: 'https://www.horajaen.com/feed/',
      section: 'te_afecta',
    }),
    // Mezcla capital y provincia; la ruta dice cuál es cuál.
    rssCollector({
      id: 'rss-ideal-jaen',
      url: 'https://www.ideal.es/rss/2.0/?section=jaen',
      section: 'te_afecta',
      includePaths: ['/jaen/jaen/'],
    }),
    // Viva Jaén vive ahora en Andalucía Información. De sus feeds por sección,
    // solo el local: los demás son lentos y más provinciales.
    rssCollector({
      id: 'rss-viva-jaen',
      url: 'https://www.andaluciainformacion.es/rss/jaen-local/',
      section: 'te_afecta',
    }),
    // Notas de prensa del Ayuntamiento: fuente primaria, pero sin resumen y
    // con poca frecuencia. Su RSS no se anuncia en la web y viene en
    // ISO-8859-1 declarado solo dentro del XML.
    rssCollector({
      id: 'ayto-jaen-noticias',
      url: 'https://www.aytojaen.es/portal/p_26_RSS_Noticias.jsp?codbusqueda=2&language=es',
      section: 'te_afecta',
    }),
    // Sin RSS, pero con sitemap de noticias. No trae resumen; la ruta separa la
    // capital (/jaen/) de la provincia, la opinión y los deportes.
    newsSitemapCollector({
      id: 'sitemap-diario-jaen',
      url: 'https://www.diariojaen.es/sitemapforgoogle.xml',
      section: 'te_afecta',
      includePaths: ['/jaen/'],
    }),
    fuelCollector(),
    agendaAyuntamientoJaen(),
  ],

  holidays: [],
};
