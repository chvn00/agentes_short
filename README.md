# Taller de 2 horas: crea y configura tu agente de IA

Página del curso **Agentes de IA** de la Facultad de Ingeniería en Inteligencia Artificial, Universidad Santo Tomás (Bucaramanga), dirigido por el Dr.-Ing. Cesar Hernando Valencia Niño. Versión corta: una sola sesión de dos horas en la que cada estudiante construye, prueba y exporta su propio agente. Es la versión breve del curso completo (`modulo_agentes_ia`).

## Agenda (120 minutos)

| Módulo | Tema | Minutos |
|---|---|---|
| 0 | Prepara tu entorno: cuenta y API key de Groq, Ollama y un modelo local | 20 |
| 1 | Qué es un agente: chatbot vs. agente y sus 5 piezas | 10 |
| 2 | Instrucciones y parámetros: prompt de sistema, temperatura y modelo | 20 |
| 3 | Herramientas: llamada a funciones y lectura de la traza | 25 |
| 4 | Conocimiento y memoria: notas propias, alucinaciones y límites | 20 |
| 5 | Reto: terminar el agente, 3 pruebas y exportar | 25 |

Cada módulo tiene ideas clave, una práctica guiada y puntos de control. La barra superior incluye un reloj de la sesión de 2 horas.

## Cuentas

Cada estudiante crea su usuario y contraseña (con el código de clase, si el docente lo definió). Su cuenta guarda:

- **Su API key de Groq**, verificada con Groq al guardarla y almacenada cifrada (AES-256-GCM). Nunca se devuelve al navegador; solo se muestran los últimos 4 caracteres.
- **Su avance** en los puntos de control y sus ajustes (modelo local elegido, proveedor).

En **⚙️ Mi cuenta** cada estudiante puede cambiar o borrar su API key de Groq y cambiar su contraseña.
- **Sus agentes** (hasta 20), que puede cargar desde cualquier computador.

Las contraseñas se guardan con `bcrypt`. Las sesiones son cookies `httpOnly` de 7 días. El registro admite 60 intentos por minuto por IP (un salón entero puede salir por una sola); el inicio de sesión se limita a 10 por minuto por cuenta.

## Administración

Si defines `ADMIN_USERNAME` y `ADMIN_PASSWORD`, esa cuenta se crea al arrancar y aparece la pestaña **👑 Administración**:

- Lista de estudiantes con fecha de creación, última visita, si tienen API key de Groq, si conectaron Ollama, avance (puntos de control) y número de agentes; descarga en CSV.
- Ver los agentes de cada estudiante, asignarle una contraseña nueva, **borrar su cuenta** (botón «Borrar usuario») o borrar varias a la vez con las casillas y «Borrar seleccionados».
- **Clave de Groq del curso**: se guarda cifrada y la usa quien aún no tenga la suya.

El administrador no ve las API keys de los estudiantes, solo si la tienen.

## Los dos modelos

- **Groq (en la nube):** la lista de modelos se pide a Groq en vivo (`/api/models`), porque Groq retira modelos cada pocos meses; el 16/08/2026 retiró `llama-3.3-70b-versatile` y `llama-3.1-8b-instant`, y los agentes guardados con esos nombres se pasan solos a `gpt-oss`. Si un modelo desaparece, el chat lo dice con un mensaje claro. El módulo 0 guía la creación de la cuenta y la API key. Las consultas del agente usan la key de cada estudiante, así que la cuota no es del docente.
- **Ollama (en el equipo):** el módulo 0 guía la instalación, `ollama pull llama3.2` y la autorización de esta página (`OLLAMA_ORIGINS`). Con Ollama el bucle del agente corre en el navegador del estudiante, que habla con `localhost:11434`; el servidor solo prepara las instrucciones y ejecuta las herramientas. Funciona mejor en Chrome o Edge.

## El Constructor de agentes

Es el centro de la página. Cada parte de un agente tiene su sección, con una explicación de lo que ocurre al cambiarla:

1. **Modelo y temperatura:** Groq u Ollama, modelo, temperatura (con atajos Preciso, Equilibrado y Creativo y una explicación que cambia al mover el control) y longitud máxima de la respuesta.
2. **Personalidad y respuestas:** nombre, personalidad, estilo y tono, estructura de las respuestas (libre, viñetas, pasos, resumen y detalle, JSON o personalizada), reglas y límites e instrucciones adicionales. Todo se escribe como texto: los campos llenan una **plantilla de prompt** (la misma idea que un `ChatPromptTemplate` de LangChain) y un recuadro muestra el prompt final que recibe el modelo.
3. **Memoria:** sin memoria, ventana de N mensajes o completa (hasta 20). En el chat, lo que el agente ya olvidó se ve atenuado.
4. **Herramientas y APIs:** calculadora, fecha y hora, clima actual (Open-Meteo) y hasta **3 APIs propias**: se escribe una URL https con parámetros entre llaves (`https://api.agify.io/?name={nombre}`), el agente decide cuándo llamarla y hay un botón para probarla.
5. **Conocimiento (RAG):** interruptor de RAG, documentos pegados o cargados desde archivos **PDF, .md, .txt o .csv** (se pueden cargar varios), número de fragmentos a recuperar, tamaño de fragmento y una **prueba de búsqueda** que muestra qué fragmentos encontraría el agente.

Conversa con el agente viendo la **traza** de cada herramienta que usa (nombre, argumentos y resultado). Trae cuatro agentes de ejemplo, guarda agentes en la cuenta y permite descargar la configuración en `.json`, volver a cargarla y descargar un **script de Python con LangChain** (`ChatPromptTemplate`, `ChatGroq`, `bind_tools`) o uno directo con la librería de Groq, ambos con la misma plantilla, temperatura, memoria, herramientas, APIs y RAG.

## Cómo funciona

```
Groq:    navegador ──► POST /api/agent ──► bucle del agente ──► Groq (key de la persona)
                                          ▲       │
                                          └─ herramientas (calculadora, clima, notas…)

Ollama:  navegador ◄──► localhost:11434      (el bucle corre en el navegador)
                  └──► /api/prepare y /api/tool   (prompt y herramientas desde el servidor)
```

El navegador nunca ve ninguna API key. El bucle (`agent.js`) llama al modelo, ejecuta las herramientas que pide, le devuelve los resultados y repite hasta tener una respuesta (máximo 5 pasos). La calculadora usa un analizador propio, no `eval`.

## Estructura

```
server.js        Servidor Express: cuentas, API key, agentes guardados, Groq y límites de uso
agent.js         Herramientas, validación de la configuración y bucle del agente
db.js            PostgreSQL (o base en memoria en desarrollo) y creación de tablas
secrets.js       Secreto de la aplicación: firma de sesiones y cifrado de API keys
test/            Pruebas con el módulo nativo de Node (npm test)
public/
  index.html, style.css, app.js   Interfaz
  lessons.js                      Módulos, puntos de control y agentes de ejemplo
```

## Ejecutarlo

```bash
npm install
cp .env.example .env      # completa los valores
export $(grep -v '^#' .env | xargs) && npm start
```

Abre `http://localhost:3000`. Sin `DATABASE_URL` usa una base en memoria (las cuentas se pierden al reiniciar). Pruebas: `npm test`.

| Variable | Para qué sirve |
|---|---|
| `DATABASE_URL` | PostgreSQL. **Necesaria en producción** para que las cuentas sobrevivan a los reinicios |
| `APP_SECRET` | Secreto largo y aleatorio: firma sesiones y cifra las API keys. **Necesaria en producción** |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Cuenta del docente (contraseña de 8 o más caracteres) |
| `ACCESS_CODE` | Código de clase que se pide al crear la cuenta. Recomendado |
| `GROQ_API_KEY` | Opcional: clave del servidor para quien aún no guardó la suya (también se puede guardar desde Administración) |
| `PORT` | Puerto (Railway lo asigna solo) |

**Railway:** conecta este repositorio, agrega un servicio **PostgreSQL** al proyecto y en las *Variables* del servicio web enlaza `DATABASE_URL` (referencia al Postgres) y define `APP_SECRET`, `ACCESS_CODE`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`.

## Dar el taller desde tu propio computador (Mac)

Todo corre en un solo Mac y el salón entra desde su navegador por la misma red Wi-Fi. Solo necesitas internet en ese Mac para Groq y las APIs; los celulares y portátiles de los estudiantes solo necesitan llegar al Mac.

1. **Una vez:** `npm install` y crea un archivo `.env` a partir de `.env.example` con `APP_SECRET`, `ACCESS_CODE`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`.
2. **Para que las cuentas no se pierdan** (recomendado): instala PostgreSQL y apunta `DATABASE_URL` a él.

   ```bash
   brew install postgresql@16
   brew services start postgresql@16
   createdb agentes
   # en .env:  DATABASE_URL=postgres://localhost/agentes
   ```

   Sin eso el taller funciona, pero las cuentas se borran si el servidor se reinicia.
3. **Cada vez:** `./clase.sh`. Muestra la dirección para el salón (por ejemplo `http://192.168.1.17:3000`) y evita que el Mac se duerma.
4. Si macOS pregunta si permites conexiones entrantes a `node`, acepta. El Mac y los estudiantes deben estar en la misma red, y esa red no puede aislar los dispositivos entre sí (algunas redes de universidad lo hacen).
5. Para Ollama en el equipo de cada estudiante, el paso 5 del módulo 0 ya usa la dirección con la que entraron (`http://192.168.1.17:3000`), así que sirve igual.



- No hay recuperación automática de contraseña: si alguien la olvida, el administrador le asigna una nueva desde la pestaña Administración.
- Si cambias `APP_SECRET`, las sesiones se cierran y cada estudiante debe volver a guardar su API key.
- La búsqueda del RAG compara palabras clave, no significado (en el curso completo se ve RAG con embeddings). Los PDF deben tener texto seleccionable: los escaneados como imagen no se leen. El texto total se limita a 60000 caracteres.
- Las APIs propias solo admiten `https`, se bloquean las direcciones internas (localhost, redes privadas, `*.internal`) y se siguen hasta 3 redirecciones, validando cada destino. No admiten claves ni cabeceras: son para APIs públicas. Entre la comprobación del DNS y la petición hay una ventana mínima en la que un servidor malicioso podría cambiar de dirección; para un taller es un riesgo aceptado.
- El modo Ollama depende del navegador: usa Chrome o Edge y autoriza el origen de la página en Ollama (paso 5 del módulo 0).
- El script de Python exportado usa Groq; no genera la variante de Ollama.
