// Contenido del taller: agenda de 2 horas, módulos y agentes de ejemplo.
window.MODULES = [
  {
    id: 'm0', min: 20, title: 'Prepara tu entorno', icon: '🧰', setup: true,
    goal: 'Crear tu cuenta en Groq, instalar Ollama y dejar listos tus dos modelos.',
    concepts: [
      ['Groq (modelos en la nube)', 'Groq presta modelos muy rápidos con un plan gratuito. Necesitas una cuenta y una API key personal: es la llave que identifica tus consultas.'],
      ['Ollama (modelos en tu equipo)', 'Ollama descarga el modelo a tu computador y lo corre sin internet. Es más lento que Groq, pero es tuyo y no tiene cuota.'],
      ['Tu API key es privada', 'Nunca la compartas ni la pegues en chats. Aquí se guarda cifrada y solo la usa el servidor para tus consultas.'],
      ['Mientras se descarga', 'El modelo de Ollama pesa unos 2 GB. Déjalo descargando y continúa con el módulo 1: no hace falta esperar.']
    ],
    steps: [], preset: null,
    check: []
  },
  {
    id: 'm1', min: 10, title: 'Qué es un agente', icon: '🧭',
    goal: 'Distinguir un chatbot de un agente y reconocer las cinco piezas de un agente.',
    concepts: [
      ['Chatbot', 'Responde con lo que aprendió. No puede consultar nada ni hacer nada fuera del texto.'],
      ['Agente', 'Un modelo que decide qué hacer: puede llamar herramientas, mirar el resultado y seguir hasta resolver la tarea.'],
      ['Las 5 piezas', 'Modelo (el cerebro) · Instrucciones (el rol) · Herramientas (las manos) · Conocimiento y memoria (lo que sabe) · Bucle (percibir → razonar → actuar → observar).'],
      ['Por qué importa', 'Un modelo solo inventa la hora, el clima y las cuentas. Un agente los consulta.']
    ],
    steps: [
      'Abre el Constructor con el agente «Asistente básico» (botón de abajo).',
      'Pregúntale: «¿Qué hora es en Bucaramanga?» y «¿Cuánto es el 17 % de 2.350.000?».',
      'Anota qué respondió y si puedes confiar en el resultado. Eso es lo que vamos a arreglar.'
    ],
    preset: 'basico',
    check: ['Puedo explicar la diferencia entre chatbot y agente', 'Nombré las 5 piezas de un agente', 'Vi al asistente básico equivocarse o inventar un dato']
  },
  {
    id: 'm2', min: 20, title: 'Instrucciones y parámetros', icon: '🎛️',
    goal: 'Escribir un prompt de sistema claro y entender qué cambian la temperatura y el modelo.',
    concepts: [
      ['Prompt de sistema', 'Una buena instrucción tiene: nombre, personalidad, estilo, estructura de la respuesta y reglas. El Constructor los pide por separado y los junta en una plantilla de prompt, igual que un ChatPromptTemplate de LangChain.'],
      ['Temperatura', '0 = respuestas casi idénticas, ideal para datos y cálculos. Cerca de 1 = más variedad, útil para ideas; también más riesgo de inventar.'],
      ['Modelo', 'Los modelos grandes (como gpt-oss-120b) razonan mejor y llaman herramientas con más fiabilidad; los pequeños (gpt-oss-20b) responden más rápido. Groq retira modelos cada pocos meses: la lista del Constructor se pide a Groq en vivo.'],
      ['Tokens', 'El modelo lee y escribe en fragmentos de texto. Instrucciones más cortas dejan más espacio para la conversación.']
    ],
    steps: [
      'Carga el agente «Tutor de agentes de IA», abre la sección 2 y despliega «Ver el prompt final»: identifica qué campo produjo cada línea.',
      'En la sección 1 (Modelo y temperatura) usa los botones Preciso y Creativo: haz la misma pregunta con cada uno, lee la explicación que aparece y compara.',
      'Cambia el nombre, la personalidad y el estilo (por ejemplo un pirata formal) y la estructura de respuesta a «Pasos numerados»; pregunta lo mismo y compara.',
      'Elige el dominio de tu agente final (por ejemplo: clínica, tienda, universidad, finanzas) y escribe su primer prompt.'
    ],
    preset: 'tutor',
    check: ['Identifiqué en el prompt final qué línea sale de cada campo', 'Comparé temperatura 0 contra 1.2', 'Configuré nombre, personalidad, estilo y estructura de mi agente']
  },
  {
    id: 'm3', min: 25, title: 'Herramientas', icon: '🔧',
    goal: 'Dar herramientas a un agente y leer cómo decide usarlas.',
    concepts: [
      ['Llamada a herramientas', 'El modelo no ejecuta nada. Pide «usa la calculadora con esto»; el servidor la ejecuta y le devuelve el resultado para que continúe.'],
      ['La descripción manda', 'El modelo elige la herramienta por su descripción. Una descripción vaga produce un uso erróneo o ninguno.'],
      ['Traza', 'En el Constructor ves cada paso: herramienta, argumentos y resultado. Si el agente falla, la traza dice dónde.'],
      ['Herramientas y APIs', 'Calculadora · Fecha y hora · Clima actual (Open-Meteo) · y hasta 3 APIs propias: tú escribes la URL con {parámetros} y el agente decide cuándo llamarla.']
    ],
    steps: [
      'Carga «Asistente con herramientas». Repite las dos preguntas del módulo 1 y compara.',
      'Pregunta: «¿Qué clima hace hoy en Bucaramanga y en Medellín? ¿Cuál es más caliente?».',
      'Desactiva una herramienta y repite la pregunta. ¿Qué hace el agente sin ella?',
      'En la sección 4 activa las herramientas que tu agente necesita y agrega una API propia (por ejemplo la de edad según el nombre), pruébala con el botón Probar y luego pregúntale algo que la requiera.'
    ],
    preset: 'herramientas',
    check: ['Vi la traza de una llamada a herramienta', 'Comparé el agente con y sin herramienta', 'Mi agente usa al menos una herramienta']
  },
  {
    id: 'm4', min: 20, title: 'Conocimiento y memoria', icon: '📚',
    goal: 'Hacer que el agente responda desde tus documentos y reconocer sus límites.',
    concepts: [
      ['Memoria de la conversación', 'El agente recuerda lo que se dijo porque le reenviamos los últimos mensajes. Si los borras (Nueva conversación), olvida todo.'],
      ['Conocimiento propio', 'Pegas tus notas y el agente las busca antes de responder. Es una versión mínima de RAG: buscar primero, responder después.'],
      ['Alucinación', 'Si la respuesta no está en las notas, un modelo mal instruido la inventa. La instrucción «si no está en las notas, dilo» lo corrige.'],
      ['Límites', 'Esta búsqueda compara palabras clave. En el curso completo se usan embeddings para buscar por significado.']
    ],
    steps: [
      'Carga «Agente con notas» y pregúntale por el horario y por el costo de un curso.',
      'Pregunta algo que NO está en las notas. ¿Lo reconoce o lo inventa?',
      'En la sección 5 (RAG) carga un PDF o un .md tuyo (un reglamento, un apunte), usa «Probar la búsqueda» para ver qué fragmentos encuentra y haz 3 preguntas al agente.',
      'En la sección 3 (Memoria) elige «Sin memoria», luego «Ventana de 4» y «Completa». Dile tu nombre, charla un poco y pregunta cómo te llamas: lo atenuado en el chat es lo que ya olvidó.'
    ],
    preset: 'notas',
    check: ['Mi agente responde con datos de mis notas', 'Probé una pregunta que no está en las notas', 'Entendí cómo recuerda la conversación']
  },
  {
    id: 'm5', min: 25, title: 'Reto: tu agente', icon: '🏁',
    goal: 'Terminar, probar y exportar un agente propio.',
    concepts: [
      ['Qué debe cumplir', 'Nombre y rol claros · al menos una herramienta o notas propias · límites escritos en el prompt · 3 pruebas que funcionen.'],
      ['Cómo se evalúa', 'Una prueba que debe funcionar, una que muestre una herramienta en la traza y una que muestre que el agente reconoce lo que no sabe.'],
      ['Exportar', 'Descarga la configuración (.json) para volver a cargarla, y el script de Python (con LangChain o directo con Groq) para correr el mismo agente fuera de esta página.'],
      ['Siguiente paso', 'LangChain y LangGraph para agentes con varios pasos, FastAPI para publicarlos como servicio y Railway para ponerlos en línea: es el curso completo de Agentes de IA.']
    ],
    steps: [
      'Termina tu agente en el Constructor: nombre, prompt, herramientas y notas.',
      'Ejecuta las 3 pruebas del reto y guarda una captura de cada una.',
      'Descarga la configuración (.json) y el script de Python con LangChain.',
      'Presenta tu agente en 1 minuto: qué hace, qué herramienta usa y qué no sabe hacer.'
    ],
    preset: null,
    check: ['Mi agente tiene rol, herramientas y límites', 'Pasó las 3 pruebas', 'Descargué el .json y el script de Python con LangChain']
  }
];

window.PRESETS = {
  basico: {
    name: 'Asistente básico',
    system: 'Eres un asistente. Responde en español, de forma breve.',
    model: 'openai/gpt-oss-120b', temperature: 0.7, maxTokens: 700, memory: { mode: 'window', size: 6 }, tools: [], knowledge: ''
  },
  tutor: {
    name: 'Profe Nova',
    persona: 'Tutor paciente y curioso; le gusta explicar con analogías de la vida diaria y celebra las buenas preguntas.',
    style: 'cercano y profesional, sin tecnicismos innecesarios',
    format: 'resumen',
    rules: 'Máximo 4 líneas por respuesta. Si la pregunta no trata de agentes, modelos de lenguaje o programación, dilo con amabilidad y redirige al tema.',
    system: 'Explicas conceptos de agentes de IA a estudiantes universitarios, con un ejemplo corto.',
    model: 'openai/gpt-oss-120b', temperature: 0.3, maxTokens: 500, memory: { mode: 'window', size: 8 }, tools: [], knowledge: ''
  },
  herramientas: {
    name: 'Asistente práctico',
    persona: 'Eficiente y confiable: prefiere un dato exacto a una respuesta bonita.',
    style: 'claro y directo',
    format: 'vinetas',
    rules: 'No adivines números: si una herramienta falla, dilo. Muestra siempre el dato que obtuviste.',
    system: 'Usa la calculadora para cualquier cuenta, la herramienta de clima para el tiempo y la de fecha y hora para el día y la hora.',
    model: 'openai/gpt-oss-120b', temperature: 0.1, maxTokens: 700, memory: { mode: 'window', size: 6 }, tools: ['calculadora', 'fecha_hora', 'clima'], knowledge: ''
  },
  notas: {
    name: 'Asistente de la Academia Nova',
    persona: 'Amable y organizado, como una buena secretaría académica.',
    style: 'cordial y breve',
    format: 'libre',
    rules: 'Responde solo con la información de las notas. Si la respuesta no está, di «No tengo ese dato» y sugiere escribir a la secretaría. Máximo 3 líneas.',
    system: 'Atiendes preguntas sobre el curso de Introducción a la Inteligencia Artificial de la Academia Nova.',
    model: 'openai/gpt-oss-120b', temperature: 0.1, maxTokens: 500, memory: { mode: 'window', size: 6 }, rag: { enabled: true, k: 3, chunk: 600 }, tools: [],
    knowledge: 'Academia Nova: curso de Introducción a la Inteligencia Artificial.\n\nHorario: martes y jueves de 6:00 pm a 8:00 pm, en el aula 204 del edificio B. El curso dura 8 semanas e inicia el 3 de febrero.\n\nCosto: la matrícula cuesta $1.200.000 COP. Los egresados de la Academia tienen 15 % de descuento. Se puede pagar en dos cuotas: la primera al matricularse y la segunda en la semana 4.\n\nRequisitos: no se necesita experiencia en programación. Se recomienda llevar portátil con acceso a internet.\n\nCertificado: se entrega un certificado digital a quienes asistan al 80 % de las clases y presenten el proyecto final.\n\nContacto: secretaria@academianova.example, de lunes a viernes de 8:00 am a 5:00 pm.'
  }
};
