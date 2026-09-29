# PLAN.md — Boletines diarios locales (Jaén, León y Vitoria-Gasteiz)

Documento vivo: marca las casillas al completar tareas. Las secciones 1 a 12 son comunes a todas las ciudades; lo propio de cada una está en su ficha (sección 13). Las tarifas y los datos de mercado se comprobaron en septiembre de 2026; vuelve a verificarlos antes de cualquier decisión con coste.

## 1. Producto

- **Promesa (borrador):** lo útil de tu ciudad, cada mañana en tu WhatsApp, en menos de tres minutos.
- **Para quién:** gente que vive o trabaja en la ciudad. El alcance exacto está en cada ficha.
- **Frecuencia:** de lunes a viernes. El viernes incluye «Este finde». Sin edición en festivos (lista por ciudad).
- **Qué no es:** ni un periódico, ni una agenda exhaustiva, ni opinión política. Sucesos, solo si afectan a la seguridad o a la movilidad.
- **Ciudades:** Jaén primero; después León y Vitoria-Gasteiz, de una en una, cuando la anterior lleve dos semanas estable. Cada una con su marca, su Canal y su web.
- **Contexto competitivo:** Logronews forma parte de una red de ediciones locales (Pamplona, Logroño, Bilbao, Tudela y Elche) que dice estar preparando ciudades nuevas; en septiembre de 2026 no tenía edición en Jaén, León ni Vitoria-Gasteiz, aunque Vitoria queda cerca de dos de sus ciudades (Bilbao y Pamplona). Identidad propia desde el primer día; como alternativa estratégica, proponerles colaborar.

## 2. Anatomía de una edición

| Orden | Sección | La escribe | Datos |
|---|---|---|---|
| 1 | Saludo, fecha, nº de edición y titular del día | Código + Claude (titular) | todo lo recogido |
| 2 | ☀️ El tiempo | Código | AEMET |
| 3 | 📅 Hoy en la ciudad (viernes: 🎉 Este finde) | Claude | agenda |
| 4 | 🚧 Movilidad | Claude | cortes, obras, DGT |
| 5 | 📰 Te afecta (3–5 entradas) | Claude | noticias útiles |
| 6 | 💊 Farmacias de guardia | Código | colegio de farmacéuticos |
| 7 | ⛽ Gasolina más barata | Código | Ministerio |
| 8 | Secciones propias de la ciudad | Según la ficha | según la ficha |
| 9 | Cierre: envía tu aviso y comparte | Código (textos rotativos) | — |

- Si una sección no tiene datos, se omite. Nunca «sin información».
- Las secciones de temporada solo aparecen en sus fechas (`season` en la config).
- Objetivo: 3.000 caracteres como máximo (menos de 3 minutos de lectura). Si hay poco, la edición es corta.
- Numeración correlativa por ciudad («Edición nº N») en el frontmatter.

Ejemplo de archivo, `content/jaen/ediciones/2026-09-21.md` (lo que va entre llaves son marcadores):

```markdown
---
ciudad: jaen
fecha: 2026-09-21
numero: 12
estado: borrador
fuentes:
  - id: ayto-agenda
    nombre: Ayuntamiento de Jaén
    url: "{url}"
avisos:
  - "farmacias: la fuente no respondió; sección omitida"
---

¡Buenos días, Jaén! Lunes 21 de septiembre, edición nº 12. {titular del día}

## ☀️ El tiempo
Máxima de {máx}° y mínima de {mín}°. {lluvia y viento}. Fuente: AEMET.

## 📅 Hoy en Jaén
- **{Plan}**: {qué, cuándo, dónde y cuánto}. [Más info]({url})

## 📰 Te afecta
- **{Titular propio}**: {por qué te importa}. [Fuente]({url})

## ⛽ Gasolina más barata
- Gasóleo A: {precio} € en {estación} ({dirección})

---
¿Sabes algo que deberíamos contar? {enlace al buzón de avisos}
```

**Render a WhatsApp** (desde el AST de Markdown, no con expresiones regulares):

- `## Título` → `*Título*` en su propia línea, con una línea en blanco antes.
- `**x**` → `*x*`; `_x_` se queda igual; `~~x~~` → `~x~`.
- Viñetas → `• `.
- `[texto](url)` → `texto` y, en la línea siguiente, `👉 url` (URL limpia, sin parámetros `utm_`).
- Última línea: el enlace a la edición en la web de la ciudad.
- Tests con casos límite: `*` y `_` en URLs y nombres, emojis y listas vacías.

## 3. Guía de estilo (base común de `prompts/`)

- Español de España, tuteo, cercano y útil. Humor ligero y de allí, sin caricaturizar la ciudad ni a su gente.
- Cada entrada: un título propio en negrita y una o dos frases con lo práctico (qué, cuándo, dónde, cuánto y cómo).
- Prioridad: lo que cambia el día (cortes, plazos, ayudas, servicios, planes gratis), luego lo curioso y, al final, lo institucional.
- De las instituciones se cuenta el efecto práctico, sin valoraciones ni tono partidista.
- Fechas relativas a la edición («hoy», «mañana», «el sábado»). Horas y precios, solo si vienen en la fuente.
- Sin clickbait ni exclamaciones en cadena. Emojis solo en los títulos de sección.
- Se resume con palabras propias, sin reutilizar frases de las fuentes. Se atribuye cuando da confianza («según el Ayuntamiento»).
- Nunca se rellena: si hay poco, se dice poco.
- Nada del eslogan ni de las fórmulas de Pamplonews/Logronews.
- Cada ciudad añade su toque en `ciudades/<id>/prompts/`: referencias, expresiones y temas de allí.

## 4. Fuentes comunes

El primer paso de cada colector es confirmar que la fuente existe, su formato y sus condiciones de uso. Orden de preferencia: API o RSS, luego HTML estable y, si no, nada. Con fuentes privadas, pedir permiso o limitarse a enlazar. Las fuentes propias de cada ciudad están en su ficha.

| Sección | Fuente | Método | Notas |
|---|---|---|---|
| Tiempo | AEMET OpenData | API con clave gratuita | Código INE del municipio en la config. Citar «Fuente: AEMET». Open-Meteo solo para desarrollar (su plan gratuito es para uso no comercial) |
| Carburantes | API REST de precios de carburantes del Ministerio | JSON sin clave | IDMunicipio de cada ciudad, sacado del listado de su provincia |
| Movilidad | DGT, Punto de Acceso Nacional (DATEX II) | XML | Los accesos de cada ciudad están en su ficha. En Euskadi y Cataluña el tráfico lo gestionan sus gobiernos: allí se usa un colector propio |
| Noticias | RSS de medios locales | RSS | Colector genérico; la lista de feeds va en la config. Titular y enlace; el resumen es propio |
| Farmacias | Colegio de farmacéuticos de cada provincia | HTML | Colector propio de cada ciudad |

## 5. Flujo diario

**Modo mañana (por defecto)**

1. Cron `17 4 * * 1-5` (UTC, es decir, 06:17 en verano y 05:17 en invierno): para cada ciudad de la matriz, `collect`, `select`, `draft`, `validate` y `render`.
2. El workflow abre un PR por ciudad, `edicion/<id>/AAAA-MM-DD`, con la vista previa de WhatsApp en un bloque de código, la tabla de salud de las fuentes, los avisos del validador y lo que se ha descartado.
3. El editor lo revisa desde la app de GitHub y, si hace falta, edita el `.md` en el propio PR.
4. Merge → Cloudflare despliega la web de esa ciudad en uno o dos minutos.
5. El editor abre la edición, pulsa «Copiar para WhatsApp» y la pega en el Canal de esa ciudad hacia las 07:30.

**Modo víspera:** cron `17 19 * * 0-4` (UTC), que genera la edición del día siguiente para revisarla por la noche. Pegarla en el Canal sigue siendo cosa de la mañana, salvo con WAHA (fase 1b).

Sin merge no se publica nada. Cada ciudad añade una revisión diaria: el lanzamiento escalonado, el modo víspera, WAHA o un colaborador local por ciudad lo alivian.

## 6. Redacción con Claude

- Una llamada por edición y ciudad: modelo `claude-sonnet-5`; en `system`, la guía común más el toque local de la ciudad; en `user`, la fecha, el día de la semana y los items seleccionados en JSON (id, título, resumen de la fuente, fecha, lugar y URL).
- Salida con structured outputs (`output_config.format` con JSON Schema; comprueba en la documentación que el modelo lo admite):

```ts
type Entrada = { item_id: string; titulo: string; texto: string }; // sin URLs en `texto`

type Borrador = {
  titular: string; // una frase para el saludo
  secciones: Record<string, Entrada[]>; // solo las secciones que escribe la IA en esa ciudad
  descartes: { item_id: string; motivo: string }[]; // se muestran en el PR
};
```

- `validate` comprueba que:
  - cada `item_id` existe y pertenece a su sección;
  - el `texto` no incluye URLs (el enlace lo pone el código a partir del item);
  - las cifras, horas y fechas del texto aparecen en el item (si no, genera un aviso);
  - se respetan las longitudes (título de 60 caracteres como máximo, texto de dos frases como máximo y edición de 3.000 caracteres como máximo);
  - no aparece ninguna expresión de la lista prohibida (eslóganes ajenos, clickbait).
- Volumen orientativo: unos 15.000 tokens de entrada y 2.000 de salida por edición (ver costes en la sección 9).

## 7. Web

- Una web por ciudad, cada una con su dominio y su identidad (ver ficha), servida desde su propio Worker de Cloudflare (solo assets estáticos, sin código que ejecutar). El código es el mismo; solo cambian la config, los tokens de diseño y los recursos de `ciudades/<id>/public/`.
- Páginas: inicio (edición de hoy y botón para seguir el Canal), `/ediciones/AAAA-MM-DD`, archivo, RSS de ediciones, aviso legal, privacidad y cookies.
- En cada edición: «Copiar para WhatsApp» (al portapapeles), «Compartir por WhatsApp» (`https://wa.me/?text=…`), créditos de las fuentes e imagen OG.
- Sin cookies. Analítica sin cookies (Cloudflare Web Analytics o GoatCounter).

**Brief de diseño común.** Antes de programar la web de una ciudad, define sus tokens (4–6 colores con su hex, las tipografías con su papel y un boceto del layout) y revísalos contra este brief y su ficha:

- Trabajo principal: unirse al Canal con un toque, y leer y compartir la edición de hoy.
- Hero: la edición de hoy tal y como llega al WhatsApp, junto al botón «Seguir el canal».
- Un solo elemento audaz (la ilustración o el bloque de la edición) y el resto, sobrio.
- Evitar: la identidad de Logronews/Pamplonews, el fondo crema con serif y terracota, la maqueta de periódico con filetes, las tarjetas redondeadas idénticas con sombra, las etiquetas en mayúsculas espaciadas y las flechas «→» en los botones.
- Suelo de calidad: mobile-first, contraste AA, foco visible y respeto a `prefers-reduced-motion`.
- Textos con verbos claros: «Seguir el canal», «Leer la edición de hoy», «Copiar para WhatsApp», «Compartir».

## 8. Fases

### Fase 0: cimientos multiciudad

- [x] (Editor) Crear el repo con un nombre neutro, por ejemplo `boletines-locales`, y permitir que Actions cree Pull Requests (Settings → Actions → General → Workflow permissions).
- [x] (Editor) Pedir la clave gratuita de AEMET OpenData y guardarla como secret `AEMET_API_KEY`.
- [ ] (Editor) Guardar `ANTHROPIC_API_KEY` como secret.
- [x] Astro con TypeScript estricto, ESLint y Prettier, Vitest, `.env.example` y `.gitignore` (incluida la caché del pipeline). Node 22 en `.nvmrc`.
- [x] Hook SessionStart en `.claude/settings.json` que ejecute `npm ci` solo cuando `CLAUDE_CODE_REMOTE` sea `true`.
- [x] Estructura multiciudad: `ciudades/index.ts`, `ciudades/jaen/`, `ciudades/leon/` y `ciudades/vitoria/` con su `config.ts` provisional, y la regla de lint que impide importar `ciudades/` desde `pipeline/`.
- [x] Una edición de ejemplo escrita a mano por ciudad y su página en la web, con build por ciudad (`CIUDAD`).
- [x] Render de Markdown a WhatsApp, con tests.
- [x] Workflow `ci.yml`: typecheck, lint, test y build de cada ciudad.
- [ ] (Editor, guiado por Claude Code) Cuenta gratuita de Cloudflare y un Worker por ciudad conectado al repo, con su comando de build y un dominio provisional. Los pasos están abajo.

#### Alta en Cloudflare, paso a paso

Se eligió **Workers con assets estáticos**, no Pages: es lo que recomiendan tanto la documentación de Cloudflare como la de Astro para proyectos nuevos. Las peticiones a assets estáticos son gratis e ilimitadas y no gastan la cuota diaria del plan gratuito.

Lo que ya está en el repo: `ciudades/<id>/wrangler.jsonc` con el Worker de cada ciudad, `wrangler` como dependencia de desarrollo, la página `src/pages/404.astro` y el comando `CIUDAD=jaen npm run deploy`.

Lo que hace el editor, una vez:

1. Crear una cuenta gratuita en `dash.cloudflare.com` con el correo del proyecto. No hace falta tarjeta.
2. En el panel, Workers → crear un Worker importando un repositorio, y autorizar la app de Cloudflare en GitHub solo para este repo.
3. Repetir el paso 2 una vez por ciudad, con estos ajustes (el directorio raíz es la raíz del repo y la rama, `main`):

| Worker | Comando de build | Comando de deploy |
|---|---|---|
| `boletin-jaen` | `CIUDAD=jaen npm run build` | `npx wrangler deploy --config ciudades/jaen/wrangler.jsonc` |
| `boletin-leon` | `CIUDAD=leon npm run build` | `npx wrangler deploy --config ciudades/leon/wrangler.jsonc` |
| `boletin-vitoria` | `CIUDAD=vitoria npm run build` | `npx wrangler deploy --config ciudades/vitoria/wrangler.jsonc` |

4. En cada Worker, Settings → Build → Build watch paths, incluir solo lo suyo y lo común, para que una edición de León no reconstruya las tres webs: `ciudades/<id>/*`, `content/<id>/*`, `src/*`, `pipeline/*`, `astro.config.ts`, `package.json` y `package-lock.json`.
5. Anotar la URL provisional de cada Worker (`https://boletin-<ciudad>.<subdominio>.workers.dev`) y ponerla en `brand.domain` de su `ciudades/<id>/config.ts`, que hoy es `https://example.invalid`.
6. Cuando haya dominios propios: Worker → Settings → Domains & Routes → añadir dominio personalizado, y actualizar `brand.domain`.

### Fase 1: MVP de Jaén (salir en su Canal)

- [x] `pipeline/lib/http`: timeout, reintento, caché, `robots.txt` y User-Agent.
- [ ] Colectores genéricos con fixture y test: tiempo (AEMET), carburantes y RSS.
- [ ] Colectores propios de Jaén para la agenda (Ayuntamiento y una fuente más), con fixture y test, y 3–4 feeds RSS locales en su config.
- [x] `select`: ventana de fechas, alcance, deduplicado (URL y similitud de título) y exclusión de lo publicado en los últimos 14 días.
- [ ] `draft` con structured outputs y prompts versionados (comunes y de la ciudad).
- [ ] `validate` y sección «Avisos». (El paso `validate` está hecho; falta pintar sus avisos en el PR, que llega con `borrador.yml`.)
- [ ] Workflow `borrador.yml` (cron y ejecución manual con `--ciudad` y `--fecha`), con matriz de ciudades, que abre el PR descrito en la sección 5. De momento, solo `jaen` en la matriz.
- [ ] Página de edición con copiar y compartir, archivo y RSS.
- [ ] Landing con la edición de hoy y el botón «Seguir el canal».
- [ ] Páginas legales con huecos para los datos del titular.
- [ ] (Editor) Número dedicado con WhatsApp Business (la app gratuita): crear el Canal de Jaén, añadir tu número personal como segundo admin y poner la URL en la config.
- [ ] Una semana de ensayo sin publicar para ajustar el prompt y las fuentes. Después, lanzamiento.

### Fase 1c: cada ciudad nueva (León y Vitoria-Gasteiz, de una en una)

Esta lista se repite para cada ciudad:

- Completar `ciudades/<id>/config.ts`: alcance, código AEMET, IDMunicipio de carburantes, secciones, festivos y feeds RSS de su ficha.
- Colectores propios (agenda, farmacias y los que marque su ficha), con fixture y test. Los genéricos se reutilizan sin tocarlos; si uno no aplica, como la DGT en Vitoria-Gasteiz, se sustituye por uno propio de la ciudad.
- Toque local en `ciudades/<id>/prompts/`.
- Identidad y web, con su dominio.
- (Editor) Canal de la ciudad (desde el mismo número o desde uno propio), con segundo admin y la URL en la config.
- Añadir la ciudad a la matriz de `borrador.yml`.
- Una semana de ensayo sin publicar. Después, lanzamiento.
- Revisión de la arquitectura: si hubo que tocar el motor, anotar por qué y generalizarlo para la siguiente ciudad.

Progreso:

- [ ] León lanzado.
- [ ] Vitoria-Gasteiz lanzada.

### Fase 1.5: más de cada ciudad

- [ ] Colectores de la fase 1.5 de cada ficha (farmacias, secciones propias, cortes y obras, DGT, universidad y teatros).
- [ ] Edición de viernes con «Este finde».
- [ ] Buzón de vecinos por ciudad: el número de WhatsApp Business para avisos y un formulario de eventos.
- [ ] Imagen OG por edición.
- [ ] Si una fuente devuelve 0 items tres días seguidos, el workflow abre un issue.
- [ ] Bloques de patrocinio por sección, configurables por ciudad y marcados como «Patrocinado» (sección 10).
- [ ] Página «Anúnciate» por ciudad, con los formatos y un contacto, sin precios públicos al principio.

### Fase 1b (opcional): publicar en los Canales sin tocar el móvil

- [ ] WAHA autoalojado en Docker, en un servidor pequeño siempre encendido, con los números dedicados. Publica a la hora fijada la edición ya aprobada de cada ciudad.
- [ ] Detrás de un flag. Es una API no oficial y el número puede acabar bloqueado; por eso cada Canal tiene un segundo admin.

### Fase 2: API oficial de WhatsApp

Infraestructura: un Cloudflare Worker + D1 para el webhook y los suscriptores de todas las ciudades, cada suscriptor con la suya (revisar los límites del plan gratuito). Las webs siguen en sus proyectos.

- [ ] Alta con consentimiento explícito: enlace `wa.me` con el texto «ALTA» (así el número llega verificado) o formulario (nombre, teléfono, código postal opcional y casilla). Guardar la fecha y la versión del texto de consentimiento.
- [ ] Webhook con la firma `X-Hub-Signature-256` verificada. ALTA y BAJA; todo lo demás va al buzón de avisos de su ciudad.
- [ ] Plantilla de marketing aprobada por Meta: saludo, titular del día como variable (las variables no admiten saltos de línea; verificarlo), botón con la URL de la edición y opción de baja.
- [ ] Envío por lotes y por ciudad dentro de los límites de cada número, guardando estados (enviado, entregado, leído, error) y coste estimado.
- [ ] Panel mínimo por ciudad: altas, bajas, entregas, lecturas y coste del mes.
- [ ] Bloque de patrocinio en la edición, marcado como publicidad.

Tarifas en España (agosto de 2026): 0,0509 € por mensaje de marketing entregado. Desde el 1 de octubre de 2026, Meta cobra también los mensajes de servicio dentro de la ventana de 24 h. Además, Meta puede no entregar algunos mensajes de marketing por sus límites por usuario, así que hay que medir y no reintentar en bucle.

### Criterio para pasar a la fase 2 (por ciudad; propuesta, ajústalo)

- [ ] 1.000 seguidores o más en el Canal, lectura estable y un patrocinio que cubra el coste estimado de los envíos (suelo de precio en la sección 10).

## 9. Costes (por ciudad)

| Concepto | Fase 1 | Fase 2 |
|---|---|---|
| Claude API (Sonnet 5: 2 $ por millón de tokens de entrada y 10 $ de salida) | ≈ 1–2 $/mes | igual |
| GitHub Actions | 0 € (repo público, o dentro de los minutos gratuitos si es privado) | igual |
| Cloudflare (web) | 0 € | Worker + D1 compartidos: gratis o pocos euros |
| Dominio | unos 10–15 €/año | igual |
| WhatsApp | 0 € (Canal) | ≈ 1,12 € por suscriptor y mes (22 envíos × 0,0509 €) |
| Servidor | 0 € (VPS pequeño compartido solo si hay WAHA) | igual |

## 10. Financiación

**Referencia.** Logronews no publica cifras, pero funciona con el modelo de la red de Pamplonews, según las entrevistas a su fundador en la Revista de Innovación en Periodismo (diciembre de 2024) y en Tendenci@s (abril de 2026):

- Gratis para el lector: los ingresos vienen de empresas e instituciones locales. Encaja con el mercado, porque en España solo un 12 % paga por noticias (Digital News Report 2024).
- Casi sin publicidad clásica: ninguna en la web y muy poca en el boletín. Venden sobre todo visibilidad pactada con entidades que quieren que se destaquen sus actividades.
- Además: patrocinio de productos (su app de empleo la patrocinó la Cámara de Comercio de Navarra), herramientas para el comercio local (cupones y sorteos) y desarrollo de apps para entidades, que fue la línea que empezó a crecer sola.
- La tienda de merchandising fue un experimento con pocos ingresos y el primer evento no dejó dinero.
- Lo que lo hace viable es el coste: un equipo mínimo (tres personas para todas las ediciones en 2026) y tecnología compartida. El tono positivo y sin polémicas facilita los patrocinios.

### Principios

- El lector no paga y lo pagado nunca se disfraza: todo va marcado como «Patrocinado» o «Publicidad», como exige la LSSI.
- Como mucho un bloque patrocinado por edición, con exclusividad por categoría (un solo gimnasio, una sola almazara…).
- El patrocinador no decide ni revisa contenidos, y la información sobre él se trata como cualquier otra.
- Publicidad institucional sí, etiquetada y sin condicionar la información. Propaganda de partidos, apuestas y productos milagro, no.
- Ningún cliente por encima del 40 % de los ingresos (propuesta, ajústalo).
- Nada de tienda ni eventos propios al principio.

### Formatos

| Formato | Qué es | Clientes típicos | Fase |
|---|---|---|---|
| Patrocinio de sección | «{sección}, con {marca}», por semanas o meses | Marcas ligadas a la sección (aceite en Jaén; cecina, vino o tapas en León; vino de Rioja Alavesa en Vitoria-Gasteiz) | 1.5 |
| Visibilidad pactada | Destacar la programación de una entidad, con etiqueta | Ayuntamientos, diputaciones, universidades, teatros y promotores | 1.5 |
| Sorteo patrocinado | Entradas, cenas o productos para los lectores | Hostelería, cultura y comercio | 1.5 |
| Patrocinio de una herramienta | Una utilidad propia (farmacias de guardia, precios, empleo) con su patrocinador | Cámaras de Comercio, organizaciones empresariales y diputaciones | 2 |
| Comercio local | Ofertas y cupones de comercios de barrio | Asociaciones de comerciantes | 2 |
| Paquete de red | El mismo patrocinio en todas las ciudades a la vez | Marcas regionales o nacionales | Con dos o más ciudades en marcha |
| Servicios a medida | Webs y apps para entidades locales | Instituciones y empresas | Cuando surja |

Los clientes concretos de cada ciudad están en su ficha.

### Precio

- Fase 1, sin tarifas públicas: un patrocinador fundador por ciudad a precio simbólico a cambio de testimonio y opinión, y cinco conversaciones con posibles clientes antes de construir nada para anunciantes.
- Dossier comercial con datos reales: seguidores del Canal, visitas a la web por edición, clics salientes y avisos recibidos (en fase 2, también entregas y lecturas).
- Suelo en fase 2, por ciudad: los patrocinios del mes deben cubrir al menos el envío, unos 1,12 € por suscriptor. Con 2.000 suscriptores son unos 2.240 €/mes; repartido entre cuatro patrocinadores de sección, 560 € cada uno solo para empatar.

### Administración

- Para facturar hay que estar dado de alta (autónomo o sociedad): consúltalo con una gestoría antes del primer cobro.
- Acuerdo por escrito con cada patrocinador: formato, fechas, precio, etiqueta de publicidad y que no condiciona los contenidos.

### Tareas del editor

- [ ] Lista de 20 posibles clientes por ciudad, por categorías.
- [ ] Cinco conversaciones de validación por ciudad antes de fijar precios.
- [ ] Patrocinador fundador en cada ciudad.
- [ ] Dossier comercial con los datos de la fase 1 de cada ciudad.

## 11. Legal (mínimos; no es asesoramiento)

- Un mismo titular para todas las ediciones, con aviso legal en cada web.
- Fase 1: aviso legal (LSSI: titular, NIF y contacto), política de privacidad y política de cookies (declarando que no hay). Solo se tratan los datos de quien envía avisos de forma voluntaria.
- Fase 2: RGPD completo (consentimiento, finalidad, conservación, derechos, baja inmediata, registro de actividades y encargados como Meta y Cloudflare), comunicaciones comerciales con consentimiento previo (LSSI) y publicidad identificable. Conviene revisarlo con una asesoría.
- Contenidos: resúmenes propios con enlace, imágenes propias o con licencia y atribución de los datos (AEMET, Ministerio).

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Una fuente cambia su HTML | Fixtures, issue automático y commit `:alien:` |
| Alucinaciones | Cifras por código, validador y revisión humana |
| Todo depende de una persona cada mañana, y cada ciudad suma una revisión | Lanzamiento escalonado, modo víspera, WAHA o un colaborador local por ciudad con permisos en el repo |
| Una ciudad obliga a tocar el motor | Regla 8 de `CLAUDE.md` y revisión de la arquitectura al lanzar cada ciudad |
| Choque de marca con la red de Logronews | Identidad propia, o proponerles colaborar |
| Competencia directa en Vitoria-Gasteiz (GasteizBerri ya ofrece servicios en su web y la red de Logronews está al lado) | Diferenciarse por el formato (llega solo, corto y a primera hora) y por el tono; valorar adelantar su lanzamiento |
| Coste de la fase 2 | No activarla sin patrocinio; tope de gasto mensual con alertas |
| Depender de un solo cliente o institución | Tope del 40 % por cliente y cartera variada (sección 10) |

## 13. Fichas de ciudad

Para añadir una ciudad: copia una ficha, rellénala y crea `ciudades/<id>/`.

### 13.1 Jaén (`jaen`)

- **Alcance:** la capital y lo del entorno que afecte a quien vive en ella (accesos, La Guardia, Los Villares, Mancha Real, Torredelcampo…).
- **Sección propia:** 🫒 El aceite, con el precio en origen (la escribe el código).
- **Ganchos de lanzamiento:** la Feria de San Lucas (octubre) y el inicio de la campaña de la aceituna.
- **Identidad (propuesta):** el olivar y el aceite (verde oliva profundo y dorado de aceite nuevo) sobre blanco. Mascota posible: el Lagarto de la Malena, dibujado por alguien de Jaén.
- **Competencia:** las alertas por WhatsApp de Diario JAÉN, la agenda web de EnJaen.es y la newsletter mensual de la Diputación. Ninguna es un boletín de servicio de primera hora.
- **Clientes naturales:** cooperativas, almazaras y denominaciones de origen del aceite; Ayuntamiento, Diputación y Universidad de Jaén; Cámara de Comercio; asociaciones de comerciantes; teatros y promotores.

Fuentes propias (inventario inicial por verificar):

| Sección | Fuente candidata | Método probable | Notas |
|---|---|---|---|
| Tiempo | AEMET, municipio 23050 | API | Colector genérico |
| Agenda | Ayuntamiento de Jaén (agenda y notas de prensa) | HTML o RSS | Fuente primaria |
| Agenda | EnJaen.es | HTML | Web privada: pedir permiso o solo enlazar |
| Agenda | Diputación (Jaén Paraíso Interior) | HTML | Es provincial: filtrar a la capital |
| Agenda | Universidad de Jaén, Teatro Infanta Leonor, Teatro Darymelia, Auditorio de la Alameda | HTML o RSS | Programación |
| Movilidad | Ayuntamiento (cortes y obras) | HTML o RSS | Lo que la Policía Local publica solo en redes sociales queda fuera |
| Movilidad | DGT | XML | Accesos A-44 y A-316 |
| Noticias | Hora Jaén, Ideal Jaén (ruta `/jaen/jaen/`) y Diario JAÉN (ruta `/jaen/`) | RSS y sitemap de noticias | **Verificadas el 29-09-2026 y en la config.** Diario JAÉN no tiene RSS: se lee su sitemap de noticias, sin resumen. Descartadas: Jaén Hoy (su RSS es solo opinión) y noticiasdejaen.es (sin feed). Pendientes de red: Viva Jaén (ahora en `andaluciainformacion.es`) y La Contra de Jaén (redirige a su dominio sin `www`) |
| Farmacias | Colegio Oficial de Farmacéuticos de Jaén | HTML | Investigar el formato |
| Carburantes | API del Ministerio | JSON | **Verificada el 30-09-2026 y en la config**: IDMunicipio 3543 |
| Aceite | Poolred o Infaoliva | HTML | Revisar condiciones de uso; dato del día anterior |
| Deporte (fase 1.5) | Real Jaén, Jaén Paraíso Interior FS | HTML | Partidos del finde |
| Bus (fase 2+) | Consorcio de Transporte Metropolitano del Área de Jaén | API de la red CTAN | Cambios de líneas y horarios |

### 13.2 León (`leon`)

- **Alcance:** la capital y su alfoz (San Andrés del Rabanedo, Villaquilambre, Valverde de la Virgen, Sariegos…).
- **Secciones propias (propuestas, a validar):** ❄️ Carreteras y nieve, de temporada (noviembre a marzo), con puertos, cadenas y cortes a partir de la DGT (la escribe el código); y 🍢 La tapa, con una recomendación en el Húmedo o el Romántico, que además es un buen hueco para patrocinios.
- **Ganchos de lanzamiento:** la Semana Santa, las fiestas de San Juan y San Pedro (junio) y San Froilán (octubre).
- **Identidad (propuesta):** el color de las vidrieras de la Catedral sobre piedra como elemento audaz. Evitar el león heráldico literal, que ya usa todo el mundo.
- **Competencia:** los canales de WhatsApp de Leonoticias (desde 2023) y Diario de León (desde 2024), con titulares y última hora. Ninguno es un boletín de servicio de primera hora.
- **Clientes naturales:** Ayuntamiento, Diputación y Universidad de León; Cámara de Comercio; hostelería del Húmedo y el Romántico; IGP Cecina de León y DO León; comercio del centro; clubes como la Cultural Leonesa o el Ademar.

Fuentes propias (inventario inicial por verificar):

| Sección | Fuente candidata | Método probable | Notas |
|---|---|---|---|
| Tiempo | AEMET, municipio 24089 | API | Colector genérico |
| Agenda | Ayuntamiento de León (aytoleon.es, agenda y notas de prensa) | HTML o RSS | Fuente primaria |
| Agenda | Leónjoven.net | HTML | Planes, cursos y convocatorias para jóvenes |
| Agenda | Universidad de León, Auditorio Ciudad de León, Diputación | HTML o RSS | Programación |
| Movilidad | Ayuntamiento (cortes y obras) | HTML o RSS | Fuente primaria |
| Movilidad | DGT | XML | Accesos A-66, A-231, AP-71 y N-601; en invierno, puertos de la provincia |
| Noticias | Diario de León, Leonoticias, La Nueva Crónica, iLeón, Digital de León y Ahora León | RSS | Colector genérico |
| Farmacias | Colegio Oficial de Farmacéuticos de León | HTML | Investigar el formato |
| Carburantes | API del Ministerio | JSON | **Verificada el 30-09-2026 y en la config**: IDMunicipio 3674 |
| La tapa | Archivo en el repo que rellena el editor, o formulario | Manual | Sin fuente automática; también entra por patrocinio |
| Deporte (fase 1.5) | Cultural Leonesa, Ademar León | HTML | Partidos del finde |

### 13.3 Vitoria-Gasteiz (`vitoria`)

- **Alcance:** la ciudad y sus concejos rurales (el municipio coincide con la Cuadrilla de Vitoria). Del resto de Álava, solo lo que afecte a quien vive en la capital.
- **Idioma (propuesta, a validar):** en castellano, con la toponimia oficial bilingüe y algún guiño en euskera, como el saludo («Egun on, Gasteiz!»).
- **Secciones propias (propuestas, a validar):** 🚋 TUVISA y tranvía, con cambios de líneas, gratuidades y cortes (la escribe el código si hay datos abiertos; si no, Claude); y 🌳 Anillo Verde, con un plan de naturaleza para el finde, los viernes.
- **Ganchos de lanzamiento:** la Navidad y el Olentzero, el Festival de Jazz (julio) y las fiestas de La Blanca (agosto).
- **Identidad (propuesta):** el verde del Anillo Verde y Salburua; como guiño, el paraguas de Celedón. Evitar el cartel oficial de fiestas.
- **Competencia:** es la ciudad más disputada de las tres. GasteizBerri ya ofrece en su web una sección de servicios (tiempo, agenda, farmacias, TUVISA, obras y cortes, gasolineras) y recibe avisos de vecinos por WhatsApp; Noticias de Álava tiene newsletters por email; Norte Exprés publica los cortes de tráfico del día; y está Gasteiz Hoy. Ninguno es un boletín de servicio de primera hora por WhatsApp, así que la diferencia tiene que estar en el formato (llega solo, corto y a las 7:30) y en el tono. Además, la red de Logronews está en Bilbao y Pamplona, muy cerca.
- **Clientes naturales:** Ayuntamiento y Diputación Foral de Álava; Fundación Vital; Cámara de Comercio de Álava; asociaciones de comercio y hostelería; hostelería del Casco Viejo y el Ensanche; bodegas de Rioja Alavesa; clubes como el Baskonia o el Alavés.

Fuentes propias (inventario inicial por verificar):

| Sección | Fuente candidata | Método probable | Notas |
|---|---|---|---|
| Tiempo | AEMET, municipio 01059 | API | Colector genérico. Euskalmet (Open Data Euskadi) como alternativa local, por verificar |
| Agenda | Ayuntamiento de Vitoria-Gasteiz (vitoria-gasteiz.org) | HTML o datos abiertos | Fuente primaria |
| Agenda | Red Municipal de Teatros, Artium, Fundación Vital, Diputación Foral (araba.eus) | HTML o RSS | Programación |
| Movilidad | Ayuntamiento: calendario de incidencias de tráfico por obras y trabajos | HTML | Fuente primaria para los cortes en la ciudad |
| Movilidad | Tráfico del Gobierno Vasco (Open Data Euskadi) | API o XML | Sustituye al colector de la DGT. Accesos A-1, AP-1, N-622 y AP-68 |
| Transporte | TUVISA y tranvía (Euskotren) | Datos abiertos o HTML | Para la sección 🚋 |
| Noticias | El Correo (Álava), Noticias de Álava, Gasteiz Hoy, Norte Exprés y GasteizBerri | RSS | Colector genérico; GasteizBerri es además competencia |
| Farmacias | Colegio Oficial de Farmacéuticos de Álava | HTML | Investigar el formato |
| Carburantes | API del Ministerio | JSON | **Verificada el 30-09-2026 y en la config**: IDMunicipio 46 |
| Deporte (fase 1.5) | Baskonia, Deportivo Alavés | HTML | Partidos del finde |
