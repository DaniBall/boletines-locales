import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENDA_SEMANA_URL,
  agendaAyuntamientoJaen,
  parseAgenda,
  parseRango,
} from '../ciudades/jaen/collectors/agenda-ayuntamiento.ts';
import type { HttpClient } from '../pipeline/lib/http.ts';
import type { CityConfig } from '../pipeline/types.ts';

/** Estructura real del listado municipal, actividades inventadas (regla 4). */
const leer = () =>
  readFile(path.resolve(import.meta.dirname, 'fixtures', 'jaen', 'agenda-semana.html'), 'utf8');

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

describe('agendaAyuntamientoJaen', () => {
  it('pide el listado de la semana por el cliente compartido', async () => {
    const html = await leer();
    const pedidas: string[] = [];
    const http = {
      get: (url: string) => {
        pedidas.push(url);
        return Promise.resolve({ url, status: 200, body: html, fromCache: false });
      },
    } as unknown as HttpClient;

    const items = await agendaAyuntamientoJaen().collect({
      city: {} as CityConfig,
      date: '2026-10-02',
      http,
    });

    expect(pedidas).toEqual([AGENDA_SEMANA_URL]);
    expect(items).toHaveLength(3);
  });
});
