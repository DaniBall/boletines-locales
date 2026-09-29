import { describe, expect, it } from 'vitest';
import { dedupe, similarity, titleKey, urlKey } from '../pipeline/lib/dedupe.ts';

describe('urlKey', () => {
  it('quita los parámetros de seguimiento, que no cambian la página', () => {
    expect(urlKey('https://diariojaen.es/a?utm_source=wa&utm_medium=canal')).toBe(
      'https://diariojaen.es/a',
    );
    expect(urlKey('https://diariojaen.es/a?fbclid=xyz')).toBe('https://diariojaen.es/a');
  });

  it('conserva los parámetros que sí identifican contenido', () => {
    expect(urlKey('https://ejemplo.es/noticia?id=42')).toBe('https://ejemplo.es/noticia?id=42');
  });

  it('iguala http con https, el www y la barra final', () => {
    const esperado = 'https://ejemplo.es/agenda';
    expect(urlKey('http://www.ejemplo.es/agenda/')).toBe(esperado);
    expect(urlKey('https://EJEMPLO.es/agenda')).toBe(esperado);
  });

  it('ignora el ancla, que es la misma página', () => {
    expect(urlKey('https://ejemplo.es/a#comentarios')).toBe('https://ejemplo.es/a');
  });

  it('no se rompe con algo que no es una URL', () => {
    expect(urlKey('  NO-ES-UNA-URL ')).toBe('no-es-una-url');
  });
});

describe('titleKey y similarity', () => {
  it('reduce el titular a lo que lo distingue', () => {
    expect(titleKey('¡El Ayuntamiento corta la calle Bernabé Soriano!')).toBe(
      'el ayuntamiento corta la calle bernabe soriano',
    );
  });

  it('reconoce la misma noticia contada por dos medios', () => {
    const a = 'El Ayuntamiento corta la calle Bernabé Soriano por obras';
    const b = 'Obras en la calle Bernabé Soriano: el Ayuntamiento la corta';
    expect(similarity(a, b)).toBeGreaterThan(0.7);
  });

  it('no confunde dos noticias distintas del mismo sitio', () => {
    const a = 'El Ayuntamiento corta la calle Bernabé Soriano por obras';
    const b = 'El Ayuntamiento aprueba el presupuesto de 2027';
    expect(similarity(a, b)).toBeLessThan(0.4);
  });

  it('no encuentra parecido donde no hay palabras con contenido', () => {
    expect(similarity('de los', 'en la')).toBe(0);
  });
});

describe('dedupe', () => {
  const item = (title: string, url?: string) => (url === undefined ? { title } : { title, url });

  it('se queda con la primera aparición, que es la fuente primaria', () => {
    const { kept, duplicates } = dedupe([
      item('Corte en Bernabé Soriano', 'https://ayto.es/n/1'),
      item('Corte en Bernabé Soriano', 'https://www.ayto.es/n/1/?utm_source=x'),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.url).toBe('https://ayto.es/n/1');
    expect(duplicates[0]?.duplicateOf?.url).toBe('https://ayto.es/n/1');
  });

  it('detecta el duplicado por el titular aunque la URL sea otra', () => {
    const { kept, duplicates } = dedupe([
      item('El Ayuntamiento corta la calle Bernabé Soriano por obras', 'https://medio-a.es/1'),
      item('Obras en la calle Bernabé Soriano: el Ayuntamiento la corta', 'https://medio-b.es/9'),
    ]);

    expect(kept).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it('descarta lo que ya venía visto de ediciones anteriores', () => {
    const { kept, duplicates } = dedupe([item('Algo nuevo', 'https://medio.es/ayer')], {
      seenUrls: ['https://www.medio.es/ayer/'],
    });

    expect(kept).toHaveLength(0);
    // Sin pareja en el lote: el duplicado viene de fuera.
    expect(duplicates[0]?.duplicateOf).toBeUndefined();
  });

  it('deja pasar lo que no se parece', () => {
    const { kept } = dedupe([
      item('Corte en Bernabé Soriano', 'https://a.es/1'),
      item('La Universidad abre el plazo de matrícula', 'https://b.es/2'),
    ]);

    expect(kept).toHaveLength(2);
  });
});
