import { describe, expect, it } from 'vitest';
import { select } from '../pipeline/steps/select.ts';
import type { CityConfig, Item } from '../pipeline/types.ts';

/** Una ciudad de mentira: el motor no conoce ninguna de verdad (regla 8). */
const ciudad: CityConfig = {
  id: 'prueba',
  name: 'Villa Prueba',
  brand: { name: 'Boletín de prueba', domain: 'https://ejemplo.invalid', channelUrl: '' },
  scope: ['Villa Prueba', 'Aldea Vecina'],
  aemetMunicipality: '00000',
  sections: [
    { id: 'agenda', title: '📅 Hoy', writer: 'ai' },
    { id: 'finde', title: '🎉 Este finde', writer: 'ai' },
    { id: 'te_afecta', title: '📰 Te afecta', writer: 'ai' },
    { id: 'nieve', title: '❄️ Nieve', writer: 'code', season: { from: '11-01', to: '03-31' } },
  ],
  collectors: [],
  holidays: [],
};

function item(partial: Partial<Item> & { id: string; title: string }): Item {
  return { source: 'prueba', section: 'te_afecta', ...partial };
}

const HOY = '2026-09-21'; // lunes
const VIERNES = '2026-09-18';

describe('select', () => {
  it('descarta lo que no cae en ninguna sección de la ciudad', () => {
    const { selected, discarded } = select(
      [item({ id: '1', title: 'Aceite', section: 'aceite' })],
      ciudad,
      HOY,
    );

    expect(selected).toHaveLength(0);
    expect(discarded[0]?.reason).toBe('seccion-desconocida');
  });

  it('descarta las secciones de temporada fuera de su tramo', () => {
    const nieve = item({ id: '1', title: 'Puerto cerrado', section: 'nieve' });

    expect(select([nieve], ciudad, HOY).discarded[0]?.reason).toBe('fuera-de-temporada');
    // En enero sí, que el tramo cruza el cambio de año.
    expect(select([nieve], ciudad, '2027-01-15').selected).toHaveLength(1);
  });

  describe('la ventana de fechas', () => {
    it('deja pasar el evento de hoy y descarta el de pasado mañana', () => {
      const items = [
        item({ id: 'hoy', title: 'Concierto', section: 'agenda', startsAt: `${HOY}T20:00:00` }),
        item({
          id: 'luego',
          title: 'Feria',
          section: 'agenda',
          startsAt: '2026-09-23T20:00:00',
        }),
      ];

      const { selected, discarded } = select(items, ciudad, HOY);

      expect(selected.map((i) => i.id)).toEqual(['hoy']);
      expect(discarded[0]?.reason).toBe('fuera-de-fecha');
    });

    it('mantiene el evento de varios días mientras dure', () => {
      const feria = item({
        id: 'feria',
        title: 'Feria de San Lucas',
        section: 'agenda',
        startsAt: '2026-09-19T10:00:00',
        endsAt: '2026-09-23T23:00:00',
      });

      expect(select([feria], ciudad, HOY).selected).toHaveLength(1);
    });

    it('el viernes, las secciones de finde miran también al fin de semana', () => {
      const domingo = item({
        id: 'dom',
        title: 'Mercadillo',
        section: 'finde',
        startsAt: '2026-09-20T10:00:00',
      });

      expect(select([domingo], ciudad, VIERNES).selected).toHaveLength(0);
      expect(
        select([domingo], ciudad, VIERNES, {
          weekendSections: ['finde'],
          isWeekendEdition: true,
        }).selected,
      ).toHaveLength(1);
    });

    it('acepta la noticia reciente y descarta la vieja', () => {
      const items = [
        item({ id: 'ayer', title: 'Ayuda al comercio', publishedAt: '2026-09-20T09:00:00' }),
        item({ id: 'vieja', title: 'Otra cosa', publishedAt: '2026-09-01T09:00:00' }),
      ];

      expect(select(items, ciudad, HOY).selected.map((i) => i.id)).toEqual(['ayer']);
    });

    it('deja pasar lo que no trae fecha, como los precios', () => {
      expect(
        select([item({ id: 'x', title: 'Gasóleo a 1,42 €' })], ciudad, HOY).selected,
      ).toHaveLength(1);
    });
  });

  describe('el alcance', () => {
    it('descarta lo que pasa en un municipio que no es de aquí', () => {
      const fuera = item({ id: '1', title: 'Pleno', place: 'Úbeda' });
      const { discarded } = select([fuera], ciudad, HOY);

      expect(discarded[0]?.reason).toBe('fuera-de-alcance');
    });

    it('acepta el entorno declarado, con acentos o sin ellos', () => {
      const items = [
        item({ id: '1', title: 'Obras', place: 'Aldea Vecina' }),
        item({ id: '2', title: 'Pleno', place: 'villa prueba' }),
      ];

      expect(select(items, ciudad, HOY).selected).toHaveLength(2);
    });

    it('deja pasar lo que no dice dónde pasa', () => {
      expect(select([item({ id: '1', title: 'Sin lugar' })], ciudad, HOY).selected).toHaveLength(1);
    });
  });

  it('no repite lo que ya salió en una edición anterior', () => {
    const items = [
      item({ id: 'viejo', title: 'Ayuda al comercio', url: 'https://medio.es/ayuda' }),
      item({ id: 'nuevo', title: 'Otra distinta', url: 'https://medio.es/otra' }),
    ];

    const { selected, discarded } = select(items, ciudad, HOY, {
      publishedUrls: ['https://www.medio.es/ayuda/?utm_source=wa'],
    });

    expect(selected.map((i) => i.id)).toEqual(['nuevo']);
    expect(discarded[0]?.reason).toBe('ya-publicado');
  });

  it('deduplica dentro del propio día y dice de quién es duplicado', () => {
    const items = [
      item({ id: 'a', title: 'El Ayuntamiento corta la calle Mayor por obras' }),
      item({ id: 'b', title: 'Obras en la calle Mayor: el Ayuntamiento la corta' }),
    ];

    const { selected, discarded } = select(items, ciudad, HOY);

    expect(selected.map((i) => i.id)).toEqual(['a']);
    expect(discarded[0]?.reason).toBe('duplicado');
    expect(discarded[0]?.detail).toContain('El Ayuntamiento corta la calle Mayor');
  });

  it('corta por sección y deja el resto anotado como exceso', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ id: `n${String(i)}`, title: `Noticia distinta número ${String(i)}` }),
    );

    const { selected, discarded } = select(items, ciudad, HOY, { maxPerSection: 3 });

    expect(selected).toHaveLength(3);
    expect(discarded.filter((d) => d.reason === 'exceso')).toHaveLength(2);
  });

  it('devuelve las secciones en el orden de la edición, no en el de llegada', () => {
    const items = [
      item({ id: 'noticia', title: 'Una noticia', section: 'te_afecta' }),
      item({ id: 'plan', title: 'Un plan', section: 'agenda' }),
    ];

    expect(select(items, ciudad, HOY).selected.map((i) => i.id)).toEqual(['plan', 'noticia']);
  });
});
