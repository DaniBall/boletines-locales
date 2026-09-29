import { describe, expect, it } from 'vitest';
import {
  cifrasSinFuente,
  dropInvalid,
  isPublishable,
  validateDraft,
  validateWhatsapp,
} from '../pipeline/steps/validate.ts';
import type { CityConfig, Draft, Item } from '../pipeline/types.ts';

const ciudad: CityConfig = {
  id: 'prueba',
  name: 'Villa Prueba',
  brand: { name: 'Boletín de prueba', domain: 'https://ejemplo.invalid', channelUrl: '' },
  scope: ['Villa Prueba'],
  aemetMunicipality: '00000',
  sections: [
    { id: 'agenda', title: '📅 Hoy', writer: 'ai' },
    { id: 'te_afecta', title: '📰 Te afecta', writer: 'ai' },
    { id: 'tiempo', title: '☀️ El tiempo', writer: 'code' },
  ],
  collectors: [],
  holidays: [],
};

const items: Item[] = [
  {
    id: 'ayto-1',
    source: 'ayto-agenda',
    section: 'agenda',
    title: 'Visita nocturna a la Catedral',
    summary: 'A las 21:00, con entrada de 12 € y aforo limitado.',
    url: 'https://ayto.es/agenda/1',
    startsAt: '2026-09-21T21:00:00',
  },
  {
    id: 'rss-9',
    source: 'rss-medio',
    section: 'te_afecta',
    title: 'Ayudas al comercio local',
    summary: 'El plazo acaba el 30 de septiembre.',
    url: 'https://medio.es/ayudas',
    publishedAt: '2026-09-20T09:00:00',
  },
];

function borrador(partial: Partial<Draft> = {}): Draft {
  return {
    titular: 'Arranca la semana con la Catedral abierta de noche.',
    secciones: {},
    descartes: [],
    ...partial,
  };
}

describe('validateDraft: lo que no puede publicarse', () => {
  it('rechaza una entrada que apunta a un item que no existe', () => {
    const { errors } = validateDraft(
      borrador({
        secciones: {
          agenda: [{ item_id: 'inventado', titulo: 'Un plan', texto: 'Algo que suena bien.' }],
        },
      }),
      items,
      ciudad,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('item-inexistente');
    expect(errors[0]?.message).toContain('regla 2');
  });

  it('rechaza las URLs escritas por la IA, en cualquiera de sus formas', () => {
    const textos = [
      'Más información en https://inventada.es/plan.',
      'Lo cuentan en www.inventada.es.',
      'Consulta la web inventada.es para reservar.',
    ];

    for (const texto of textos) {
      const { errors } = validateDraft(
        borrador({
          secciones: { agenda: [{ item_id: 'ayto-1', titulo: 'Visita nocturna', texto }] },
        }),
        items,
        ciudad,
      );
      expect(errors.map((e) => e.code)).toContain('url-inventada');
    }
  });

  it('rechaza una sección que no es de la ciudad', () => {
    const { errors } = validateDraft(
      borrador({
        secciones: { aceite: [{ item_id: 'ayto-1', titulo: 'Aceite', texto: 'Sube el precio.' }] },
      }),
      items,
      ciudad,
    );

    expect(errors[0]?.code).toBe('seccion-inexistente');
  });

  it('rechaza una entrada vacía, que publicaría una viñeta sin nada', () => {
    const { errors } = validateDraft(
      borrador({ secciones: { agenda: [{ item_id: 'ayto-1', titulo: '', texto: '  ' }] } }),
      items,
      ciudad,
    );

    expect(errors[0]?.code).toBe('entrada-vacia');
  });

  it('da por bueno un borrador correcto', () => {
    const resultado = validateDraft(
      borrador({
        secciones: {
          agenda: [
            {
              item_id: 'ayto-1',
              titulo: 'Visita nocturna a la Catedral',
              texto: 'A las 21:00 y con entrada de 12 €. Conviene reservar.',
            },
          ],
          te_afecta: [
            {
              item_id: 'rss-9',
              titulo: 'Ayudas al comercio',
              texto: 'El plazo acaba el 30 de septiembre.',
            },
          ],
        },
      }),
      items,
      ciudad,
    );

    expect(resultado.errors).toEqual([]);
    expect(resultado.warnings).toEqual([]);
    expect(isPublishable(resultado)).toBe(true);
  });
});

describe('validateDraft: lo que solo avisa', () => {
  it('avisa de una cifra que no está en la fuente', () => {
    const { errors, warnings } = validateDraft(
      borrador({
        secciones: {
          agenda: [
            {
              item_id: 'ayto-1',
              titulo: 'Visita nocturna',
              texto: 'A las 21:00, con entrada de 25 €.',
            },
          ],
        },
      }),
      items,
      ciudad,
    );

    // No tumba la edición: lo decide el editor.
    expect(errors).toEqual([]);
    expect(warnings[0]?.code).toBe('cifra-sin-fuente');
    expect(warnings[0]?.message).toContain('25');
  });

  it('avisa si se pasa del tope de frases por item', () => {
    const { warnings } = validateDraft(
      borrador({
        secciones: {
          agenda: [
            {
              item_id: 'ayto-1',
              titulo: 'Visita nocturna',
              texto: 'Abre de noche. Hay que reservar. El aforo es limitado.',
            },
          ],
        },
      }),
      items,
      ciudad,
    );

    expect(warnings.map((w) => w.code)).toContain('demasiadas-frases');
  });

  it('avisa si la IA escribe una sección que es del código', () => {
    const { warnings } = validateDraft(
      borrador({
        secciones: {
          tiempo: [{ item_id: 'ayto-1', titulo: 'Hará sol', texto: 'Un día agradable.' }],
        },
      }),
      items,
      ciudad,
    );

    expect(warnings.map((w) => w.code)).toContain('seccion-determinista');
  });

  it('avisa si un item acaba en una sección que no es la suya', () => {
    const { warnings } = validateDraft(
      borrador({
        secciones: {
          te_afecta: [{ item_id: 'ayto-1', titulo: 'Visita nocturna', texto: 'Abre de noche.' }],
        },
      }),
      items,
      ciudad,
    );

    expect(warnings.map((w) => w.code)).toContain('seccion-cruzada');
  });

  it('avisa de un descarte que no existe entre los items', () => {
    const { warnings } = validateDraft(
      borrador({ descartes: [{ item_id: 'fantasma', motivo: 'no interesa' }] }),
      items,
      ciudad,
    );

    expect(warnings[0]?.code).toBe('descarte-inexistente');
  });
});

describe('cifrasSinFuente', () => {
  it('acepta las formas equivalentes de escribir una hora', () => {
    expect(cifrasSinFuente('A las 21:00', 'Empieza a las 21.00 de la noche')).toEqual([]);
    expect(cifrasSinFuente('A las 21:00', 'startsAt 2026-09-21T21:00:00')).toEqual([]);
    expect(cifrasSinFuente('A las 21:00', 'Es a las 21 h')).toEqual([]);
  });

  it('acepta la coma y el punto decimal como lo mismo', () => {
    expect(cifrasSinFuente('Gasóleo a 1,42 €', 'precio 1.42')).toEqual([]);
  });

  it('caza la cifra que no está en ningún sitio', () => {
    expect(cifrasSinFuente('Entrada de 25 €', 'Entrada de 12 €')).toEqual(['25']);
  });
});

describe('validateWhatsapp', () => {
  it('avisa cuando el mensaje pasa de 3.000 caracteres', () => {
    expect(validateWhatsapp('x'.repeat(2999)).warnings).toEqual([]);
    expect(validateWhatsapp('x'.repeat(3001)).warnings[0]?.code).toBe('edicion-larga');
  });
});

describe('dropInvalid', () => {
  it('quita solo lo que tiene errores y deja el resto en pie', () => {
    const draft = borrador({
      secciones: {
        agenda: [
          { item_id: 'inventado', titulo: 'Falsa', texto: 'No existe.' },
          { item_id: 'ayto-1', titulo: 'Visita nocturna', texto: 'Abre de noche.' },
        ],
        aceite: [{ item_id: 'ayto-1', titulo: 'Aceite', texto: 'Sube.' }],
      },
    });

    const limpio = dropInvalid(draft, validateDraft(draft, items, ciudad));

    expect(limpio.secciones.agenda?.map((e) => e.item_id)).toEqual(['ayto-1']);
    // La sección que no existe en la ciudad desaparece entera.
    expect(limpio.secciones.aceite).toBeUndefined();
    expect(limpio.titular).toBe(draft.titular);
  });
});
