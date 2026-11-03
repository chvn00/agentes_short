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
- **Sus agentes** (hasta 20), que puede cargar desde cualquier computador.

Las contraseñas se guardan con `bcrypt`. Las sesiones son cookies `httpOnly` de 7 días. El registro admite 60 intentos por minuto por IP (un salón entero puede salir por una sola); el inicio de sesión se limita a 10 por minuto por cuenta.

## Los dos modelos

- **Groq (en la nube):** el módulo 0 guía la creación de la cuenta y la API key. Las consultas del agente usan la key de cada estudiante, así que la cuota no es del docente.
- **Ollama (en el equipo):** el módulo 0 guía la instalación, `ollama pull llama3.2` y la autorización de esta página (`OLLAMA_ORIGINS`). Con Ollama el bucle del agente corre en el navegador del estudiante, que habla con `localhost:11434`; el servidor solo prepara las instrucciones y ejecuta las herramientas. Funciona mejor en Chrome o Edge.

## El Constructor de agentes

Es el centro de la página. El estudiante configura:

- **Dónde corre el modelo** (Groq u Ollama), nombre e **instrucciones** (rol, tarea, tono, formato, límites)
- **Modelo** (`llama-3.3-70b-versatile` o `llama-3.1-8b-instant` en Groq; el que tenga instalado en Ollama) y **temperatura**
- **Herramientas**: calculadora, fecha y hora, clima actual (Open-Meteo, sin clave) y búsqueda en sus propias notas
- **Conocimiento**: texto propio que el agente consulta

y conversa con el agente viendo la **traza** de cada herramienta que usa (nombre, argumentos y resultado). Trae cuatro agentes de ejemplo, guarda agentes en la cuenta y permite descargar la configuración en `.json`, volver a cargarla y descargar un **script de Python** (Groq) que corre el mismo agente fuera de la página.

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
| `ACCESS_CODE` | Código de clase que se pide al crear la cuenta. Recomendado |
| `GROQ_API_KEY` | Opcional: clave del servidor para quien aún no guardó la suya |
| `PORT` | Puerto (Railway lo asigna solo) |

**Railway:** conecta este repositorio, agrega un servicio **PostgreSQL** al proyecto y en las *Variables* del servicio web enlaza `DATABASE_URL` (referencia al Postgres) y define `APP_SECRET` y `ACCESS_CODE`.

## Límites conocidos

- No hay recuperación de contraseña: si alguien la olvida, el docente debe borrar su fila de la tabla `users` para que cree la cuenta de nuevo.
- Si cambias `APP_SECRET`, las sesiones se cierran y cada estudiante debe volver a guardar su API key.
- La búsqueda en notas compara palabras clave, no significado (en el curso completo se ve RAG con embeddings).
- El modo Ollama depende del navegador: usa Chrome o Edge y autoriza el origen de la página en Ollama (paso 5 del módulo 0).
- El script de Python exportado usa Groq; no genera la variante de Ollama.
