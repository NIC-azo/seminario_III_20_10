# Mini-Juztina

Asistente web local de consulta documental sobre la **Constitución Política
del Perú** y el **Código Penal peruano**. Implementa un pipeline ETL, búsqueda
híbrida con vectores persistidos en LanceDB, generación con un modelo local
mediante Ollama y una interfaz React con citas inspeccionables.

## Estado y alcance

- Aplicación dividida en ETL, API RAG e interfaz web.
- No llama a OpenAI, Anthropic, Gemini, Cohere ni a otros servicios de IA en la
  nube. En ejecución, los embeddings, la inferencia y la base vectorial son
  locales.
- Las descargas iniciales de Node/npm, la imagen de Ollama, los modelos y los
  HTML fuente requieren Internet. Una vez instalados/descargados, el sistema se
  puede ejecutar localmente sin enviar consultas a servicios externos.
- El código fuente HTML, los JSON legales procesados y LanceDB no se versionan.
  Se mantienen como datos locales; las condiciones de redistribución de las
  páginas de origen deben revisarse antes de compartir esos archivos.
- **No se han creado Dockerfiles ni Docker Compose para la aplicación.** Docker
  se usa opcionalmente para ejecutar únicamente Ollama; API y frontend se
  ejecutan con Node.js.

Los HTML que se usaron durante el desarrollo proceden de páginas de LP Derecho,
un repositorio secundario, no de una descarga automatizada desde una API
gubernamental. Para un uso académico o jurídico, verifica la fecha de vigencia y
el texto con la publicación oficial correspondiente. Mini-Juztina es una
herramienta documental y no sustituye asesoramiento legal.

## Arquitectura

```text
HTML local
   │
   ▼
backend/src/data_pipeline/etl.ts ──► JSON por norma (no versionado)
                                         │
                       Ollama /api/embed │
                                         ▼
                       backend/src/scripts/ingest.ts
                                         │
                                         ▼
                            LanceDB local (868 chunks en
                            la ejecución de referencia)
                                         │
Pregunta ─► Express /api/chat ─► búsqueda vectorial + léxica
                    │             └─► Ollama /api/chat (si aplica)
                    │
                    ▼
        React / Vite ──► respuesta, citas y panel de fuentes
```

### Componentes

| Área | Tecnología | Responsabilidad |
|---|---|---|
| ETL | Node.js, TypeScript, Cheerio | Elimina elementos de interfaz, anuncios y scripts; conserva la jerarquía normativa y separa las notas jurisprudenciales. Emite un JSON por documento y un chunk por artículo. |
| Indexador | TypeScript, Ollama | Valida los JSON del ETL, solicita embeddings de `chunk_text` en lotes de 16 y crea/reemplaza la tabla local. |
| Modelo/vector store | LanceDB, `nomic-embed-text` | Persiste vectores y metadatos en `backend/data/vector_db/`; recupera resultados semánticos y léxicos y combina los rankings. |
| Chat API | Express 5, TypeScript, Ollama | Expone `GET /api/health` y `POST /api/chat`; conserva sesiones en memoria del proceso y aplica límites y validación de solicitudes. |
| Guardrails | JSON estructurado y validación de evidencia | El modelo solo puede responder dentro del dominio documental, con citas existentes y texto literal verificable. Si la salida no es verificable, no se presenta como respuesta válida. |
| Interfaz | React, TypeScript, Vite, Tailwind CSS v4 | Chat, historial en memoria, preguntas sugeridas, estado de salud, fuentes desplegables, texto íntegro, enlaces y modo adaptable a móvil. |

Más detalle sobre decisiones, limitaciones, pruebas y trazabilidad del
enunciado: [docs/ARQUITECTURA-Y-PRUEBAS.md](./docs/ARQUITECTURA-Y-PRUEBAS.md).

## Requisitos

- Windows 11/PowerShell (los comandos de esta guía usan PowerShell).
- Node.js **22.12 o superior** (Vite 8 exige Node `^20.19.0 || >=22.12.0`).
- npm.
- Docker Desktop, si ejecutarás Ollama en contenedor, **o** Ollama instalado
  nativamente en Windows.
- Espacio para los modelos locales: `qwen2.5:3b` ocupa alrededor de 1.9 GB en la
  descarga efectuada durante las pruebas; el tamaño exacto puede variar.

Versiones del entorno de referencia: Node `v25.8.1`, npm `11.11.0`, Docker
`29.8.1`, Vite `8.3.4`, React `19.3.1`, Express `5.3.0` y LanceDB `0.26.2`.
Los lockfiles fijan las dependencias instaladas por npm.

## Preparar el corpus local

Por protección y redistribución, las fuentes HTML y sus JSON procesados se
excluyen de Git. En una copia clonada, primero crea/usa las carpetas y coloca
allí las dos páginas HTML descargadas de las fuentes:

- [Constitución Política del Perú — LP Derecho](https://lpderecho.pe/constitucion-politica-peru-actualizada/)
- [Código Penal peruano — LP Derecho](https://lpderecho.pe/codigo-penal-peruano-actualizado/)

Guárdalas con estos nombres en `backend/data/raw/`:

```text
Constitución Política del Perú [actualizada 2026] _ LP.html
Código Penal peruano [actualizado 2026] _ LP.html
```

Genera los JSON. Desde `mini-juztina/backend`:

```powershell
npm install
npm run etl -- --input ".\data\raw\Constitución Política del Perú [actualizada 2026] _ LP.html" --input ".\data\raw\Código Penal peruano [actualizado 2026] _ LP.html"
```

El ETL escribe un archivo JSON por norma en `backend/data/processed/`. En la
ejecución de referencia produjo **213 chunks** de la Constitución y **655** del
Código Penal (**868 en total**); nuevos HTML o ediciones pueden cambiar esas
cifras.

## Iniciar Ollama

Ollama es un servicio aparte del backend. Este repositorio no instala Ollama en
Windows. Escoge **una** opción y no inicies simultáneamente Ollama nativo y el
contenedor Docker, pues ambos necesitan el puerto `11434`.

### Recomendado en Windows: contenedor Docker persistente

Abre Docker Desktop. Ejecuta lo siguiente en PowerShell; funciona desde
cualquier carpeta. Si el contenedor ya existe y está detenido, lo inicia; si no
existe, lo crea con un volumen para conservar los modelos:

```powershell
$running = docker ps --filter 'name=^/mini-juztina-ollama$' --format '{{.Names}}'
if ($running) {
  Write-Output "Ollama ya está activo"
} else {
  $existing = docker ps -a --filter 'name=^/mini-juztina-ollama$' --format '{{.Names}}'
  if ($existing) {
    docker start mini-juztina-ollama
  } else {
    docker run -d --restart unless-stopped --name mini-juztina-ollama -p 127.0.0.1:11434:11434 -v mini-juztina-ollama:/root/.ollama ollama/ollama
  }
}
```

Espera a que la API esté lista y descarga los modelos (necesario la primera
vez; repetir `pull` es seguro si ya están descargados):

```powershell
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $null = Invoke-RestMethod http://127.0.0.1:11434/api/tags -TimeoutSec 2
    break
  } catch {
    if ($attempt -eq 29) { throw "Ollama no respondió en http://127.0.0.1:11434." }
    Start-Sleep -Seconds 2
  }
}
docker exec mini-juztina-ollama ollama pull nomic-embed-text
docker exec mini-juztina-ollama ollama pull qwen2.5:3b
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

En siguientes sesiones, solo inicia el contenedor (primer bloque) y comprueba
los modelos:

```powershell
docker exec mini-juztina-ollama ollama list
```

Para detener Ollama conservando el volumen y los modelos:

```powershell
docker stop mini-juztina-ollama
```

### Alternativa: Ollama nativo en Windows

Instala Ollama para Windows y abre su aplicación desde el menú Inicio. Después,
en una terminal nueva:

```powershell
ollama list
ollama pull nomic-embed-text
ollama pull qwen2.5:3b
```

Si PowerShell dice que `ollama` no se reconoce, no está instalado en Windows o
no se actualizó `PATH`; el contenedor Docker no proporciona el comando nativo.
En modo Docker, utiliza `docker exec mini-juztina-ollama ollama list`.

## Iniciar backend y frontend

Usa **dos terminales PowerShell adicionales**; deja Docker Desktop/Ollama
activo. Los comandos siguientes parten de una clonación en la ubicación indicada;
si el proyecto está en otra ruta, ajusta el `Set-Location`.

### Terminal 1 — backend

```powershell
Set-Location 'C:\Users\Alumno\Documents\1412994\seminari_III\20_10\mini-juztina\backend'
npm install
npm run ingest
npm run dev
```

`npm run ingest` se necesita después de generar el ETL o cuando quieras
reconstruir el índice. En los siguientes inicios normales, basta con
`npm run dev`. Verifica el backend en otra terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

La respuesta esperada es `status: ok`, con LanceDB y ambos modelos disponibles.
`npm run dev` mantiene la terminal ocupada; déjala abierta.

### Terminal 2 — frontend

```powershell
Set-Location 'C:\Users\Alumno\Documents\1412994\seminari_III\20_10\mini-juztina\frontend'
npm install
npm run dev
```

Abre `http://localhost:5173`. En inicio normal, basta con `npm run dev`.
Frontend y backend se comunican mediante `http://127.0.0.1:3001/api`; CORS está
configurado para Vite en `http://localhost:5173`.

## API

```powershell
$body = [Text.Encoding]::UTF8.GetBytes((@{ message = '¿Qué establece el artículo 2 inciso 2 de la Constitución?' } | ConvertTo-Json -Compress))
Invoke-RestMethod http://127.0.0.1:3001/api/chat -Method Post -ContentType 'application/json; charset=utf-8' -Body $body
```

`POST /api/chat` devuelve `sessionId`, `status`, `answer` y `sources`. Cada
fuente incluye la norma, artículo, jerarquía, `citation_id`,
`citation_fragments`, texto íntegro y metadatos de jurisprudencia. Reutiliza el
`sessionId` para continuar una sesión; el historial reside solo en memoria del
proceso y del navegador.

Las respuestas directas por número de artículo/inciso, título o tema reconocido
usan texto de la fuente y limitan la cita/respuesta directa a **500 caracteres**
(el artículo íntegro permanece desplegable). Las salidas generadas por Ollama
solo se aceptan cuando la evidencia citada aparece literalmente en el artículo
asignado. Si no se puede verificar, la API devuelve HTTP 502 con los fragmentos
recuperados en lugar de inventar una respuesta.

## Configuración

Los `.env.example` muestran las opciones, pero **no se cargan automáticamente**.
Con los valores predeterminados no hace falta crear archivos `.env`.

Backend: `HOST` (por defecto `127.0.0.1`), `PORT` (`3001`),
`OLLAMA_BASE_URL` (`http://127.0.0.1:11434`), `OLLAMA_CHAT_MODEL`
(`qwen2.5:3b`), `OLLAMA_EMBEDDING_MODEL` (`nomic-embed-text`),
`OLLAMA_TIMEOUT_MS`, `VECTOR_DATABASE_PATH`, `PROCESSED_DATA_PATH`,
`CORS_ORIGIN` y `RETRIEVAL_LIMIT`.

Frontend: para cambiar la URL de la API, copia `frontend/.env.example` como
`frontend/.env`, ajusta `VITE_API_BASE_URL` y reinicia Vite. No pongas secretos
en variables `VITE_*`: se publican en el bundle del navegador.

## Comprobar calidad

Desde `backend`:

```powershell
npm test
npm run typecheck
```

Desde `frontend`:

```powershell
npm run build
npm run lint
```

El test que indexa las dos salidas ETL reales se omite explícitamente en un
clon sin corpus; ejecuta el ETL primero para habilitar esa prueba. Las pruebas
de integración con Ollama usan un servidor simulado para no necesitar descargar
modelos durante `npm test`.

## Estructura del repositorio

```text
mini-juztina/
├── backend/
│   ├── src/
│   │   ├── config.ts
│   │   ├── controllers/       # chat, cliente Ollama, indexación
│   │   ├── data_pipeline/     # ETL Cheerio
│   │   ├── models/            # LanceDB
│   │   ├── scripts/           # comando de ingestión
│   │   ├── views/             # rutas Express
│   │   ├── app.ts
│   │   └── server.ts
│   └── tests/
├── frontend/
│   └── src/
│       ├── components/        # chat, panel de fuentes, sidebar
│       ├── services/          # cliente HTTP tipado
│       └── types/
├── docs/
│   └── ARQUITECTURA-Y-PRUEBAS.md
└── README.md
```

El Módulo 4 del plan original —Dockerfiles para backend/frontend y Compose para
toda la aplicación— **no se ha implementado**. Tampoco se ha configurado
persistencia del historial conversacional entre reinicios.

## Licencia y uso de fuentes

Este repositorio no afirma que la instantánea de LP Derecho sea una fuente
oficial ni otorga derechos para redistribuir su HTML, recopilación o enlaces.
Los datos locales no se incluyen en GitHub. Revisa las condiciones de las
fuentes y contrasta el texto normativo con publicaciones oficiales antes de
usarlo en un trabajo jurídico.
