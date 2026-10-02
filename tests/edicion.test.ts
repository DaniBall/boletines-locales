import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { editionNumber, readEdition, writeEdition } from '../pipeline/lib/edicion.ts';
import { greetingDate } from '../pipeline/lib/fechas.ts';
import type { HttpClient } from '../pipeline/lib/http.ts';
import { draftBudget, generateEdition, type DraftFn } from '../pipeline/steps/edition.ts';
import { routeWeekend } from '../pipeline/steps/finde.ts';
import { renderEdition } from '../pipeline/steps/render.ts';
import type { CityConfig, Collector, Draft, Edition, Item } from '../pipeline/types.ts';

/** Una ciudad de mentira: el motor no conoce ninguna de verdad (regla 8). */
function ciudad(collectors: Collector[] = []): CityConfig {
  return {
    id: 'prueba',
    name: 'Villa Prueba',
    brand: { name: 'Boletín de prueba', domain: 'https://ejemplo.invalid/', channelUrl: '' },
    scope: ['Villa Prueba'],
    aemetMunicipality: '00000',
    sections: [
      { id: 'agenda', title: '📅 Hoy', writer: 'ai' },
      { id: 'finde', title: '🎉 Este finde', writer: 'ai' },
      { id: 'te_afecta', title: '📰 Te afecta', writer: 'ai' },
      { id: 'precios', title: '💶 Precios', writer: 'code' },
    ],
    collectors,
    holidays: [],
  };
}

const MIERCOLES = '2026-09-30';
const VIERNES = '2026-10-02';

const noticia: Item = {
  id: 'diario:1',
  source: 'diario',
  section: 'te_afecta',
  title: 'Cortan la calle Mayor por obras',
  summary: 'La calle Mayor estará cortada hasta el viernes.',
  url: 'https://diario.invalid/calle-mayor',
};

const concierto: Item = {
  id: 'ayto:1',
  source: 'ayto',
  section: 'agenda',
  title: 'Concierto en la plaza',
  url: 'https://ayto.invalid/concierto',
  startsAt: `${MIERCOLES}T21:00:00`,
};

const precio: Item = {
  id: 'precios:1',
  source: 'precios',
  section: 'precios',
  title: 'Pan',
  data: { euros: 1.2 },
};

const plantillaDePrecios = (items: readonly Item[]): string[] =>
  items.map((item) => `- ${item.title}: ${String(item.data?.euros)} €`);

describe('greetingDate', () => {
  it('escribe la fecha del saludo con mayúscula inicial', () => {
    expect(greetingDate(MIERCOLES)).toBe('Miércoles 30 de septiembre');
  });
});

describe('routeWeekend', () => {
  const sabado: Item = { ...concierto, id: 'sabado', startsAt: '2026-10-03T12:00:00' };
  const domingo: Item = { ...concierto, id: 'domingo', startsAt: '2026-10-04T12:00:00' };
  const viernes: Item = { ...concierto, id: 'viernes', startsAt: `${VIERNES}T20:00:00` };
  const ruta = { from: 'agenda', to: 'finde' };

  it('el viernes pasa a «finde» lo que empieza el sábado o el domingo', () => {
    const repartidos = routeWeekend([viernes, sabado, domingo, noticia], VIERNES, ruta);

    expect(repartidos.map((i) => `${i.id}:${i.section}`)).toEqual([
      'viernes:agenda',
      'sabado:finde',
      'domingo:finde',
      'diario:1:te_afecta',
    ]);
  });

  it('otro día no toca nada', () => {
    const lunes = '2026-09-28';
    const semana: Item = { ...sabado, startsAt: '2026-09-29T12:00:00' };

    expect(routeWeekend([semana], lunes, ruta)).toEqual([semana]);
  });
});

describe('renderEdition', () => {
  const base = {
    city: ciudad(),
    date: MIERCOLES,
    numero: 7,
    items: [concierto, noticia, precio],
    renderers: { precios: plantillaDePrecios },
  };

  it('con borrador, redacta con las palabras de Claude y el enlace del item', () => {
    const draft: Draft = {
      titular: 'Hoy, música en la plaza.',
      secciones: {
        agenda: [{ item_id: 'ayto:1', titulo: 'Concierto', texto: 'A las 21:00, gratis.' }],
        te_afecta: [{ item_id: 'diario:1', titulo: 'Calle Mayor', texto: 'Cortada por obras.' }],
      },
      descartes: [],
    };

    const { body, sinRedactar, frontmatter } = renderEdition({ ...base, draft });

    expect(body).toBe(
      [
        '¡Buenos días, Villa Prueba! Miércoles 30 de septiembre, edición nº 7. Hoy, música en la plaza.',
        '## 📅 Hoy\n\n- **Concierto**: A las 21:00, gratis. [Más info](https://ayto.invalid/concierto)',
        '## 📰 Te afecta\n\n- **Calle Mayor**: Cortada por obras. [Fuente](https://diario.invalid/calle-mayor)',
        '## 💶 Precios\n\n- Pan: 1.2 €',
        '---\n\n¿Sabes algo que deberíamos contar? Escríbenos y lo miramos para mañana.',
      ].join('\n\n'),
    );
    expect(sinRedactar).toEqual([]);
    expect(frontmatter).toMatchObject({ ciudad: 'prueba', fecha: MIERCOLES, numero: 7 });
    expect(frontmatter.estado).toBe('borrador');
    expect(frontmatter.avisos).toBeUndefined();
  });

  it('sin borrador, pone los titulares de la fuente y avisa de que hay que reescribirlos', () => {
    const { body, sinRedactar, frontmatter } = renderEdition(base);

    expect(body).toContain(
      '- **Cortan la calle Mayor por obras** [Fuente](https://diario.invalid/calle-mayor)',
    );
    expect(sinRedactar).toEqual(['📅 Hoy', '📰 Te afecta']);
    expect(frontmatter.avisos?.[0]).toMatch(/^Sin redactar: 📅 Hoy, 📰 Te afecta\./);
  });

  it('omite las secciones sin nada que contar, sin «sin información»', () => {
    const { body } = renderEdition({ ...base, items: [noticia] });

    expect(body).not.toContain('📅 Hoy');
    expect(body).not.toContain('💶 Precios');
    expect(body).not.toContain('🎉 Este finde');
  });

  it('lista cada fuente una vez, con su nombre y su portada', () => {
    const sources = new Map([
      ['ayto', { name: 'Ayuntamiento', homepage: 'https://ayto.invalid/' }],
      ['diario', { name: 'El Diario' }],
    ]);
    const segunda: Item = { ...noticia, id: 'diario:2', url: 'https://diario.invalid/otra' };

    const { frontmatter } = renderEdition({
      ...base,
      items: [concierto, noticia, segunda],
      sources,
    });

    expect(frontmatter.fuentes).toEqual([
      { id: 'ayto', nombre: 'Ayuntamiento', url: 'https://ayto.invalid/' },
      { id: 'diario', nombre: 'El Diario' },
    ]);
  });
});

describe('generateEdition', () => {
  let root: string;
  const http = {} as HttpClient;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'boletines-edicion-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const colectores: Collector[] = [
    {
      id: 'diario',
      section: 'te_afecta',
      name: 'El Diario',
      collect: () => Promise.resolve([noticia]),
    },
    {
      id: 'roto',
      section: 'agenda',
      collect: () => Promise.reject(new Error('La fuente respondió 500.')),
    },
  ];

  it('sin IA sale igual, con el titular de la fuente y los avisos', async () => {
    const { edition, report } = await generateEdition({
      city: ciudad(colectores),
      date: MIERCOLES,
      http,
      numero: 3,
      root,
    });

    expect(edition.body).toContain('Cortan la calle Mayor por obras');
    expect(report.sinIa).toBe('Edición generada sin IA.');
    expect(report.sinRedactar).toEqual(['📰 Te afecta']);
    expect(edition.frontmatter.avisos).toEqual(
      expect.arrayContaining([
        'Edición generada sin IA.',
        'roto: La fuente respondió 500; su sección va sin esa fuente.',
      ]),
    );
    expect(report.whatsapp).toContain('https://ejemplo.invalid/ediciones/2026-09-30/');
  });

  it('con IA, quita del borrador lo que no pasa el validador', async () => {
    const draft: DraftFn = ({ items }) =>
      Promise.resolve({
        titular: 'Obras en el centro.',
        secciones: {
          te_afecta: [
            { item_id: items[0]?.id ?? '', titulo: 'Calle Mayor', texto: 'Cortada por obras.' },
            { item_id: 'inventado', titulo: 'Bulo', texto: 'Esto no lo dijo nadie.' },
          ],
        },
        descartes: [],
      });

    const { edition, report } = await generateEdition({
      city: ciudad(colectores),
      date: MIERCOLES,
      http,
      numero: 3,
      draft,
      root,
    });

    expect(edition.body).toContain('- **Calle Mayor**: Cortada por obras.');
    expect(edition.body).not.toContain('Bulo');
    expect(report.errors).toHaveLength(1);
    expect(report.sinIa).toBeUndefined();
    expect(edition.frontmatter.avisos?.some((a) => a.startsWith('Quitado del borrador:'))).toBe(
      true,
    );
  });

  it('si Claude falla, la edición sale sin IA y lo dice (regla 5)', async () => {
    const draft: DraftFn = () => Promise.reject(new Error('Sin saldo.'));

    const { edition, report } = await generateEdition({
      city: ciudad(colectores),
      date: MIERCOLES,
      http,
      numero: 3,
      draft,
      root,
    });

    expect(report.sinIa).toBe('Falló la redacción con Claude: Sin saldo.');
    expect(edition.body).toContain('Cortan la calle Mayor por obras');
  });
});

describe('draftBudget', () => {
  it('descuenta del tope lo que no escribe Claude', () => {
    const conPrecios = draftBudget(
      { ...ciudad(), sections: [...ciudad().sections] },
      MIERCOLES,
      3,
      [noticia],
    );
    const sinNada = draftBudget(ciudad(), MIERCOLES, 3, []);

    expect(conPrecios).toBeGreaterThan(2500);
    expect(conPrecios).toBeLessThan(3000);
    // Sin items de IA no hay títulos de sección que descontar.
    expect(sinNada).toBeGreaterThan(conPrecios);
  });

  it('pasa el presupuesto a la redacción', async () => {
    let recibido: number | undefined;
    const draft: DraftFn = ({ budget }) => {
      recibido = budget;
      return Promise.resolve({ titular: '', secciones: {}, descartes: [] });
    };
    const root = await mkdtemp(path.join(tmpdir(), 'boletines-presupuesto-'));
    try {
      await generateEdition({
        city: ciudad([
          { id: 'diario', section: 'te_afecta', collect: () => Promise.resolve([noticia]) },
        ]),
        date: MIERCOLES,
        http: {} as HttpClient,
        numero: 3,
        draft,
        root,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    expect(recibido).toBe(draftBudget(ciudad(), MIERCOLES, 3, [noticia]));
  });
});

describe('editionNumber y writeEdition', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'boletines-numero-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const edicion = (fecha: string, numero: number): Edition => ({
    frontmatter: { ciudad: 'prueba', fecha, numero, estado: 'borrador', fuentes: [] },
    body: '¡Buenos días!',
  });

  it('empieza en 1 si la ciudad no tiene ediciones', async () => {
    await expect(editionNumber('prueba', MIERCOLES, root)).resolves.toBe(1);
  });

  it('sigue al mayor y conserva el suyo si se regenera el mismo día', async () => {
    await writeEdition(edicion('2026-09-28', 4), root);
    await writeEdition(edicion('2026-09-29', 5), root);

    await expect(editionNumber('prueba', MIERCOLES, root)).resolves.toBe(6);
    await expect(editionNumber('prueba', '2026-09-28', root)).resolves.toBe(4);
  });

  it('escribe un Markdown que se vuelve a leer igual', async () => {
    const file = await writeEdition(edicion(MIERCOLES, 6), root);

    expect(file).toBe(path.join(root, 'content', 'prueba', 'ediciones', `${MIERCOLES}.md`));
    expect(await readFile(file, 'utf8')).toMatch(/^---\nciudad: prueba\n/);
    await expect(readEdition('prueba', MIERCOLES, root)).resolves.toEqual(edicion(MIERCOLES, 6));
  });
});
