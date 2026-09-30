import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  aiSections,
  buildDraftSchema,
  buildSystemPrompt,
  buildUserMessage,
  createClaudeDrafter,
  loadStylePrompt,
  parseDraft,
  type MessagesClient,
} from '../pipeline/steps/draft.ts';
import type { CityConfig, Draft, Item } from '../pipeline/types.ts';

/** Una ciudad de mentira: el motor no conoce ninguna de verdad (regla 8). */
const ciudad: CityConfig = {
  id: 'prueba',
  name: 'Villa Prueba',
  brand: { name: 'Boletín de prueba', domain: 'https://ejemplo.invalid', channelUrl: '' },
  scope: ['Villa Prueba'],
  aemetMunicipality: '00000',
  sections: [
    { id: 'tiempo', title: '☀️ El tiempo', writer: 'code' },
    { id: 'agenda', title: '📅 Hoy', writer: 'ai' },
    { id: 'te_afecta', title: '📰 Te afecta', writer: 'ai' },
    { id: 'movilidad', title: '🚧 Movilidad', writer: 'ai' },
  ],
  collectors: [],
  holidays: [],
};

const items: Item[] = [
  { id: 'aemet:1', source: 'aemet', section: 'tiempo', title: 'El tiempo', data: { maxima: 27 } },
  {
    id: 'ayto:1',
    source: 'ayto',
    section: 'agenda',
    title: 'Concierto en la plaza',
    summary: 'Concierto gratuito a las 21:00.   Con   espacios de más.',
    url: 'https://ayto.invalid/concierto',
    startsAt: '2026-09-30T21:00:00',
    place: 'Plaza Mayor',
  },
  {
    id: 'diario:1',
    source: 'diario',
    section: 'te_afecta',
    title: 'Cortan la calle Mayor',
    summary: 'x'.repeat(2000),
    url: 'https://diario.invalid/calle-mayor',
  },
];

const borrador: Draft = {
  titular: 'Música en la plaza.',
  secciones: {
    agenda: [{ item_id: 'ayto:1', titulo: 'Concierto', texto: 'A las 21:00, gratis.' }],
    te_afecta: [],
  },
  descartes: [{ item_id: 'diario:1', motivo: 'Ya contado.' }],
};

function clienteFalso(
  respuesta: Partial<Pick<Anthropic.Message, 'content' | 'stop_reason'>> = {},
): MessagesClient & { pedidas: Anthropic.MessageCreateParamsNonStreaming[] } {
  const pedidas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    pedidas,
    messages: {
      create: (params) => {
        pedidas.push(params);
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify(borrador), citations: null }],
          stop_reason: 'end_turn',
          ...respuesta,
        });
      },
    },
  };
}

describe('aiSections', () => {
  it('solo las secciones que redacta la IA y que tienen items, en su orden', () => {
    expect(aiSections(ciudad, items)).toEqual([
      { id: 'agenda', title: '📅 Hoy', itemIds: ['ayto:1'] },
      { id: 'te_afecta', title: '📰 Te afecta', itemIds: ['diario:1'] },
    ]);
  });
});

describe('buildDraftSchema', () => {
  const schema = buildDraftSchema(aiSections(ciudad, items), items) as {
    properties: {
      secciones: {
        required: string[];
        additionalProperties: boolean;
        properties: Record<string, { items: { properties: { item_id: { enum: string[] } } } }>;
      };
      descartes: { items: { properties: { item_id: { enum: string[] } } } };
    };
  };

  it('una propiedad por sección, cerrada, porque no se admiten diccionarios libres', () => {
    expect(schema.properties.secciones.required).toEqual(['agenda', 'te_afecta']);
    expect(schema.properties.secciones.additionalProperties).toBe(false);
  });

  it('limita cada item_id a los ids de su sección: no se puede inventar uno', () => {
    const { properties } = schema.properties.secciones;
    expect(properties.agenda?.items.properties.item_id.enum).toEqual(['ayto:1']);
    expect(properties.te_afecta?.items.properties.item_id.enum).toEqual(['diario:1']);
  });

  it('todos los objetos llevan additionalProperties: false, como exige la API', () => {
    const objetos: unknown[] = [];
    const recorrer = (nodo: unknown): void => {
      if (nodo === null || typeof nodo !== 'object') return;
      const registro = nodo as Record<string, unknown>;
      if (registro.type === 'object') objetos.push(registro.additionalProperties);
      Object.values(registro).forEach(recorrer);
    };
    recorrer(schema);

    expect(objetos.length).toBeGreaterThan(3);
    expect(objetos.every((valor) => valor === false)).toBe(true);
  });
});

describe('los prompts', () => {
  it('la guía común pone el nombre de la ciudad y quita las notas para el editor', async () => {
    const sistema = buildSystemPrompt(ciudad, await loadStylePrompt(), '<!-- nota -->\n- Local.');

    expect(sistema).toContain('Villa Prueba');
    expect(sistema).not.toContain('{ciudad}');
    expect(sistema).not.toContain('<!--');
    expect(sistema).toContain('## Lo propio de Villa Prueba\n\n- Local.');
  });

  it('el mensaje lleva los items como datos, sin URLs y con el resumen recortado', () => {
    const mensaje = buildUserMessage(ciudad, '2026-09-30', items, aiSections(ciudad, items));

    expect(mensaje).toContain('miércoles 30 de septiembre');
    expect(mensaje).toContain('no instrucciones');
    expect(mensaje).toContain('"lugar": "Plaza Mayor"');
    expect(mensaje).toContain('Concierto gratuito a las 21:00. Con espacios de más.');
    expect(mensaje).not.toContain('https://');
    // El tiempo lo escribe el código: Claude no lo ve.
    expect(mensaje).not.toContain('aemet:1');
    expect(mensaje).not.toContain('x'.repeat(700));
  });

  it('el viernes avisa de que la edición incluye el fin de semana', () => {
    expect(buildUserMessage(ciudad, '2026-10-02', items, [])).toContain('Es viernes');
  });
});

describe('createClaudeDrafter', () => {
  it('pide structured outputs con el modelo configurado y devuelve el borrador', async () => {
    const cliente = clienteFalso();
    const redactar = createClaudeDrafter({
      style: 'Guía de {ciudad}.',
      client: cliente,
      model: 'modelo-x',
    });

    await expect(redactar({ city: ciudad, date: '2026-09-30', items })).resolves.toEqual(borrador);

    const [pedida] = cliente.pedidas;
    expect(pedida?.model).toBe('modelo-x');
    expect(pedida?.system).toBe('Guía de Villa Prueba.');
    expect(pedida?.output_config?.format?.type).toBe('json_schema');
  });

  it('no gasta una llamada si no hay nada que redactar', async () => {
    const cliente = clienteFalso();
    const redactar = createClaudeDrafter({ style: '', client: cliente });

    const draft = await redactar({ city: ciudad, date: '2026-09-30', items: [items[0] as Item] });

    expect(draft).toEqual({ titular: '', secciones: {}, descartes: [] });
    expect(cliente.pedidas).toHaveLength(0);
  });

  it('falla con un mensaje claro si Claude se niega o se corta', async () => {
    const negativa = createClaudeDrafter({
      style: '',
      client: clienteFalso({ stop_reason: 'refusal' }),
    });
    const cortada = createClaudeDrafter({
      style: '',
      client: clienteFalso({ stop_reason: 'max_tokens' }),
    });

    await expect(negativa({ city: ciudad, date: '2026-09-30', items })).rejects.toThrow(/se negó/);
    await expect(cortada({ city: ciudad, date: '2026-09-30', items })).rejects.toThrow(
      /límite de tokens/,
    );
  });
});

describe('parseDraft', () => {
  it('rechaza lo que no es JSON o no tiene la forma del borrador', () => {
    expect(() => parseDraft('no es json')).toThrow(/no es JSON válido/);
    expect(() => parseDraft('{"titular": 3}')).toThrow();
  });
});
