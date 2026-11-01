(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view'), nav = $('#nav');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); e.innerHTML = html; return e; };

  let info = { needsCode: false, ready: true, models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], tools: [] };
  fetch('/api/info').then(r => r.json()).then(d => { info = d; if (location.hash === '#constructor') route(); }).catch(() => {});

  const checks = () => store.get('checks', {});
  const moduleDone = m => m.check.every((_, i) => checks()[m.id + '.' + i]);
  const totalChecks = () => window.MODULES.reduce((n, m) => n + m.check.length, 0);
  const doneChecks = () => Object.values(checks()).filter(Boolean).length;

  /* ---------- reloj de la sesión (2 h) ---------- */
  const TOTAL = 120 * 60;
  const clock = { run: store.get('clockRun', null), base: store.get('clockBase', 0) };
  const elapsed = () => clock.base + (clock.run ? (Date.now() - clock.run) / 1000 : 0);
  function drawClock() {
    const s = Math.floor(elapsed()), m = Math.floor(s / 60);
    $('#clockTime').textContent = String(Math.floor(m / 60)).padStart(1, '0') + ':' + String(m % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + ' / 2:00';
    $('#clock').classList.toggle('warn', s >= TOTAL - 600 && s < TOTAL);
    $('#clock').classList.toggle('late', s >= TOTAL);
    $('#clockBtn').textContent = clock.run ? '⏸' : '▶';
  }
  $('#clockBtn').onclick = () => {
    if (clock.run) { clock.base = elapsed(); clock.run = null; } else clock.run = Date.now();
    store.set('clockRun', clock.run); store.set('clockBase', clock.base); drawClock();
  };
  $('#clockReset').onclick = () => { clock.run = null; clock.base = 0; store.set('clockRun', null); store.set('clockBase', 0); drawClock(); };
  setInterval(drawClock, 1000); drawClock();

  /* ---------- navegación ---------- */
  const ROUTES = [['inicio', 'Inicio'], ...window.MODULES.map((m, i) => [m.id, (i + 1) + '. ' + m.title]), ['constructor', '🛠 Constructor'], ['recursos', 'Recursos']];
  function drawNav(cur) {
    nav.innerHTML = ROUTES.map(([id, label]) => {
      const m = window.MODULES.find(x => x.id === id);
      return `<a href="#${id}" class="${id === cur ? 'on' : ''}">${esc(label)}${m && moduleDone(m) ? '<span class="ok">✓</span>' : ''}</a>`;
    }).join('');
  }
  function route() {
    const id = (location.hash || '#inicio').slice(1);
    const known = ROUTES.some(r => r[0] === id) ? id : 'inicio';
    drawNav(known);
    view.innerHTML = '';
    if (known === 'inicio') home();
    else if (known === 'constructor') builder();
    else if (known === 'recursos') resources();
    else lesson(window.MODULES.find(m => m.id === known));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ---------- inicio ---------- */
  function home() {
    let start = 0;
    const rows = window.MODULES.map((m, i) => {
      const t = `${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}`; start += m.min;
      return `<a class="agenda-link" href="#${m.id}" style="text-decoration:none"><li><div class="ic">${m.icon}</div><div class="t"><b>${i + 1}. ${esc(m.title)}</b><span>${esc(m.goal)}</span></div><div class="m">${m.min} min<small>desde ${t}</small>${moduleDone(m) ? '<div class="done">✓ listo</div>' : ''}</div></li></a>`;
    }).join('');
    view.innerHTML = `
      <section class="hero"><span class="kick">Taller de 2 horas</span><h1>Crea y configura tu propio agente de IA</h1>
        <p>En dos horas pasas de un chatbot que inventa datos a un agente con instrucciones, herramientas y conocimiento propio, y te llevas el código para seguir.</p>
        <a class="btn" href="#m1">Empezar el módulo 1</a> <a class="btn sec" href="#constructor" style="margin-left:8px">Ir al Constructor</a></section>
      <h2 class="sec-title" style="margin-top:0">Agenda</h2>
      <ul class="agenda">${rows}</ul>
      <div class="card" style="margin-top:18px"><h3>Tu avance</h3><div class="bar"><i id="prog"></i></div><p id="progTxt" style="color:var(--muted);font-size:14px"></p></div>
      <div class="grid g2" style="margin-top:18px">
        <div class="card"><h3>Lo que vas a construir</h3><p>Un agente con rol y límites claros, herramientas reales (calculadora, hora, clima) y notas propias, probado con tres pruebas y exportado a Python.</p></div>
        <div class="card"><h3>Qué necesitas</h3><p>Un navegador y ganas de probar. No hace falta instalar nada: el Constructor corre en esta página y la clave del modelo ya está en el servidor.</p></div>
      </div>`;
    const d = doneChecks(), t = totalChecks();
    $('#prog').style.width = (d / t * 100) + '%';
    $('#progTxt').textContent = `${d} de ${t} puntos de control completados`;
  }

  /* ---------- módulo ---------- */
  function lesson(m) {
    const i = window.MODULES.indexOf(m), prev = window.MODULES[i - 1], next = window.MODULES[i + 1];
    view.innerHTML = `
      <div class="pagehead"><div class="min">Módulo ${i + 1} · ${m.min} min</div><h1>${m.icon} ${esc(m.title)}</h1><p>${esc(m.goal)}</p></div>
      <h2 class="sec-title">Ideas clave</h2>
      <div class="grid g2">${m.concepts.map(c => `<div class="card"><h3>${esc(c[0])}</h3><p>${esc(c[1])}</p></div>`).join('')}</div>
      <h2 class="sec-title">Práctica guiada</h2>
      <ol class="steps">${m.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <p style="margin-top:14px"><a class="btn" id="open" href="#constructor">Abrir en el Constructor →</a></p>
      <h2 class="sec-title">Puntos de control</h2>
      <div class="checks">${m.check.map((c, k) => `<label><input type="checkbox" data-k="${m.id}.${k}" ${checks()[m.id + '.' + k] ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>
      <div class="pager">${prev ? `<a class="btn sec" href="#${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="btn" href="#${next.id}">${esc(next.title)} →</a>` : '<a class="btn" href="#recursos">Recursos →</a>'}</div>`;
    $('#open').onclick = () => { if (m.preset) { store.set('cfg', window.PRESETS[m.preset]); store.set('chat', []); } };
    view.querySelectorAll('.checks input').forEach(c => c.onchange = () => { const all = checks(); all[c.dataset.k] = c.checked; store.set('checks', all); drawNav(m.id); });
  }

  /* ---------- recursos ---------- */
  function resources() {
    const L = [
      ['Groq · llamadas a herramientas', 'https://console.groq.com/docs/tool-use', 'Cómo un modelo pide ejecutar funciones.'],
      ['Groq · claves y modelos', 'https://console.groq.com/keys', 'Crea tu propia clave gratuita para el script exportado.'],
      ['Open-Meteo', 'https://open-meteo.com/en/docs', 'La API de clima sin clave que usa la herramienta.'],
      ['LangChain · agentes', 'https://docs.langchain.com/oss/python/langchain/agents', 'Siguiente paso: agentes con más herramientas.'],
      ['LangGraph', 'https://docs.langchain.com/oss/python/langgraph/quickstart', 'Agentes con estado, ciclos y varios roles.'],
      ['FastAPI', 'https://fastapi.tiangolo.com/tutorial/', 'Publicar tu agente como API.'],
      ['Railway', 'https://docs.railway.com/', 'Poner el agente en línea.'],
      ['Ollama', 'https://ollama.com/library', 'Correr modelos en tu propio computador.']
    ];
    view.innerHTML = `<div class="pagehead"><h1>Recursos</h1><p>Para seguir después del taller.</p></div><div class="grid g2">${L.map(l => `<div class="card links"><h3>${esc(l[0])}</h3><p>${esc(l[2])}</p><p style="margin-top:6px"><a href="${l[1]}" target="_blank" rel="noopener">${esc(l[1].replace('https://', ''))} ↗</a></p></div>`).join('')}</div>`;
  }

  /* ---------- constructor ---------- */
  function mini(text) {
    const blocks = String(text).replace(/\r/g, '').split(/```/);
    return blocks.map((b, n) => {
      if (n % 2) return `<pre>${esc(b.replace(/^\w*\n/, ''))}</pre>`;
      let html = '', list = null;
      const close = () => { if (list) { html += `</${list}>`; list = null; } };
      const inl = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
      b.split('\n').forEach(l => {
        const t = l.trim(), ul = t.match(/^[-*]\s+(.*)/), ol = t.match(/^\d+[.)]\s+(.*)/);
        if (ul) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inl(ul[1])}</li>`; }
        else if (ol) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inl(ol[1])}</li>`; }
        else if (!t) close();
        else { close(); html += `<p>${inl(t.replace(/^#+\s*/, ''))}</p>`; }
      });
      close(); return html;
    }).join('');
  }

  function builder() {
    const cfg = Object.assign({}, window.PRESETS.basico, store.get('cfg', {}));
    let chat = store.get('chat', []);
    const save = () => { store.set('cfg', cfg); };
    const toolList = info.tools.length ? info.tools : [
      { id: 'calculadora', label: 'Calculadora', description: 'Operaciones matemáticas exactas.' },
      { id: 'fecha_hora', label: 'Fecha y hora', description: 'Fecha y hora actuales.' },
      { id: 'clima', label: 'Clima actual', description: 'Clima de una ciudad.' },
      { id: 'buscar_conocimiento', label: 'Buscar en mis notas', description: 'Busca en el texto de «Conocimiento».' }];

    view.innerHTML = `
      ${info.ready ? '' : '<div class="notice">El servidor no tiene configurada la clave de Groq: los agentes no responderán hasta que se defina <code>GROQ_API_KEY</code>.</div>'}
      <div class="builder">
        <section class="panel"><h2>Configura tu agente</h2>
          <div class="field"><label for="preset">Empezar desde un ejemplo</label><select id="preset"><option value="">— elige —</option>${Object.entries(window.PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="name">Nombre</label><input type="text" id="name" maxlength="40"></div>
          <div class="field"><label for="system">Instrucciones (rol, tarea, tono, formato, límites)</label><textarea id="system" rows="7" maxlength="3000"></textarea></div>
          <div class="field"><label for="model">Modelo</label><select id="model">${info.models.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
          <div class="field"><label for="temp">Temperatura: <b id="tv"></b></label><input type="range" id="temp" min="0" max="1.5" step="0.1" style="width:100%"></div>
          <div class="field"><label>Herramientas</label>${toolList.map(t => `<label class="tool"><input type="checkbox" data-tool="${esc(t.id)}"><div><b>${esc(t.label)}</b><span>${esc(t.description)}</span></div></label>`).join('')}</div>
          <div class="field"><label for="kn">Conocimiento (tus notas)</label><textarea id="kn" rows="5" maxlength="20000" placeholder="Pega aquí texto que el agente deba consultar."></textarea><small>Si activas «Buscar en mis notas», el agente lo consulta; si no, se le envía como contexto.</small></div>
          <div class="row"><button class="btn sm" id="dlJson" type="button">Descargar .json</button><button class="btn sm sec" id="dlPy" type="button">Descargar Python</button><button class="btn sm sec" id="imp" type="button">Cargar .json</button><input type="file" id="impFile" accept=".json,application/json" hidden></div>
        </section>
        <section class="panel chat"><div class="row" style="justify-content:space-between;align-items:center"><h2 id="title" style="margin:0"></h2><button class="btn sm sec" id="clear" type="button">Nueva conversación</button></div>
          <div class="msgs" id="msgs" aria-live="polite"></div>
          <form class="composer" id="form"><input type="text" id="q" placeholder="Escribe un mensaje…" maxlength="2000" autocomplete="off"><button class="btn" id="send" type="submit">Enviar</button></form>
        </section>
      </div>
      <dialog id="codeDlg"><form method="dialog"><b>Código de clase</b><p style="margin:6px 0 0;color:var(--muted)">Pídeselo al docente.</p><input type="text" id="codeIn" autocomplete="off"><div class="row"><button class="btn sm" value="ok">Entrar</button></div></form></dialog>`;

    const f = {}; ['preset', 'name', 'system', 'model', 'temp', 'tv', 'kn', 'msgs', 'form', 'q', 'send', 'title'].forEach(id => f[id] = $('#' + id));
    function fill() {
      f.name.value = cfg.name; f.system.value = cfg.system; f.model.value = cfg.model; f.temp.value = cfg.temperature; f.tv.textContent = cfg.temperature; f.kn.value = cfg.knowledge || '';
      view.querySelectorAll('[data-tool]').forEach(c => c.checked = (cfg.tools || []).includes(c.dataset.tool)); f.title.textContent = cfg.name || 'Mi agente';
    }
    function read() {
      cfg.name = f.name.value; cfg.system = f.system.value; cfg.model = f.model.value; cfg.temperature = parseFloat(f.temp.value); cfg.knowledge = f.kn.value;
      cfg.tools = [...view.querySelectorAll('[data-tool]')].filter(c => c.checked).map(c => c.dataset.tool);
      f.tv.textContent = cfg.temperature; f.title.textContent = cfg.name || 'Mi agente'; save();
    }
    view.querySelectorAll('.field input,.field select,.field textarea').forEach(i => { if (i.id !== 'preset') i.addEventListener('input', read); });
    f.preset.onchange = () => { if (f.preset.value) { Object.assign(cfg, window.PRESETS[f.preset.value]); save(); fill(); chat = []; store.set('chat', chat); drawChat(); } f.preset.value = ''; };

    function bubble(role, text) { const d = el('div', { class: 'msg ' + role }); d.innerHTML = role === 'bot' ? mini(text) : ''; if (role !== 'bot') d.textContent = text; f.msgs.appendChild(d); return d; }
    function trace(steps) {
      if (!steps || !steps.length) return;
      const d = el('details', { class: 'trace' }, `<summary>🔧 El agente usó ${steps.length} herramienta${steps.length > 1 ? 's' : ''}</summary>` +
        steps.map(s => `<div class="st"><b>${esc(s.tool)}</b>(${esc(JSON.stringify(s.args))})\n→ ${esc(s.result)}</div>`).join(''));
      d.open = true; f.msgs.appendChild(d);
    }
    function drawChat() {
      f.msgs.innerHTML = '';
      if (!chat.length) f.msgs.appendChild(el('div', { class: 'empty' }, '<p><b>Escribe algo para probar tu agente.</b></p><p>Cambia las instrucciones o activa herramientas y vuelve a preguntar para ver la diferencia.</p>'));
      chat.forEach(m => { if (m.role === 'user') bubble('user', m.content); else { trace(m.steps); bubble('bot', m.content); } });
      f.msgs.scrollTop = f.msgs.scrollHeight;
    }
    $('#clear').onclick = () => { chat = []; store.set('chat', chat); drawChat(); };

    async function ask(text) {
      const history = chat.map(m => ({ role: m.role, content: m.content })).concat({ role: 'user', content: text });
      const headers = { 'Content-Type': 'application/json' };
      const code = store.get('code', ''); if (code) headers['x-access-code'] = code;
      const res = await fetch('/api/agent', { method: 'POST', headers, body: JSON.stringify({ config: cfg, history }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.needsCode) {
        const dlg = $('#codeDlg'); $('#codeIn').value = ''; dlg.showModal();
        await new Promise(r => dlg.addEventListener('close', r, { once: true }));
        if ($('#codeIn').value.trim()) { store.set('code', $('#codeIn').value.trim()); return ask(text); }
      }
      if (!res.ok) throw new Error(data.error || 'No pude hablar con el servidor.');
      return data;
    }
    f.form.onsubmit = async e => {
      e.preventDefault(); const text = f.q.value.trim(); if (!text) return;
      read(); f.q.value = ''; f.send.disabled = true;
      if (!chat.length) f.msgs.innerHTML = '';
      bubble('user', text); const typing = el('div', { class: 'typing' }, 'El agente está pensando…'); f.msgs.appendChild(typing); f.msgs.scrollTop = 1e9;
      try {
        const data = await ask(text);
        chat.push({ role: 'user', content: text }, { role: 'assistant', content: data.reply, steps: data.steps }); store.set('chat', chat.slice(-30));
        drawChat();
      } catch (err) { typing.remove(); f.msgs.appendChild(el('div', { class: 'msg err' })).textContent = err.message; f.msgs.scrollTop = 1e9; }
      finally { f.send.disabled = false; f.q.focus(); }
    };

    const download = (name, text, type) => { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.appendChild(a); a.click(); a.remove(); };
    const slug = () => (cfg.name || 'agente').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'agente';
    $('#dlJson').onclick = () => { read(); download(slug() + '.json', JSON.stringify(cfg, null, 2), 'application/json'); };
    $('#dlPy').onclick = () => { read(); download(slug() + '.py', pythonScript(cfg, toolList), 'text/x-python'); };
    $('#imp').onclick = () => $('#impFile').click();
    $('#impFile').onchange = async e => {
      try { const o = JSON.parse(await e.target.files[0].text()); Object.assign(cfg, { name: String(o.name || 'Mi agente'), system: String(o.system || ''), model: o.model || cfg.model, temperature: Number(o.temperature) || 0.4, tools: Array.isArray(o.tools) ? o.tools : [], knowledge: String(o.knowledge || '') }); save(); fill(); }
      catch (err) { alert('El archivo no es una configuración válida.'); }
    };
    fill(); drawChat();
  }

  /* ---------- exportar a Python ---------- */
  const PY = {
    calculadora: `_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Mod: operator.mod, ast.Pow: operator.pow, ast.USub: operator.neg}
_FUN = {"sqrt": math.sqrt, "sin": math.sin, "cos": math.cos, "tan": math.tan, "abs": abs, "round": round}
_CON = {"pi": math.pi, "e": math.e}

def _eval(n):
    if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
        return n.value
    if isinstance(n, ast.BinOp):
        return _OPS[type(n.op)](_eval(n.left), _eval(n.right))
    if isinstance(n, ast.UnaryOp):
        return _OPS[type(n.op)](_eval(n.operand))
    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in _FUN:
        return _FUN[n.func.id](*[_eval(a) for a in n.args])
    if isinstance(n, ast.Name) and n.id in _CON:
        return _CON[n.id]
    raise ValueError("Expresión no permitida")

def calculadora(expresion):
    return _eval(ast.parse(expresion.replace("^", "**").replace(",", "."), mode="eval").body)`,
    fecha_hora: `def fecha_hora(zona="America/Bogota"):
    return datetime.now(ZoneInfo(zona)).strftime("%A %d de %B de %Y, %H:%M") + f" ({zona})"`,
    clima: `def clima(ciudad):
    def get(url):
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.load(r)
    g = get("https://geocoding-api.open-meteo.com/v1/search?name=" + urllib.parse.quote(ciudad) + "&count=1&language=es")
    if not g.get("results"):
        return f"No encontré la ciudad {ciudad}."
    p = g["results"][0]
    c = get(f"https://api.open-meteo.com/v1/forecast?latitude={p['latitude']}&longitude={p['longitude']}&current=temperature_2m,relative_humidity_2m,wind_speed_10m")["current"]
    return f"{p['name']}: {c['temperature_2m']} °C, humedad {c['relative_humidity_2m']} %, viento {c['wind_speed_10m']} km/h"`,
    buscar_conocimiento: `def buscar_conocimiento(consulta):
    palabras = {w for w in consulta.lower().split() if len(w) > 2}
    partes = [p.strip() for p in CONOCIMIENTO.split("\\n\\n") if p.strip()]
    ranking = sorted(partes, key=lambda p: -len(palabras & set(p.lower().split())))
    return "\\n\\n".join(ranking[:3]) or "No hay fragmentos relacionados."`
  };
  function pythonScript(cfg, toolList) {
    const sel = (cfg.tools || []).filter(t => PY[t]);
    const defs = toolList.filter(t => sel.includes(t.id));
    const schemas = {
      calculadora: { properties: { expresion: { type: 'string' } }, required: ['expresion'] },
      fecha_hora: { properties: { zona: { type: 'string' } }, required: [] },
      clima: { properties: { ciudad: { type: 'string' } }, required: ['ciudad'] },
      buscar_conocimiento: { properties: { consulta: { type: 'string' } }, required: ['consulta'] }
    };
    const tools = defs.map(t => ({ type: 'function', function: { name: t.id, description: t.description, parameters: Object.assign({ type: 'object' }, schemas[t.id]) } }));
    const py = s => JSON.stringify(s);
    const imports = ['import ast, json, math, operator, os, urllib.parse, urllib.request', 'from datetime import datetime', 'from zoneinfo import ZoneInfo', 'from groq import Groq  # pip install groq'].join('\n');
    return `"""${(cfg.name || 'Agente').replace(/"/g, "'")} · generado en el Taller de Agentes (MADSI).

Uso:
  pip install groq
  export GROQ_API_KEY=tu-clave   (la creas gratis en https://console.groq.com/keys)
  python ${slug()}.py
"""
${imports}

client = Groq(api_key=os.environ["GROQ_API_KEY"])
MODEL = ${py(cfg.model)}
TEMPERATURE = ${Number(cfg.temperature) || 0}
SYSTEM = ${py(cfg.system || 'Eres un asistente útil.')}
CONOCIMIENTO = ${py(cfg.knowledge || '')}
${cfg.knowledge && !sel.includes('buscar_conocimiento') ? 'SYSTEM += "\\n\\nNotas del usuario:\\n" + CONOCIMIENTO\n' : ''}
${sel.map(t => PY[t]).join('\n\n')}

FUNCIONES = {${sel.map(t => `"${t}": ${t}`).join(', ')}}
TOOLS = json.loads(r'''${JSON.stringify(tools)}''')


def responder(messages):
    """Bucle del agente: el modelo pide una herramienta, la ejecutamos y le devolvemos el resultado."""
    for _ in range(5):
        kwargs = dict(model=MODEL, temperature=TEMPERATURE, messages=messages)
        if TOOLS:
            kwargs["tools"] = TOOLS
        msg = client.chat.completions.create(**kwargs).choices[0].message
        if not msg.tool_calls:
            return msg.content
        messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [
            {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
            for c in msg.tool_calls]})
        for c in msg.tool_calls:
            try:
                out = str(FUNCIONES[c.function.name](**json.loads(c.function.arguments or "{}")))
            except Exception as e:
                out = f"Error: {e}"
            print(f"  [herramienta] {c.function.name} -> {out}")
            messages.append({"role": "tool", "tool_call_id": c.id, "content": out})
    return "Demasiados pasos sin respuesta."


if __name__ == "__main__":
    historial = [{"role": "system", "content": SYSTEM}]
    print(${py((cfg.name || 'Agente') + ' listo. Escribe "salir" para terminar.')})
    while True:
        texto = input("Tú: ").strip()
        if texto.lower() in ("salir", "exit", ""):
            break
        historial.append({"role": "user", "content": texto})
        respuesta = responder(historial)
        historial.append({"role": "assistant", "content": respuesta})
        print("Agente:", respuesta)
`;
  }

  route();
})();
