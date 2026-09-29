/**
 * `validate`: el portero entre lo que escribe Claude y lo que llega al PR.
 *
 * Hace cumplir las reglas 1 y 2 sin fiarse de la buena voluntad del modelo.
 * Distingue dos niveles, y la diferencia importa:
 *
 * - **Errores**: lo que no puede publicarse de ninguna manera. Un `item_id`
 *   inventado significa que la entrada no sale de ningún item recogido, y una
 *   URL escrita por la IA es una URL que nadie ha comprobado. El pipeline las
 *   quita del borrador antes de abrir el PR.
 * - **Avisos**: lo que necesita un ojo humano, no un rechazo automático. Una
 *   cifra que no aparece en la fuente puede ser un redondeo razonable o puede
 *   ser inventada; quien decide es el editor, y para eso van a «Avisos».
 */
import { limits } from '../config.ts';
import type { CityConfig, Draft, DraftEntry, Item } from '../types.ts';

export type IssueCode =
  | 'item-inexistente'
  | 'url-inventada'
  | 'entrada-vacia'
  | 'seccion-inexistente'
  | 'seccion-determinista'
  | 'seccion-cruzada'
  | 'cifra-sin-fuente'
  | 'demasiadas-frases'
  | 'titulo-largo'
  | 'edicion-larga'
  | 'descarte-inexistente';

export interface Issue {
  code: IssueCode;
  /** Redactado para la sección «Avisos» del PR: lo lee una persona. */
  message: string;
  section?: string;
  itemId?: string;
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
}

/** URLs: http(s), www. o un dominio con TLD de los que usamos. */
const URL_SUELTA =
  /(https?:\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}|\b[a-z0-9-]{2,}\.(?:es|com|org|net|eus|cat|gal|info|eu)\b)/i;

/** Horas y cifras, con la hora primero para no partirla en dos números. */
const CIFRAS = /\d{1,2}:\d{2}|\d+(?:[.,]\d+)?/g;

export function validateDraft(
  draft: Draft,
  items: readonly Item[],
  city: CityConfig,
): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const porId = new Map(items.map((item) => [item.id, item]));
  const secciones = new Map(city.sections.map((seccion) => [seccion.id, seccion]));

  if (draft.titular.length > limits.maxTitleChars) {
    warnings.push({
      code: 'titulo-largo',
      message: `El titular del día pasa de ${String(limits.maxTitleChars)} caracteres.`,
    });
  }
  for (const cifra of cifrasSinFuente(draft.titular, fuenteDeTodos(items))) {
    warnings.push({
      code: 'cifra-sin-fuente',
      message: `El titular dice «${cifra}» y esa cifra no aparece en ninguna fuente.`,
    });
  }

  for (const [sectionId, entradas] of Object.entries(draft.secciones)) {
    const seccion = secciones.get(sectionId);
    if (!seccion) {
      errors.push({
        code: 'seccion-inexistente',
        section: sectionId,
        message: `«${sectionId}» no es una sección de ${city.name}.`,
      });
      continue;
    }
    if (seccion.writer === 'code') {
      warnings.push({
        code: 'seccion-determinista',
        section: sectionId,
        message: `${seccion.title} la escribe el código, no la IA (regla 1).`,
      });
    }

    for (const entrada of entradas) {
      validarEntrada(entrada, sectionId, porId, errors, warnings);
    }
  }

  for (const descarte of draft.descartes) {
    if (!porId.has(descarte.item_id)) {
      warnings.push({
        code: 'descarte-inexistente',
        itemId: descarte.item_id,
        message: `Se descarta «${descarte.item_id}», que no está entre los items recogidos.`,
      });
    }
  }

  return { errors, warnings };
}

function validarEntrada(
  entrada: DraftEntry,
  sectionId: string,
  porId: Map<string, Item>,
  errors: Issue[],
  warnings: Issue[],
): void {
  const comun = { section: sectionId, itemId: entrada.item_id };

  if (entrada.titulo.trim() === '' || entrada.texto.trim() === '') {
    errors.push({
      ...comun,
      code: 'entrada-vacia',
      message: 'La entrada viene sin título o sin texto.',
    });
    return;
  }

  const item = porId.get(entrada.item_id);
  if (!item) {
    errors.push({
      ...comun,
      code: 'item-inexistente',
      message: `«${entrada.titulo}» apunta a un item que no existe: nada la respalda (regla 2).`,
    });
    return;
  }

  const url = URL_SUELTA.exec(`${entrada.titulo} ${entrada.texto}`)?.[0];
  if (url !== undefined) {
    errors.push({
      ...comun,
      code: 'url-inventada',
      message: `«${entrada.titulo}» lleva una URL escrita por la IA («${url}»): el enlace lo pone el render.`,
    });
  }

  if (entrada.titulo.length > limits.maxTitleChars) {
    warnings.push({
      ...comun,
      code: 'titulo-largo',
      message: `«${entrada.titulo}» pasa de ${String(limits.maxTitleChars)} caracteres.`,
    });
  }

  const frases = contarFrases(entrada.texto);
  if (frases > limits.maxSentencesPerItem) {
    warnings.push({
      ...comun,
      code: 'demasiadas-frases',
      message: `«${entrada.titulo}» tiene ${String(frases)} frases y el tope es ${String(limits.maxSentencesPerItem)} (regla 4).`,
    });
  }

  if (item.section !== sectionId) {
    warnings.push({
      ...comun,
      code: 'seccion-cruzada',
      message: `«${entrada.titulo}» se recogió para «${item.section}» y aparece en «${sectionId}».`,
    });
  }

  for (const cifra of cifrasSinFuente(`${entrada.titulo} ${entrada.texto}`, fuenteDeItem(item))) {
    warnings.push({
      ...comun,
      code: 'cifra-sin-fuente',
      message: `«${entrada.titulo}» dice «${cifra}» y eso no aparece en la fuente.`,
    });
  }
}

/** Tope de caracteres del mensaje: menos de tres minutos de lectura. */
export function validateWhatsapp(text: string): ValidationResult {
  const warnings: Issue[] = [];
  if (text.length > limits.maxEditionChars) {
    warnings.push({
      code: 'edicion-larga',
      message: `El mensaje tiene ${String(text.length)} caracteres y el tope es ${String(limits.maxEditionChars)}.`,
    });
  }
  return { errors: [], warnings };
}

/** Si el borrador puede abrirse como PR tal cual. */
export function isPublishable(result: ValidationResult): boolean {
  return result.errors.length === 0;
}

/**
 * Quita del borrador lo que tiene errores, para que una entrada mala no tumbe
 * la edición entera: el PR sale con el resto y los errores en «Avisos».
 */
export function dropInvalid(draft: Draft, result: ValidationResult): Draft {
  const malas = new Set(
    result.errors.flatMap((issue) =>
      issue.section === undefined ? [] : [`${issue.section}\u0000${issue.itemId ?? ''}`],
    ),
  );
  const seccionesMalas = new Set(
    result.errors.flatMap((issue) =>
      issue.code === 'seccion-inexistente' && issue.section !== undefined ? [issue.section] : [],
    ),
  );

  const secciones: Record<string, DraftEntry[]> = {};
  for (const [sectionId, entradas] of Object.entries(draft.secciones)) {
    if (seccionesMalas.has(sectionId)) continue;
    const buenas = entradas.filter((entrada) => !malas.has(`${sectionId}\u0000${entrada.item_id}`));
    if (buenas.length > 0) secciones[sectionId] = buenas;
  }

  return { ...draft, secciones };
}

// --- cifras ---------------------------------------------------------------

/** Todo lo que la fuente dice de un item, para comprobar cifras contra ello. */
function fuenteDeItem(item: Item): string {
  const partes = [
    item.title,
    item.summary ?? '',
    item.place ?? '',
    item.startsAt ?? '',
    item.endsAt ?? '',
    item.publishedAt ?? '',
    item.data === undefined ? '' : JSON.stringify(item.data),
  ];
  return partes.join(' ');
}

function fuenteDeTodos(items: readonly Item[]): string {
  return items.map(fuenteDeItem).join(' ');
}

/**
 * Cifras del texto redactado que no aparecen en la fuente. Es un aviso, no un
 * rechazo: se admiten las formas equivalentes de escribir una hora («20:00»,
 * «20.00», «20 h») porque si no, avisaría de casi todo.
 */
export function cifrasSinFuente(texto: string, fuente: string): string[] {
  const normalizada = normalizarCifras(fuente);
  const sospechosas: string[] = [];

  for (const match of texto.matchAll(CIFRAS)) {
    const cifra = match[0];
    if (variantes(cifra).some((variante) => normalizada.includes(variante))) continue;
    if (!sospechosas.includes(cifra)) sospechosas.push(cifra);
  }

  return sospechosas;
}

function normalizarCifras(texto: string): string {
  return texto.replace(/,/g, '.').replace(/\s+/g, ' ').toLowerCase();
}

/** Las formas en las que la fuente puede haber escrito la misma cifra. */
function variantes(cifra: string): string[] {
  const base = cifra.replace(',', '.');
  const formas = new Set([base]);

  const hora = /^(\d{1,2}):(\d{2})$/.exec(base);
  if (hora?.[1] !== undefined && hora[2] !== undefined) {
    const [, h, m] = hora;
    formas.add(`${h}.${m}`);
    formas.add(`${h}:${m}`);
    formas.add(`t${h}:${m}`); // startsAt en ISO: 2026-09-21T20:00
    if (m === '00') formas.add(h);
  }

  // Un precio en la fuente puede venir sin el cero final: 1.4 por 1.40.
  if (base.endsWith('0') && base.includes('.')) formas.add(base.slice(0, -1));

  return [...formas];
}

function contarFrases(texto: string): number {
  return texto
    .split(/[.!?…]+(?:\s|$)/)
    .map((frase) => frase.trim())
    .filter((frase) => frase !== '').length;
}
