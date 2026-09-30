#!/usr/bin/env node
/**
 * CLI: une el motor (`pipeline/`) con las ciudades (`ciudades/`).
 */
import { getCiudad, idsCiudades } from '../ciudades/index.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { http as httpConfig } from '../pipeline/config.ts';
import { editionNumber, editionUrl, readEdition, writeEdition } from '../pipeline/lib/edicion.ts';
import { hasEdition, today } from '../pipeline/lib/fechas.ts';
import { HttpClient } from '../pipeline/lib/http.ts';
import { renderWhatsapp } from '../pipeline/render/whatsapp.ts';
import { collect, formatHealthTable } from '../pipeline/steps/collect.ts';
import { generateEdition } from '../pipeline/steps/edition.ts';

function parseArgs(argv: string[]): { command: string; flags: Map<string, string> } {
  const [command = 'ayuda', ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, 'true');
    }
  }
  return { command, flags };
}

const AYUDA = `Uso: npm run <comando> -- --ciudad <id> [--fecha AAAA-MM-DD]

  whatsapp   Imprime el texto listo para pegar en el Canal.
  edicion    Genera la edición (fase 1).
  fuentes    Tabla de salud de las fuentes: pide a cada una y dice cómo está.
  ciudades   Lista las ciudades. Con --json, la matriz que consume el CI.

Ciudades: ${idsCiudades.join(', ')}
`;

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === 'ayuda') {
    process.stdout.write(AYUDA);
    return 0;
  }

  // El registro es la única lista de ciudades: de aquí la saca también la
  // matriz de `ci.yml`, para no repetirla a mano en el workflow.
  if (command === 'ciudades') {
    const salida = flags.has('json') ? JSON.stringify(idsCiudades) : idsCiudades.join('\n');
    process.stdout.write(`${salida}\n`);
    return 0;
  }

  const ciudadId = flags.get('ciudad') ?? process.env.CIUDAD;
  if (!ciudadId) {
    process.stderr.write(`Falta --ciudad. Las que hay: ${idsCiudades.join(', ')}.\n`);
    return 1;
  }
  const ciudad = getCiudad(ciudadId);
  const fecha = flags.get('fecha') ?? today();

  switch (command) {
    case 'whatsapp': {
      const edicion = await readEdition(ciudad.id, fecha);
      process.stdout.write(
        `${renderWhatsapp(edicion.body, { editionUrl: editionUrl(ciudad, fecha) })}\n`,
      );
      return 0;
    }

    case 'fuentes': {
      // Pide de verdad a cada fuente: es la forma de saber si siguen vivas.
      const { items, health } = await collect(ciudad, fecha, new HttpClient());
      const errores = health.filter((fuente) => fuente.status === 'error').length;
      process.stdout.write(
        `Fuentes de ${ciudad.name} (${fecha})\n\n${formatHealthTable(health)}\n\n` +
          `${String(items.length)} items de ${String(health.length)} fuentes, ${String(errores)} con error.\n`,
      );
      // Con alguna fuente caída sale con error, para que un workflow lo note.
      return errores > 0 ? 1 : 0;
    }

    case 'edicion':
      return edicion(ciudad, fecha, flags);

    default:
      process.stdout.write(AYUDA);
      return 1;
  }
}

/** Genera la edición del día, la escribe y deja el informe para la revisión. */
async function edicion(
  ciudad: ReturnType<typeof getCiudad>,
  fecha: string,
  flags: Map<string, string>,
): Promise<number> {
  const forzar = flags.has('forzar');
  if (!hasEdition(fecha, ciudad.holidays) && !forzar) {
    process.stderr.write(
      `${fecha} no tiene edición en ${ciudad.name} (fin de semana o festivo). Usa --forzar para generarla igual.\n`,
    );
    return 1;
  }

  // Nunca se pisa una edición ya publicada sin pedirlo.
  const existente = await readEdition(ciudad.id, fecha).catch(() => undefined);
  if (existente?.frontmatter.estado === 'publicada' && !forzar) {
    process.stderr.write(
      `La edición de ${fecha} ya está publicada. Usa --forzar para regenerarla.\n`,
    );
    return 1;
  }

  // La redacción con Claude llega en el siguiente paso; hasta entonces, sin IA.
  const { edition, report } = await generateEdition({
    city: ciudad,
    date: fecha,
    http: new HttpClient(),
    numero: await editionNumber(ciudad.id, fecha),
    weekend: { from: 'agenda', to: 'finde' },
  });

  const archivo = await writeEdition(edition);
  const informe = path.join(httpConfig.cacheDir, 'revision', ciudad.id, `${fecha}.json`);
  await mkdir(path.dirname(informe), { recursive: true });
  // El informe lleva titulares de terceros: va a la caché, fuera de git (regla 4).
  await writeFile(informe, JSON.stringify(report, null, 2), 'utf8');

  const avisos = edition.frontmatter.avisos ?? [];
  process.stdout.write(
    [
      `Edición nº ${String(edition.frontmatter.numero)} de ${ciudad.name} (${fecha}) → ${path.relative(process.cwd(), archivo)}`,
      '',
      formatHealthTable(report.health),
      '',
      `Descartados por select: ${String(report.discarded.length)}.`,
      avisos.length === 0
        ? 'Sin avisos.'
        : `Avisos:\n${avisos.map((aviso) => `  - ${aviso}`).join('\n')}`,
      '',
      `Informe de revisión: ${informe}`,
      `Texto de WhatsApp: npm run whatsapp -- --ciudad ${ciudad.id} --fecha ${fecha}`,
      '',
    ].join('\n'),
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
