/**
 * Publicar = commit de la edición aprobada. En local no se toca git salvo que
 * se pida; en el VPS, el panel hace commit y push a `main`, y Cloudflare
 * despliega la web de esa ciudad.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** `off`: solo escribe el archivo. `commit`: además, commit. `push`: y push. */
export type GitMode = 'off' | 'commit' | 'push';

export function parseGitMode(valor: string | undefined): GitMode {
  if (valor === undefined || valor === '' || valor === 'off') return 'off';
  if (valor === 'commit' || valor === 'push') return valor;
  throw new Error(`PANEL_GIT tiene que ser off, commit o push, no «${valor}».`);
}

/** Commit de un solo archivo, con el formato de commits del proyecto. */
export async function publishCommit(
  archivo: string,
  mensaje: string,
  mode: GitMode,
  root: string,
): Promise<string | undefined> {
  if (mode === 'off') return undefined;

  const relativo = path.relative(root, archivo);
  await exec('git', ['add', '--', relativo], { cwd: root });
  // Solo ese archivo, aunque haya otras cosas preparadas: un commit, una cosa.
  await exec('git', ['commit', '-m', mensaje, '--', relativo], { cwd: root });
  const { stdout } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: root });

  if (mode === 'push') await exec('git', ['push', 'origin', 'HEAD'], { cwd: root });
  return stdout.trim();
}
