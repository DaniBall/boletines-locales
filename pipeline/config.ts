/**
 * Configuración del motor. Nada de esto depende de una ciudad concreta: lo que
 * cambia de una a otra vive en `ciudades/<id>/config.ts`.
 */

export const TIMEZONE = 'Europe/Madrid' as const;

export const LOCALE = 'es-ES' as const;

export interface Network {
  name: string;
  contactEmail: string;
}

/** Datos de la red, comunes a todas las ediciones. */
export const network: Network = {
  /** Solo para el User-Agent y los créditos técnicos, no es una marca de cara al público. */
  name: 'Boletines locales',
  /** Titular único de todas las ediciones (aviso legal y contacto del scraping). */
  contactEmail: '',
};

/** La promesa, con el nombre de la ciudad dentro. */
export function tagline(cityName: string): string {
  return `Lo útil de ${cityName}, cada mañana en tu WhatsApp.`;
}

/** Límites que comprueba el validador. */
export const limits = {
  /** Caracteres del mensaje de WhatsApp: menos de tres minutos de lectura. */
  maxEditionChars: 3000,
  maxTitleChars: 60,
  maxSentencesPerItem: 2,
  /** Días hacia atrás que mira `select` para no repetir. */
  dedupeWindowDays: 14,
} as const;

/** Redacción con Claude. */
export const ai = {
  model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-5',
  // El razonamiento (adaptive thinking) cuenta dentro del límite: una edición
  // real gasta unos 6.000 tokens, de los que 4.500 son de razonamiento.
  maxOutputTokens: 16_000,
} as const;

/** Scraping educado: una petición por página y ejecución, con contacto visible. */
export const http = {
  userAgent: `${network.name}${network.contactEmail ? ` (+${network.contactEmail})` : ''}`,
  timeoutMs: 10_000,
  retries: 1,
  cacheDir: '.cache',
} as const;

/** Interruptores para ir activando cosas sin tocar código. */
export const flags = {
  /** Fase 1b: publicar en los Canales con WAHA. */
  wahaPublish: false,
  /** Fase 1.5: bloques de patrocinio. */
  sponsorships: false,
  /** Fase 2: suscriptores por la API oficial. */
  cloudApi: false,
  /** Modo «víspera»: genera la edición del día siguiente. */
  eveMode: false,
} as const;

/** Raíz del contenido. Cada ciudad cuelga de aquí: content/<id>/ediciones/. */
export const paths = {
  content: 'content',
  prompts: 'prompts',
} as const;
