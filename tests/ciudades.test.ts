import { readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { FESTIVOS_NACIONALES_2026 } from '../ciudades/festivos-comunes.ts';
import { buscarCiudad, ciudades, getCiudad, idsCiudades } from '../ciudades/index.ts';
import { hasEdition } from '../pipeline/lib/fechas.ts';

const root = path.resolve(import.meta.dirname, '..');

describe('el registro de ciudades', () => {
  it('tiene las tres ciudades del plan', () => {
    expect(idsCiudades).toEqual(['jaen', 'leon', 'vitoria']);
  });

  it('devuelve la ciudad que se le pide', () => {
    expect(getCiudad('leon').name).toBe('León');
  });

  it('falla con un mensaje útil si el id no existe', () => {
    expect(() => getCiudad('cuenca')).toThrow(/No existe la ciudad "cuenca"/);
    expect(buscarCiudad('cuenca')).toBeUndefined();
  });
});

describe('cada ciudad', () => {
  it.each(ciudades.map((ciudad) => [ciudad.id, ciudad] as const))(
    '%s tiene una config coherente',
    (_id, ciudad) => {
      expect(ciudad.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(ciudad.name).not.toBe('');
      expect(ciudad.brand.name).not.toBe('');
      expect(ciudad.scope).not.toHaveLength(0);
      // Código INE del municipio: cinco dígitos.
      expect(ciudad.aemetMunicipality).toMatch(/^\d{5}$/);
    },
  );

  it.each(ciudades.map((ciudad) => [ciudad.id, ciudad] as const))(
    '%s no repite ids de sección',
    (_id, ciudad) => {
      const ids = ciudad.sections.map((seccion) => seccion.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(ciudades.map((ciudad) => [ciudad.id, ciudad] as const))(
    '%s arranca por las secciones comunes y en su orden',
    (_id, ciudad) => {
      const comunes = [
        'tiempo',
        'agenda',
        'finde',
        'movilidad',
        'te_afecta',
        'farmacias',
        'carburantes',
      ];
      expect(ciudad.sections.slice(0, comunes.length).map((s) => s.id)).toEqual(comunes);
    },
  );

  it.each(ciudades.map((ciudad) => [ciudad.id, ciudad] as const))(
    '%s declara las temporadas como MM-DD',
    (_id, ciudad) => {
      for (const seccion of ciudad.sections) {
        if (!seccion.season) continue;
        expect(seccion.season.from).toMatch(/^\d{2}-\d{2}$/);
        expect(seccion.season.to).toMatch(/^\d{2}-\d{2}$/);
      }
    },
  );

  it.each(ciudades.map((ciudad) => [ciudad.id, ciudad] as const))(
    '%s tiene su carpeta de contenido con la edición de ejemplo',
    async (_id, ciudad) => {
      const file = path.join(root, 'content', ciudad.id, 'ediciones', '2026-09-18.md');
      const { data } = matter(await readFile(file, 'utf8'));
      // El frontmatter declara su ciudad y coincide con la carpeta.
      expect(data.ciudad).toBe(ciudad.id);
    },
  );

  it.each(ciudades.map((ciudad) => [ciudad.id, ciudad] as const))(
    '%s solo tiene colectores para secciones que existen, con ids únicos',
    (_id, ciudad) => {
      const secciones = new Set(ciudad.sections.map((seccion) => seccion.id));
      for (const colector of ciudad.collectors) {
        expect(secciones, `${colector.id} → ${colector.section}`).toContain(colector.section);
      }
      const ids = ciudad.collectors.map((colector) => colector.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it('solo usa secciones propias que no pisen las comunes', () => {
    const propias = ciudades.flatMap((ciudad) => ciudad.sections.slice(7).map((s) => s.id));
    expect(propias).toEqual(['aceite', 'carreteras', 'tapa', 'tuvisa', 'anillo_verde']);
  });
});

describe('los festivos', () => {
  it.each(ciudades.map((ciudad) => [ciudad.id, ciudad] as const))(
    '%s tiene fechas válidas, ordenadas y sin repetir, con las nacionales',
    (_id, ciudad) => {
      expect(ciudad.holidays.every((fecha) => /^\d{4}-\d{2}-\d{2}$/.test(fecha))).toBe(true);
      expect(ciudad.holidays.every((fecha) => !Number.isNaN(Date.parse(fecha)))).toBe(true);
      expect([...ciudad.holidays]).toEqual([...new Set(ciudad.holidays)].toSorted());
      expect(ciudad.holidays).toEqual(expect.arrayContaining([...FESTIVOS_NACIONALES_2026]));
    },
  );

  it('el 12 de octubre no hay edición en ninguna ciudad', () => {
    expect(ciudades.map((ciudad) => hasEdition('2026-10-12', ciudad.holidays))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('respeta lo propio de cada comunidad y ciudad', () => {
    const edicion = (id: string, fecha: string) => hasEdition(fecha, getCiudad(id).holidays);

    // Andalucía y Castilla y León trasladan Todos los Santos al lunes; Euskadi, no.
    expect(edicion('jaen', '2026-11-02')).toBe(false);
    expect(edicion('leon', '2026-11-02')).toBe(false);
    expect(edicion('vitoria', '2026-11-02')).toBe(true);
    // Locales: Santa Catalina en Jaén, San Froilán en León, la Virgen Blanca en Vitoria.
    expect(edicion('jaen', '2026-11-25')).toBe(false);
    expect(edicion('leon', '2026-11-25')).toBe(true);
    expect(edicion('leon', '2026-10-05')).toBe(false);
    expect(edicion('vitoria', '2026-08-05')).toBe(false);
  });
});

describe('los avisos del ensayo', () => {
  it('el tema de ntfy de cada ciudad es válido y no se repite entre ciudades', () => {
    const temas = ciudades.flatMap((ciudad) =>
      ciudad.rehearsal ? [ciudad.rehearsal.notifyTopic] : [],
    );

    // ntfy.sh admite letras, números, guiones y guiones bajos, hasta 64.
    expect(temas.every((tema) => /^[a-z0-9_-]{20,64}$/.test(tema))).toBe(true);
    expect(new Set(temas).size).toBe(temas.length);
    expect(getCiudad('jaen').rehearsal?.notifyTopic).toMatch(/^boletin-jaen-ensayo-/);
  });
});
