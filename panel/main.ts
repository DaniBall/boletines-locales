#!/usr/bin/env node
/**
 * `npm run panel`: el panel de revisión en local.
 *
 * - PANEL_HOST (por defecto 127.0.0.1) y PANEL_PORT (por defecto 4322).
 * - PANEL_GIT: off (por defecto), commit o push. Qué hace «Aprobar» con git.
 */
import { generarBorrador } from '../scripts/borrador.ts';
import { parseGitMode } from './git.ts';
import { createPanel } from './servidor.ts';

const host = process.env.PANEL_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PANEL_PORT ?? '4322', 10);
const git = parseGitMode(process.env.PANEL_GIT);

const panel = createPanel({
  git,
  // Regenerar desde el panel es pedirlo a propósito: vale también en festivos.
  regenerate: (city, fecha) => generarBorrador(city, fecha, { forzar: true }),
});

panel.listen(port, host, () => {
  process.stdout.write(`Panel de revisión en http://${host}:${String(port)}/ (git: ${git})\n`);
});
