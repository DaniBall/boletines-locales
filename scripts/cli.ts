#!/usr/bin/env node
/**
 * CLI: une el motor (`pipeline/`) con las ciudades (`ciudades/`).
 */
import path from 'node:path';
import { getCiudad, idsCiudades } from '../ciudades/index.ts';
import { editionUrl, readEdition } from '../pipeline/lib/edicion.ts';
import { today } from '../pipeline/lib/fechas.ts';
import { HttpClient } from '../pipeline/lib/http.ts';
import { renderWhatsapp } from '../pipeline/render/whatsapp.ts';
import { collect, formatHealthTable } from '../pipeline/steps/collect.ts';
import { generarBorrador } from './borrador.ts';

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
  edicion    Genera el borrador de la edición. Redacta con Claude si hay
             ANTHROPIC_API_KEY; con --sin-ia, no. --forzar para festivos o para
             regenerar una publicada.
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

/** Genera el borrador del día y resume cómo ha ido. */
async function edicion(
  ciudad: ReturnType<typeof getCiudad>,
  fecha: string,
  flags: Map<string, string>,
): Promise<number> {
  const resultado = await generarBorrador(ciudad, fecha, {
    forzar: flags.has('forzar'),
    sinIa: flags.has('sin-ia'),
  });
  if (!resultado.ok) {
    process.stderr.write(`${resultado.motivo}\n`);
    return 1;
  }

  const { edition, report, archivo, informe } = resultado;
  const avisos = edition.frontmatter.avisos ?? [];
  process.stdout.write(
    [
      `Edición nº ${String(edition.frontmatter.numero)} de ${ciudad.name} (${fecha}) → ${path.relative(process.cwd(), archivo)}`,
      '',
      formatHealthTable(report.health),
      '',
      `Descartados por select: ${String(report.discarded.length)}. Descartados por Claude: ${String(report.descartesIa.length)}.`,
      avisos.length === 0
        ? 'Sin avisos.'
        : `Avisos:\n${avisos.map((aviso) => `  - ${aviso}`).join('\n')}`,
      '',
      `Informe de revisión: ${path.relative(process.cwd(), informe)}`,
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
