/**
 * Contratos del motor. Aquí no hay ninguna ciudad: el motor solo sabe que
 * recibe una `CityConfig` y actúa según lo que diga.
 */
import type { HttpClient } from './lib/http.ts';

export interface SectionDef {
  /** 'tiempo', 'agenda', 'aceite'… Único dentro de la ciudad. */
  id: string;
  /** Tal y como sale en la edición, con su emoji: '🫒 El aceite'. */
  title: string;
  /** Quién la escribe: una plantilla determinista o Claude. */
  writer: 'code' | 'ai';
  /** Sección de temporada. MM-DD; puede cruzar el cambio de año. */
  season?: { from: string; to: string };
}

export interface CityConfig {
  /** 'jaen', 'leon', 'vitoria'. Es también el nombre de su carpeta. */
  id: string;
  /** 'Jaén', el nombre que se lee. */
  name: string;
  /** Provisional mientras el nombre y el dominio estén sin decidir. */
  brand: { name: string; domain: string; channelUrl: string };
  /** Municipios y zonas que cuentan como «de aquí». */
  scope: string[];
  /** Código INE del municipio, para AEMET. */
  aemetMunicipality: string;
  /** IDMunicipio de la API de carburantes del Ministerio. */
  fuelMunicipalityId?: string;
  /** Orden y secciones activas, incluidas las propias de la ciudad. */
  sections: SectionDef[];
  /** Genéricos ya configurados más los propios. */
  collectors: Collector[];
  /** AAAA-MM-DD sin edición. */
  holidays: string[];
}

export interface CollectContext {
  city: CityConfig;
  /** AAAA-MM-DD en Europe/Madrid. */
  date: string;
  /**
   * Un solo cliente para toda la ejecución, compartido por todos los
   * colectores: así «una petición por página y ejecución» (regla 6) se cumple
   * también cuando dos colectores leen la misma URL.
   */
  http: HttpClient;
}

export interface Collector {
  /** 'aemet', 'ayto-agenda', 'rss-diario-jaen'… */
  id: string;
  /** Id de una SectionDef de la ciudad. */
  section: string;
  collect(ctx: CollectContext): Promise<Item[]>;
}

export interface Item {
  /** Estable: hash(fuente + url o título). */
  id: string;
  /** Id del colector que lo trajo. */
  source: string;
  section: string;
  title: string;
  /** Texto de la fuente: solo para el prompt, nunca se publica tal cual. */
  summary?: string;
  url?: string;
  /** Eventos. */
  startsAt?: string;
  endsAt?: string;
  place?: string;
  publishedAt?: string;
  /** Secciones deterministas (precios, temperaturas…). */
  data?: Record<string, unknown>;
}

/** Lo que Claude redacta para un item recogido. */
export interface DraftEntry {
  /** Id de un `Item` de los recogidos: el validador lo comprueba (regla 2). */
  item_id: string;
  titulo: string;
  /** Sin URLs: los enlaces los pone el render a partir del item. */
  texto: string;
}

/** Salida de `draft`, con el esquema que se le pide a Claude. */
export interface Draft {
  /** Una frase para el saludo. */
  titular: string;
  /** Entradas por id de sección; solo las secciones que escribe la IA. */
  secciones: Record<string, DraftEntry[]>;
  /** Lo que Claude decidió no contar, y por qué. Se muestra en el PR. */
  descartes: { item_id: string; motivo: string }[];
}

/** Frontmatter de una edición. */
export interface EditionFrontmatter {
  ciudad: string;
  fecha: string;
  numero: number;
  estado: 'borrador' | 'publicada';
  fuentes: { id: string; nombre: string; url?: string }[];
  avisos?: string[];
}

export interface Edition {
  frontmatter: EditionFrontmatter;
  /** Cuerpo en Markdown, sin frontmatter. */
  body: string;
}
