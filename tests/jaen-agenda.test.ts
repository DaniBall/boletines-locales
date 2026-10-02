import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENDA_SEMANA_URL,
  agendaAyuntamientoJaen,
  completarConFicha,
  parseAgenda,
  parseFicha,
  parseRango,
} from '../ciudades/jaen/collectors/agenda-ayuntamiento.ts';
import type { HttpClient } from '../pipeline/lib/http.ts';
import type { CityConfig } from '../pipeline/types.ts';

/** Estructura real del listado municipal, actividades inventadas (regla 4). */
const leer = () =>
  readFile(path.resolve(import.meta.dirname, 'fixtures', 'jaen', 'agenda-semana.html'), 'utf8');
const leerFicha = () =>
  readFile(path.resolve(import.meta.dirname, 'fixtures', 'jaen', 'ficha-actividad.html'), 'utf8');

describe('parseRango', () => {
  it('lee un tramo de varios días en hora de Madrid', () => {
    expect(parseRango('03 oct. 2026 - 04 oct. 2026')).toEqual({
      desde: '2026-10-03T00:00:00.000+02:00',
      hasta: '2026-10-04T23:59:59.999+02:00',
    });
  });

  it('entiende «sept.» y el cambio de hora de octubre', () => {
    expect(parseRango('30 sept. 2026 - 30 oct. 2026')?.hasta).toBe('2026-10-30T23:59:59.999+01:00');
  });

  it('acepta una fecha suelta y rechaza lo que no es fecha', () => {
    expect(parseRango('02 oct. 2026')?.desde).toBe('2026-10-02T00:00:00.000+02:00');
    expect(parseRango('Próximamente')).toBeUndefined();
  });
});

describe('parseAgenda', () => {
  it('saca cada actividad con su tramo y deja fuera la suspendida', async () => {
    const items = parseAgenda(await leer());

    expect(items.map((i) => i.title)).toEqual([
      'Ciclo de otoño en el auditorio',
      'Concierto de la banda municipal',
      'Teatro de calle en la plaza',
    ]);
    expect(items.every((i) => i.section === 'agenda')).toBe(true);
  });

  it('guarda el precio como resumen para la redacción', async () => {
    const [, concierto, teatro] = parseAgenda(await leer());

    expect(concierto?.summary).toBe('Precio: Actividad gratuita.');
    expect(teatro?.summary).toBe('Precio: Desde 8 € + G.G.');
  });

  it('convierte el enlace a la ficha en una URL absoluta', async () => {
    const [ciclo] = parseAgenda(await leer());

    expect(ciclo?.url).toBe(
      'https://www.aytojaen.es/portal/p_20_contenedor1.jsp?seccion=s_fact_d4_v1.jsp&contenido=1001&tipo=2',
    );
  });

  it('no confunde los enlaces de navegación con actividades', async () => {
    const items = parseAgenda(await leer());
    expect(items.some((i) => i.title.includes('próximos 10'))).toBe(false);
  });
});

describe('parseFicha', () => {
  it('saca la descripción, el lugar y el horario de la ficha', async () => {
    expect(parseFicha(await leerFicha())).toEqual({
      descripcion:
        'Ciclo de música en la calle. La banda municipal toca pasodobles y bandas sonoras para todos los públicos.',
      lugar: 'Plaza de Prueba',
      horario: '19:00 h',
    });
  });

  it('quita el punto final que traen algunos lugares', () => {
    const html =
      '<div id="colD"><p class="ficha"><strong>Lugar celebración: </strong><p>Jardines de Prueba.</p></p></div>';
    expect(parseFicha(html).lugar).toBe('Jardines de Prueba');
  });

  it('no se inventa nada si la ficha no trae esos datos', () => {
    expect(parseFicha('<div id="colD"><h2 class="interior">Sin más</h2></div>')).toEqual({});
  });

  it('recorta las descripciones largas', () => {
    const larga = 'Palabra '.repeat(200);
    const ficha = parseFicha(`<div id="colD"><p class="ficha"><p>${larga}</p></p></div>`);

    expect(ficha.descripcion?.length).toBe(500);
    expect(ficha.descripcion?.endsWith('…')).toBe(true);
  });
});

describe('completarConFicha', () => {
  const item = {
    id: 'x',
    source: 'ayto-jaen-agenda',
    section: 'agenda',
    title: 'Concierto',
    summary: 'Precio: Actividad gratuita.',
  };

  it('pone delante precio y horario, y la ciudad en el lugar para el filtro de alcance', () => {
    expect(
      completarConFicha(
        item,
        { descripcion: 'Pasodobles.', lugar: 'Plaza de Prueba', horario: '19:00 h' },
        'Jaén',
      ),
    ).toMatchObject({
      summary: 'Precio: Actividad gratuita. Horario: 19:00 h. Pasodobles.',
      place: 'Plaza de Prueba, Jaén',
    });
  });

  it('no repite la ciudad si el lugar ya la nombra', () => {
    expect(completarConFicha(item, { lugar: 'Auditorio de Jaén' }, 'Jaén').place).toBe(
      'Auditorio de Jaén',
    );
  });
});

describe('agendaAyuntamientoJaen', () => {
  it('pide el listado y la ficha de cada actividad, una vez cada una', async () => {
    const [listado, ficha] = await Promise.all([leer(), leerFicha()]);
    const pedidas: string[] = [];
    const http = {
      get: (url: string) => {
        pedidas.push(url);
        const body = url === AGENDA_SEMANA_URL ? listado : ficha;
        return Promise.resolve({ url, status: 200, body, fromCache: false });
      },
    } as unknown as HttpClient;

    const items = await agendaAyuntamientoJaen().collect({
      city: { name: 'Jaén' } as CityConfig,
      date: '2026-10-02',
      http,
    });

    expect(pedidas[0]).toBe(AGENDA_SEMANA_URL);
    expect(pedidas).toHaveLength(4);
    expect(new Set(pedidas).size).toBe(4);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ place: 'Plaza de Prueba, Jaén' });
    expect(items[0]?.summary).toContain('Horario: 19:00 h');
  });

  it('si una ficha falla, la actividad sigue con lo del listado (regla 5)', async () => {
    const listado = await leer();
    const http = {
      get: (url: string) =>
        url === AGENDA_SEMANA_URL
          ? Promise.resolve({ url, status: 200, body: listado, fromCache: false })
          : Promise.reject(new Error('La fuente respondió 500.')),
    } as unknown as HttpClient;

    const items = await agendaAyuntamientoJaen().collect({
      city: { name: 'Jaén' } as CityConfig,
      date: '2026-10-02',
      http,
    });

    expect(items).toEqual(parseAgenda(listado));
  });
});
