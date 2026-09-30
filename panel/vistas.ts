/**
 * HTML del panel. Páginas pequeñas, sin JavaScript de terceros, pensadas para
 * revisar desde el móvil. Todo lo que viene de fuera se escapa.
 */
import type { SourceHealth } from '../pipeline/steps/collect.ts';
import { messageLength } from '../pipeline/steps/validate.ts';
import type { EditionReport } from '../pipeline/steps/edition.ts';
import type { CityConfig, Edition } from '../pipeline/types.ts';

export function escapeHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const ESTILOS = `
:root {
  --fondo: #f6f7f5; --superficie: #ffffff; --texto: #1d2320; --suave: #5c6661;
  --borde: #d6dbd8; --acento: #1f6f4a; --acento-texto: #ffffff;
  --aviso: #8a5a00; --aviso-fondo: #fff4d6; --error: #a1261b; --ok: #1f6f4a;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: #121614; --superficie: #1b201d; --texto: #e7ece9; --suave: #a3ada8;
    --borde: #313a35; --acento: #5fc596; --acento-texto: #0d1a13;
    --aviso: #f3c35b; --aviso-fondo: #2e2610; --error: #ff8a7a; --ok: #5fc596;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--fondo); color: var(--texto);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 1rem; }
a { color: var(--acento); }
h1 { font-size: 1.4rem; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
section > h2:first-child { margin-top: 0.25rem; }
section, details { background: var(--superficie); border: 1px solid var(--borde);
  border-radius: 8px; padding: 0.75rem 1rem; margin: 0 0 1rem; }
ul { padding-left: 1.2rem; margin: 0.25rem 0; }
.estado { display: inline-block; font-size: 0.8rem; padding: 0 0.5rem; border-radius: 999px;
  border: 1px solid currentColor; }
.estado-borrador { color: var(--aviso); }
.estado-publicada { color: var(--ok); }
.avisos { background: var(--aviso-fondo); border-color: var(--aviso); }
.mensaje { border-color: var(--acento); }
.error { color: var(--error); }
pre { white-space: pre-wrap; word-break: break-word; margin: 0;
  font: 0.95rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
textarea { width: 100%; min-height: 24rem; padding: 0.75rem; border-radius: 6px;
  border: 1px solid var(--borde); background: var(--fondo); color: var(--texto);
  font: 0.95rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
button { font: inherit; padding: 0.6rem 1rem; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--acento); background: var(--superficie); color: var(--acento); }
button.principal { background: var(--acento); color: var(--acento-texto); }
button:focus-visible, a:focus-visible, textarea:focus-visible { outline: 3px solid var(--acento);
  outline-offset: 2px; }
.acciones { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; margin-top: 0.75rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.25rem 0.5rem 0.25rem 0; border-bottom: 1px solid var(--borde); }
td.num { text-align: right; }
`;

function pagina(titulo: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(titulo)}</title>
<style>${ESTILOS}</style>
</head>
<body><main>${cuerpo}</main></body>
</html>`;
}

function estado(edicion: Edition): string {
  const valor = edicion.frontmatter.estado;
  return `<span class="estado estado-${valor}">${valor}</span>`;
}

export interface CityEditions {
  city: CityConfig;
  editions: Edition[];
}

export function vistaInicio(ciudades: readonly CityEditions[]): string {
  const bloques = ciudades.map(({ city, editions }) => {
    const filas =
      editions.length === 0
        ? '<p>Sin ediciones todavía.</p>'
        : `<ul>${editions
            .map(
              (edicion) =>
                `<li><a href="/${city.id}/${edicion.frontmatter.fecha}/">${edicion.frontmatter.fecha}</a> · nº ${String(edicion.frontmatter.numero)} ${estado(edicion)}</li>`,
            )
            .join('')}</ul>`;
    return `<section><h2>${escapeHtml(city.name)}</h2>${filas}</section>`;
  });
  return pagina('Panel de revisión', `<h1>Panel de revisión</h1>${bloques.join('')}`);
}

export interface EditionView {
  city: CityConfig;
  edition: Edition;
  whatsapp: string;
  report?: EditionReport;
  /** Aviso de la última acción: «Guardado», o un error. */
  flash?: { texto: string; error?: boolean };
}

export function vistaEdicion(vista: EditionView): string {
  const { city, edition, whatsapp, report, flash } = vista;
  const { fecha, numero } = edition.frontmatter;
  const base = `/${city.id}/${fecha}`;
  const avisos = edition.frontmatter.avisos ?? [];
  const caracteres = messageLength(whatsapp);

  const partes = [
    `<p><a href="/">← Todas las ediciones</a></p>`,
    `<h1>${escapeHtml(city.name)} · ${fecha} · nº ${String(numero)} ${estado(edition)}</h1>`,
    flash
      ? `<p class="${flash.error ? 'error' : ''}" role="status">${escapeHtml(flash.texto)}</p>`
      : '',
    avisos.length === 0
      ? ''
      : `<section class="avisos"><h2>Avisos</h2><ul>${avisos
          .map((aviso) => `<li>${escapeHtml(aviso)}</li>`)
          .join('')}</ul></section>`,
    `<section class="mensaje"><h2>Así llega a WhatsApp (${String(caracteres)} caracteres)</h2><pre>${escapeHtml(whatsapp)}</pre></section>`,
    `<form method="post" action="${base}/guardar"><section>
      <h2><label for="cuerpo">Editar el Markdown</label></h2>
      <textarea id="cuerpo" name="cuerpo" spellcheck="true">${escapeHtml(edition.body)}</textarea>
      <div class="acciones"><button type="submit">Guardar cambios</button></div>
    </section></form>`,
    edition.frontmatter.estado === 'publicada'
      ? '<section><p>Publicada. Para corregirla, edita el Markdown y guarda: se vuelve a publicar.</p></section>'
      : `<section><h2>Aprobar y publicar</h2>
      <form method="post" action="${base}/aprobar">
        <p><label><input type="checkbox" name="revisado" required> He leído la edición y los avisos, y todo sale de las fuentes.</label></p>
        <div class="acciones"><button type="submit" class="principal">Aprobar</button></div>
      </form>
      <form method="post" action="${base}/regenerar">
        <div class="acciones"><button type="submit">Regenerar el borrador</button>
        <span>Vuelve a pedir a las fuentes y a Claude. Pisa los cambios sin guardar.</span></div>
      </form>
    </section>`,
    report
      ? vistaInforme(report)
      : '<p>No hay informe de revisión de esta edición en esta máquina.</p>',
  ];
  return pagina(`${city.name} ${fecha} · Revisión`, partes.join('\n'));
}

function vistaInforme(report: EditionReport): string {
  const fuentes = report.health.map(filaFuente).join('');
  const descartesIa = report.descartesIa ?? [];
  return [
    `<details><summary>Fuentes (${String(report.health.length)})</summary>
      <table><thead><tr><th>Fuente</th><th>Sección</th><th>Estado</th><th class="num">Items</th></tr></thead>
      <tbody>${fuentes}</tbody></table></details>`,
    `<details><summary>Descartados por Claude (${String(descartesIa.length)})</summary><ul>${descartesIa
      .map((d) => `<li><code>${escapeHtml(d.item_id)}</code>: ${escapeHtml(d.motivo)}</li>`)
      .join('')}</ul></details>`,
    `<details><summary>Descartados por select (${String(report.discarded.length)})</summary><ul>${report.discarded
      .map(
        (d) =>
          `<li>${escapeHtml(d.item.title)} <small>(${escapeHtml(d.reason)}${d.detail ? `: ${escapeHtml(d.detail)}` : ''})</small></li>`,
      )
      .join('')}</ul></details>`,
  ].join('\n');
}

function filaFuente(fuente: SourceHealth): string {
  const estadoFuente =
    fuente.status === 'error'
      ? `<span class="error">error: ${escapeHtml(fuente.error ?? '')}</span>`
      : escapeHtml(fuente.status);
  return `<tr><td>${escapeHtml(fuente.id)}</td><td>${escapeHtml(fuente.section)}</td><td>${estadoFuente}</td><td class="num">${String(fuente.items)}</td></tr>`;
}

export function vistaError(status: number, texto: string): string {
  return pagina(
    `Error ${String(status)}`,
    `<h1>Error ${String(status)}</h1><p>${escapeHtml(texto)}</p><p><a href="/">Volver</a></p>`,
  );
}
