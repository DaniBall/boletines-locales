import { readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { buscarCiudad, ciudades, getCiudad, idsCiudades } from '../ciudades/index.ts';

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
