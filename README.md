# Taller de 2 horas: crea y configura tu agente de IA

Página del curso **Agentes de IA** (MADSI, Universidad Santo Tomás) en versión corta: una sola sesión de dos horas en la que cada estudiante construye, prueba y exporta su propio agente. Es la versión breve de [`modulo_agentes_ia`](https://github.com/chvn00/modulo_agentes_ia).

## Agenda (120 minutos)

| Módulo | Tema | Minutos |
|---|---|---|
| 1 | Qué es un agente: chatbot vs. agente y sus 5 piezas | 15 |
| 2 | Instrucciones y parámetros: prompt de sistema, temperatura y modelo | 25 |
| 3 | Herramientas: llamada a funciones y lectura de la traza | 30 |
| 4 | Conocimiento y memoria: notas propias, alucinaciones y límites | 25 |
| 5 | Reto: terminar el agente, 3 pruebas y exportar | 20 |

Cada módulo tiene ideas clave, una práctica guiada y puntos de control que se guardan en el navegador. La barra superior incluye un reloj de la sesión de 2 horas.

## El Constructor de agentes

Es el centro de la página. El estudiante configura:

- **Nombre e instrucciones** (rol, tarea, tono, formato, límites)
- **Modelo** (`llama-3.3-70b-versatile` o `llama-3.1-8b-instant`) y **temperatura**
- **Herramientas**: calculadora, fecha y hora, clima actual (Open-Meteo, sin clave) y búsqueda en sus propias notas
- **Conocimiento**: texto propio que el agente consulta

y conversa con el agente viendo la **traza** de cada herramienta que usa (nombre, argumentos y resultado). Trae cuatro agentes de ejemplo y permite descargar la configuración en `.json`, volver a cargarla y descargar un **script de Python** que corre el mismo agente fuera de la página.

## Cómo funciona

```
navegador  ──►  POST /api/agent  ──►  bucle del agente  ──►  Groq
                                        ▲       │
                                        └─ herramientas (calculadora, clima, notas…)
```

El servidor guarda la clave de Groq; el navegador nunca la ve. El bucle (`agent.js`) llama al modelo, ejecuta las herramientas que pide, le devuelve los resultados y repite hasta tener una respuesta (máximo 5 pasos). La calculadora usa un analizador propio, no `eval`.

## Estructura

```
server.js        Servidor Express, conexión con Groq, límite de peticiones y código de clase
agent.js         Herramientas, validación de la configuración y bucle del agente
test/            Pruebas con el módulo nativo de Node (npm test)
public/
  index.html, style.css, app.js   Interfaz
  lessons.js                      Módulos, puntos de control y agentes de ejemplo
```

## Ejecutarlo

```bash
npm install
cp .env.example .env      # y completa GROQ_API_KEY
export $(grep -v '^#' .env | xargs) && npm start
```

Abre `http://localhost:3000`. Pruebas: `npm test`.

| Variable | Para qué sirve |
|---|---|
| `GROQ_API_KEY` | Clave de Groq (obligatoria) |
| `ACCESS_CODE` | Código de clase opcional; si lo defines, los estudiantes lo escriben una vez. Recomendado si la página es pública, para proteger tu cuota |
| `PORT` | Puerto (Railway lo asigna solo) |

Para publicarlo en Railway: conecta este repositorio, define `GROQ_API_KEY` (y `ACCESS_CODE`) en *Variables* y despliega. No necesita base de datos.

## Límites conocidos

- Hay un tope de 20 peticiones por minuto por dirección IP; en un salón con una sola red pública conviene subirlo en `server.js`.
- La búsqueda en notas compara palabras clave, no significado (en el curso completo se ve RAG con embeddings).
- El estado (configuración, conversación y avance) vive en el navegador de cada estudiante.
