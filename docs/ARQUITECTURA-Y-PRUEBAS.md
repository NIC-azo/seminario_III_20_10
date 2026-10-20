# Arquitectura, construcción y pruebas

**Proyecto:** Mini-Juztina
**Última verificación del código:** 20 de octubre de 2026

## 1. Objetivo

Prototipo local de consulta documental para la Constitución Política del Perú
y el Código Penal peruano. La respuesta se acompaña de identificadores de cita,
extractos literales y artículos inspeccionables. El sistema evita usar APIs
generativas en la nube: el modelo de embeddings, el LLM y LanceDB se ejecutan
localmente.

La descarga inicial de dependencias, HTML e imágenes/modelos requiere Internet.
“Local” describe la ruta de inferencia y operación, no la descarga inicial de
los componentes.

## 2. Construcción por módulos y relación con el enunciado

### Módulo 1 — ETL y normalización

**Implementación:** `backend/src/data_pipeline/etl.ts`, con Cheerio y TypeScript.

1. Lee HTML locales ubicados en `backend/data/raw/`.
2. Localiza el contenedor principal de contenido y falla explícitamente si no
   existe o no encuentra artículos.
3. Elimina scripts, estilos, navegación, cabeceras, pies, formularios, anuncios,
   imágenes e incrustaciones que no son contenido normativo.
4. Mantiene jerarquía `Libro → Título → Capítulo → Artículo`, incisos y numerales.
5. Emite un chunk por artículo, con metadatos, texto normativo y una ruta
   jerárquica redundante en `chunk_text`.
6. Extrae las notas y URL de jurisprudencia como metadatos independientes; no
   las mezcla con el texto del artículo. Evita duplicados exactos por texto y
   URL.
7. Escribe JSON versión `1.0` en `backend/data/processed/`.

Las páginas procesadas durante la ejecución de referencia fueron instantáneas
de LP Derecho:

- Constitución: <https://lpderecho.pe/constitucion-politica-peru-actualizada/>
- Código Penal: <https://lpderecho.pe/codigo-penal-peruano-actualizado/>

Los HTML y JSON se excluyen del repositorio por cautela respecto a condiciones
de redistribución; el enunciado los llama fuentes oficiales, pero las páginas
utilizadas son de un repositorio secundario. Esa procedencia debe aclararse en
una presentación y comprobarse con la publicación normativa oficial.

### Módulo 2 — API, indexación y RAG

**Componentes:** Express 5, TypeScript, LanceDB local y Ollama.

- `ingestController.ts` valida el esquema ETL, los campos requeridos y la
  unicidad de IDs; solicita embeddings de `chunk_text` a Ollama en lotes de 16.
- `vectorStore.ts` conserva texto y metadatos junto a los vectores. Recupera
  candidatos semánticos de LanceDB y los combina con ranking léxico mediante
  Reciprocal Rank Fusion; el límite predeterminado es 5.
- `ollamaClient.ts` se comunica con `/api/embed`, `/api/chat` y `/api/tags`.
  Modelos predeterminados: `nomic-embed-text` y `qwen2.5:3b`. Ollama no se
  instala con npm; puede ejecutarse nativamente o como contenedor Docker
  separado.
- `chatController.ts` gestiona sesiones en memoria, limita el historial enviado
  al modelo, solicita un objeto JSON estructurado y valida cada evidencia contra
  el contenido literal del artículo citado. Una respuesta no verificable no se
  presenta como válida y causa HTTP 502 con fuentes recuperadas.
- Las consultas reconocidas por artículo/inciso, título o tema pueden contestar
  directamente desde los documentos, sin pedir síntesis al modelo. Las citas
  directas se limitan a 500 caracteres; el panel conserva acceso al artículo
  íntegro.
- `GET /api/health` verifica índice, servicio Ollama y disponibilidad de ambos
  modelos. `POST /api/chat` recibe `message` y `sessionId` opcional.
- CORS predeterminado: `http://localhost:5173`; bind del backend:
  `127.0.0.1:3001`.

### Módulo 3 — interfaz

**Componentes:** React 19, TypeScript, Vite 8, Tailwind CSS v4.

- Layout de panel lateral e interfaz de conversación; diseño adaptable a móvil.
- Cliente HTTP tipado, historial de conversación y sesión en memoria del
  navegador; el historial no sobrevive recargar/cerrar la página.
- Indicadores de disponibilidad del backend y de inferencia local.
- Mensajes de respuesta con citas resaltadas y estados para fuera de dominio y
  respuestas no verificables.
- Panel de transparencia por mensaje: fuente, número de artículo, jerarquía,
  cita literal, texto íntegro, origen y jurisprudencia asociada.
- Agrupa múltiples enlaces con la misma etiqueta visual (por ejemplo, “Ver
  jurisprudencia aquí”) bajo una lista desplegable; no borra los URL distintos.
- El área de chat tiene su propio scroll; la barra lateral y la página se
  mantienen fijas.
- `@tailwindcss/vite` está habilitado en `vite.config.ts`; el alias `@/*` se
  declara tanto en Vite como en `tsconfig.app.json`.

### Módulo 4 — no implementado

No se han creado Dockerfiles de backend/frontend ni un Compose que orqueste la
aplicación entera. Solo Ollama puede ejecutarse como contenedor; los procesos de
API y Vite se ejecutan con Node/npm. La gestión de sesión tampoco tiene
persistencia al reiniciar el servidor.

## 3. Resultados de pruebas

### Pruebas automatizadas

Última ejecución registrada:

| Comando/área | Resultado |
|---|---|
| `backend: npm test` | **8/8 aprobadas, 0 fallidas, 0 omitidas** con los JSON ETL locales presentes. |
| `backend: npm run typecheck` | Aprobado (`tsc --noEmit`). |
| `frontend: npm run build` | Aprobado: TypeScript y bundle de producción Vite. |
| `frontend: npm run lint` | Aprobado, sin avisos ni errores de Oxlint. |

Cobertura funcional de los ocho tests:

1. ETL JSON → servicio Ollama simulado → LanceDB → Express `/api/chat`.
2. Error explícito cuando Ollama local no está disponible.
3. Indexación de ambos JSON ETL reales, persistencia y reapertura del vector
   store; recuperación del artículo constitucional 2 y metadatos asociados.
4. Respuesta directa por artículo limitada y con evidencia literal.
5. Respuesta directa por título limitada y con evidencia literal.
6. ETL segmenta artículos, jerarquía y jurisprudencia, deduplicando URL
   repetidas exactas.
7. Error explícito si el HTML carece del contenedor normativo esperado.
8. Error explícito cuando no se pudo extraer ningún artículo.

`npm test` no necesita modelos reales: los tests del backend usan un servidor
Ollama simulado. En un clon sin JSON procesados, el test que indexa el corpus
real se omite con un motivo; tras descargar los HTML y ejecutar ETL, vuelve a
ejecutarse.

### Integración local con Ollama real

Durante el desarrollo se descargaron `nomic-embed-text` y `qwen2.5:3b` en un
contenedor temporal y se indexaron **868 chunks** con LanceDB. La API real
reportó `/api/health = ok`, índice disponible y ambos modelos presentes.

Se probó una consulta del artículo 2, inciso 2 de la Constitución y se obtuvo
el extracto literal sobre igualdad/no discriminación con su cita. También se
probó una pregunta fuera de alcance y fue rechazada. La ejecución no es un
benchmark formal y la respuesta general del modelo puede variar.

En la revisión documental previa a la publicación, el contenedor Docker
`mini-juztina-ollama` existía pero estaba detenido (`Exited`); la ejecución de
referencia con Ollama real ocurrió antes, cuando el servicio estaba activo. Los
tests automatizados no requieren arrancar ese contenedor.

El usuario indicó que una consulta general demoró menos de 20 segundos en su
equipo; es una observación puntual, no un SLA ni un tiempo garantizado. En la
All-in-One descrita, el ruido/velocidad del ventilador al generar respuesta es
compatible con inferencia local en CPU. El hardware reportado tiene Intel
i7-8700, 32 GB RAM y Radeon RX 560 con 4 GB de VRAM; no se midió una aceleración
GPU efectiva de Ollama. Los embeddings también consumen recursos al indexar.

### Prueba de navegador y extremo a extremo

- La integración inicial de UI se verificó con una API simulada: formulario,
  mensaje, historial, cita y fuente.
- Después de los ajustes de UI se verificó el flujo con el backend disponible:
  envío desde una pregunta sugerida, respuesta al artículo 2 y panel de
  transparencia. La fuente mostraba 33 enlaces de jurisprudencia resumidos bajo
  un desplegable, sin imprimir 33 veces la misma etiqueta.
- A viewport de 1280×720, `document.documentElement.scrollTop` permaneció en 0
  al desplazar el contenedor del chat; el scroll del chat se movió 724 px y la
  barra lateral permaneció en la posición superior.
- El recorrido visual se probó en navegador local. No equivale a una suite
  automatizada de navegador ni a una prueba de estrés.

### Correcciones impulsadas por las pruebas

- El modelo pequeño produjo en algunas preguntas generales JSON inválido o
  citas no verificables. Se añadieron validación estricta y rechazo HTTP 502;
  además, respuestas deterministas para búsquedas por artículo/título/tema.
- Una consulta directa podía imprimir un artículo excesivamente largo. El
  extracto directo ahora se limita a 500 caracteres sin recortar la evidencia
  respecto al texto guardado.
- Una consulta general devolvía muchas notas de jurisprudencia con la etiqueta
  idéntica. El ETL quita duplicados exactos y el panel agrupa las etiquetas
  repetidas, manteniendo enlaces únicos.
- El scroll del documento movía visualmente también el sidebar. La aplicación
  tiene altura fija de viewport y el scroll se confina al área del chat.

## 4. Seguridad, privacidad y límites

- Servicios de inferencia configurados contra loopback: Ollama
  `127.0.0.1:11434`; Express `127.0.0.1:3001`.
- No se requiere una clave de API, token externo ni archivo `.env` para la
  configuración predeterminada. Los `.env.example` son plantillas, no
  configuración cargada automáticamente por Node.
- La API limita el JSON entrante, valida el texto y el identificador de sesión,
  y no emite citas modelo sin verificar su coincidencia literal en la fuente
  identificada.
- Una pregunta sobre el dominio no necesariamente tiene respuesta verificable;
  en ese caso el frontend presenta el error y fuentes, no una afirmación
  fabricada.
- Índice vectorial y datos fuente son locales e ignorados por Git. El frontend
  no conserva historial después de recargar; el backend guarda sesiones solo
  durante la vida del proceso.
- Los documentos procesados son snapshots y no se actualizan solos; se debe
  regenerar ETL y volver a indexar al cambiar la fuente.
- La aplicación no acredita vigencia normativa por sí sola. Contrastar la
  fuente con publicación oficial.

## 5. Datos no versionados y reproducibilidad

`.gitignore` excluye:

- `backend/data/raw/`: HTML fuente.
- `backend/data/processed/`: corpus JSON.
- `backend/data/vector_db/`: LanceDB y vectores generados.
- `backend/.env`, `frontend/.env`, dependencias y builds.

La prueba sintética ETL y las demás pruebas del backend siguen disponibles sin
corpus. Para obtener los ocho tests completos en una clonación, prepara los dos
HTML en las rutas de README, corre ETL y luego `npm test`.

## 6. Referencia de comandos

Secuencia de primer inicio:

1. Instalar Docker Desktop (u Ollama nativo), Node 22.12+ y npm.
2. Arrancar Ollama y obtener los modelos `nomic-embed-text` y `qwen2.5:3b`.
3. Colocar los HTML fuente en `backend/data/raw/`.
4. En `backend`: `npm install`, `npm run etl -- --input ...`, `npm run ingest`,
   `npm run dev`.
5. En `frontend`: `npm install`, `npm run dev`.
6. Abrir `http://localhost:5173`; revisar `http://127.0.0.1:3001/api/health`.

Los comandos PowerShell completos, con rutas y bloque Docker idempotente, están
en el [README de la raíz](../README.md).
