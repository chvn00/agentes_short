// Ilustraciones de las «Ideas clave»: una imagen (SVG) y una frase corta por idea.
// El texto completo de lessons.js se muestra al tocar la ilustración.
(function () {
  const svg = inner => `<svg viewBox="0 0 240 120" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 8 4 0 8z" fill="#0d3aad"/></marker></defs>${inner}</svg>`;
  const box = (x, y, w, h, c = '') => `<rect class="vb ${c}" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>`;
  const em = (x, y, s, size = 26) => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" dominant-baseline="central">${s}</text>`;
  const tx = (x, y, s, c = '') => `<text class="vt ${c}" x="${x}" y="${y}" text-anchor="middle">${s}</text>`;
  const ar = (x1, y1, x2, y2, c = 'flow') => `<line class="va ${c}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah)"/>`;
  const node = (x, y, e, label, c = '') => box(x - 28, y - 24, 56, 48, c) + em(x, y - 2, e, 24) + (label ? tx(x, y + 36, label) : '');

  const V = {
    m0: [
      ['Un equipo, todos lo usan.', svg(node(48, 52, '🖥️', 'Docente', 'hl') + [[190, 22], [190, 60], [190, 98]].map(([x, y]) => em(x, y, '💻', 22) + ar(82, 52, x - 22, y, 'flow')).join(''))],
      ['Rápidos y con plan gratis.', svg(node(48, 52, '💻', 'Tú') + ar(80, 52, 150, 52) + em(190, 50, '☁️', 40) + em(214, 22, '⚡', 20) + tx(190, 92, 'Groq'))],
      ['Tu clave es solo tuya.', svg(em(86, 56, '🔑', 44) + em(150, 56, '🔒', 40) + `<line class="va bad" x1="172" y1="30" x2="214" y2="82"/><line class="va bad" x1="214" y1="30" x2="172" y2="82"/>` + tx(190, 104, 'no compartir', 'muted'))],
      ['Así evitas esperas.', svg(node(58, 50, '🔑', 'Tu clave', 'hl') + node(182, 50, '🖥️', 'Servidor', 'hl') + em(120, 50, '✓', 28) + tx(120, 96, 'sin colas', 'muted'))]
    ],
    m1: [
      ['Solo responde con texto.', svg(node(50, 52, '💬', 'Pregunta') + ar(82, 52, 150, 52) + box(152, 28, 62, 48) + em(183, 50, '📝', 24) + tx(183, 96, 'Texto'))],
      ['Decide, actúa y revisa.', svg(node(60, 52, '🧠', 'Decide', 'hl') + node(180, 52, '🔧', 'Actúa', 'hl') + `<path class="va flow" d="M92 36 Q120 8 148 36" fill="none" marker-end="url(#ah)"/><path class="va flow" d="M148 68 Q120 98 92 68" fill="none" marker-end="url(#ah)"/>`)],
      ['Cinco piezas lo forman.', svg([['🧠', 'Modelo'], ['📜', 'Rol'], ['🔧', 'Manos'], ['📚', 'Saber'], ['🔁', 'Bucle']].map(([e, l], i) => { const x = 26 + i * 47; return box(x - 21, 28, 42, 44, i % 2 ? '' : 'hl') + em(x, 48, e, 22) + tx(x, 92, l); }).join(''))],
      ['Inventa vs. consulta.', svg(em(40, 32, '🧠', 24) + ar(62, 32, 126, 32, 'flow bad') + em(160, 32, '🕐❓', 22) + tx(212, 36, 'inventa', 'bad') + em(40, 86, '🤖', 24) + ar(62, 86, 126, 86) + em(160, 86, '🕐✓', 22) + tx(212, 90, 'consulta', 'ok'))]
    ],
    m2: [
      ['Cuatro líneas, un prompt.', svg(['Nombre', 'Personalidad', 'Estilo', 'Reglas'].map((s, i) => box(14, 12 + i * 26, 100, 21, i % 2 ? '' : 'hl') + tx(64, 27 + i * 26, s)).join('') + ar(120, 60, 156, 60) + node(190, 56, '🧠', 'Prompt', 'hl'))],
      ['Baja: preciso. Sube: creativo.', svg(`<rect class="vb" x="30" y="52" width="180" height="12" rx="6"/><rect x="30" y="52" width="90" height="12" rx="6" fill="#4fa3ff"/><circle cx="120" cy="58" r="11" fill="#0d3aad"/>` + em(30, 22, '🎯', 24) + em(210, 22, '🎨', 24) + tx(30, 96, '0 exacto') + tx(210, 96, '1.5 libre'))],
      ['Grande razona; pequeño corre.', svg(em(66, 50, '🐘', 52) + em(176, 56, '🐇', 34) + tx(66, 100, 'grande: razona') + tx(176, 100, 'pequeño: rápido'))],
      ['El texto se corta en pedacitos.', svg(['Ho', 'la ', 'mun', 'do'].map((s, i) => box(24 + i * 50, 36, 44, 36, i % 2 ? '' : 'hl') + tx(46 + i * 50, 59, s)).join('') + tx(120, 100, '4 tokens', 'muted'))]
    ],
    m3: [
      ['El modelo pide, el servidor hace.', svg(node(40, 36, '🧠', '') + node(200, 36, '🔧', '') + ar(72, 28, 166, 28) + tx(120, 18, 'pide', 'muted') + `<line class="va flow" x1="166" y1="48" x2="74" y2="48" marker-end="url(#ah)"/>` + tx(120, 70, 'resultado', 'muted') + tx(40, 92, 'Modelo') + tx(200, 92, 'Herramienta'))],
      ['Elige por la descripción.', svg(box(10, 30, 84, 58, 'hl') + em(52, 52, '🏷️', 24) + tx(52, 78, 'descripción') + ar(98, 59, 150, 24) + ar(98, 59, 150, 59) + ar(98, 59, 150, 94) + em(184, 24, '🧮', 24) + em(184, 59, '🕐', 24) + em(184, 94, '☀️', 24) + `<circle cx="184" cy="59" r="19" fill="none" stroke="#3fae5b" stroke-width="3"/>`)],
      ['Cada paso queda a la vista.', svg([['①', 'Herramienta'], ['②', 'Argumentos'], ['③', 'Resultado']].map(([n, l], i) => box(20, 12 + i * 34, 200, 28, i === 2 ? 'hl' : '') + tx(46, 31 + i * 34, n) + `<text class="vt l" x="70" y="31" transform="translate(0 ${i * 34})">${l}</text>`).join(''))],
      ['Y hasta 3 APIs propias.', svg([['🧮', 'Calcula'], ['🕐', 'Hora'], ['☀️', 'Clima'], ['🔌', 'Tu API']].map(([e, l], i) => { const x = 33 + i * 58; return box(x - 25, 26, 50, 46, i === 3 ? 'hl' : '') + em(x, 46, e, 24) + tx(x, 92, l); }).join(''))]
    ],
    m4: [
      ['Ventana, resumen o indefinida.', svg(`<g opacity=".25">${box(24, 8, 120, 24)}</g><g opacity=".5">${box(70, 38, 120, 24)}</g>${box(36, 68, 120, 24, 'hl')}${box(84, 96, 120, 20, 'hl')}` + em(214, 22, '🧠', 20))],
      ['Busca primero, responde después.', svg(em(36, 40, '📄', 26) + em(36, 82, '📄', 26) + ar(58, 40, 100, 58) + ar(58, 82, 100, 64) + em(124, 60, '🔍', 34) + ar(150, 60, 186, 60) + em(210, 60, '🧠', 28))],
      ['Si no sabe, debe decirlo.', svg(em(36, 30, '❓', 24) + ar(58, 30, 120, 30, 'flow bad') + em(150, 30, '🌀', 24) + tx(210, 34, 'inventa', 'bad') + em(36, 84, '❓', 24) + ar(58, 84, 120, 84) + em(150, 84, '🧠', 24) + tx(204, 88, '«no sé»', 'ok'))],
      ['Compara palabras, no significado.', svg(box(14, 22, 100, 76, 'hl') + tx(64, 48, 'palabras') + tx(64, 72, 'iguales') + box(126, 22, 100, 76) + tx(176, 48, 'significado') + tx(176, 72, '(embeddings)') + tx(176, 108, 'curso completo', 'muted'))]
    ],
    m5: [
      ['Cuatro requisitos.', svg(['Nombre y rol', 'Herramienta o notas', 'Límites escritos', '3 pruebas'].map((s, i) => em(24, 20 + i * 26, '✅', 16) + `<text class="vt l" x="44" y="${24 + i * 26}">${s}</text>`).join(''))],
      ['Tres pruebas clave.', svg([['✅', 'Funciona'], ['🔧', 'Traza'], ['🤔', '«No sé»']].map(([e, l], i) => { const x = 40 + i * 80; return box(x - 30, 26, 60, 50, 'hl') + em(x, 46, e, 26) + tx(x, 96, l); }).join(''))],
      ['Llévate tu agente como código.', svg(node(36, 50, '🤖', 'Agente', 'hl') + ar(68, 50, 100, 50) + box(102, 30, 50, 40) + tx(127, 56, '{ }') + ar(156, 50, 184, 50) + em(212, 48, '🐍', 28) + tx(127, 92, '.json', 'muted') + tx(212, 92, 'Python', 'muted'))],
      ['El curso completo sigue aquí.', svg([['🧱', 'LangChain'], ['⚡', 'FastAPI'], ['🚂', 'Railway']].map(([e, l], i) => { const x = 36 + i * 84; return box(x - 30, 28, 60, 48, i === 0 ? 'hl' : '') + em(x, 48, e, 26) + tx(x, 96, l) + (i < 2 ? ar(x + 32, 52, x + 52, 52) : ''); }).join(''))]
    ]
  };

  const SHORT = {};
  Object.entries(V).forEach(([k, arr]) => { SHORT[k] = arr.map(([cap, art]) => ({ cap, art })); });
  window.VISUALS = SHORT;
})();
