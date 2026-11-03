(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view'), nav = $('#nav');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); e.innerHTML = html; return e; };

  /* ---------- servidor y sesión ---------- */
  let info = { needsCode: false, sharedKey: false, models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], tools: [] };
  let me = null; // { username, hasKey, keyHint, progress, settings }

  async function api(path, method = 'GET', body) {
    const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && me && !path.includes('groq-key')) { me = null; showAuth('Tu sesión expiró. Vuelve a entrar.'); throw new Error('Sesión expirada'); }
    if (!res.ok) throw new Error(data.error || 'No pude hablar con el servidor.');
    return data;
  }

  // Almacén del navegador separado por usuario: en un computador compartido nadie ve lo de otra persona.
  const store = {
    key: k => 'taller.' + (me ? me.username : '_') + '.' + k,
    get(k, d) { try { const v = localStorage.getItem(this.key(k)); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  };

  // Progreso y ajustes viven en la cuenta; se guardan con una pequeña espera para no saturar.
  let pending = null;
  function saveState() {
    clearTimeout(pending);
    pending = setTimeout(() => api('/api/me/state', 'PUT', { progress: me.progress, settings: me.settings }).catch(() => {}), 400);
  }
  const checks = () => me.progress || {};
  const setCheck = (k, v) => { me.progress = Object.assign({}, me.progress, { [k]: v }); saveState(); };
  const settings = () => me.settings || {};
  const setSettings = patch => { me.settings = Object.assign({}, me.settings, patch); saveState(); };

  const moduleDone = m => m.setup ? (me.hasKey || !!settings().ollamaOk) : m.check.every((_, i) => checks()[m.id + '.' + i]);
  const totalChecks = () => window.MODULES.reduce((n, m) => n + m.check.length, 0);
  const doneChecks = () => window.MODULES.reduce((n, m) => n + m.check.filter((_, i) => checks()[m.id + '.' + i]).length, 0);
  const modLabel = m => m.id.slice(1) + '. ' + m.title;

  /* ---------- acceso: ingresar o crear cuenta ---------- */
  function showAuth(msg) {
    document.body.classList.add('guest'); $('#who').hidden = true; nav.innerHTML = '';
    let mode = 'login';
    const draw = (err) => {
      view.innerHTML = `<section class="card auth"><img class="logoA" src="logo-usta.png" alt="Universidad Santo Tomás, Bucaramanga"><h1 style="font-size:24px">Taller de Agentes de IA</h1><p class="who2">Facultad de Ingeniería en Inteligencia Artificial<br>Dirige: <b>Dr.-Ing. Cesar Hernando Valencia Niño</b></p>
        <p style="color:var(--muted);margin-top:0">${mode === 'login' ? 'Entra con tu usuario para continuar donde lo dejaste.' : 'Crea tu usuario: tu avance, tu API key y tus agentes quedan guardados en tu cuenta.'}</p>
        <div class="tabs"><button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">Ingresar</button><button type="button" data-m="register" class="${mode === 'register' ? 'on' : ''}">Crear cuenta</button></div>
        ${err || msg ? `<p class="err">${esc(err || msg)}</p>` : ''}
        <form id="af" autocomplete="on">
          <div class="field"><label for="au">Usuario</label><input type="text" id="au" autocomplete="username" autocapitalize="none" required minlength="3" maxlength="30"></div>
          <div class="field"><label for="ap">Contraseña</label><input type="password" id="ap" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="${mode === 'login' ? 1 : 8}" style="width:100%;border:1px solid #cfd6e4;border-radius:10px;padding:8px 10px;font:inherit">${mode === 'register' ? '<p class="hint">Mínimo 8 caracteres. Usa una que no uses en otros sitios.</p>' : ''}</div>
          ${mode === 'register' && info.needsCode ? '<div class="field"><label for="ac">Código de clase</label><input type="text" id="ac" autocomplete="off" required><p class="hint">Te lo da el docente.</p></div>' : ''}
          ${mode === 'register' ? '<p class="hint" style="margin:0 0 10px">Usuario: letras minúsculas, números, punto, guion o guion bajo (3 a 30).</p>' : ''}
          <button class="btn" id="asub" type="submit" style="width:100%">${mode === 'login' ? 'Entrar' : 'Crear mi cuenta'}</button>
        </form></section>`;
      view.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { mode = b.dataset.m; msg = ''; draw(); });
      const au = $('#au'); au.focus();
      $('#af').onsubmit = async e => {
        e.preventDefault(); const btn = $('#asub'); btn.disabled = true;
        try {
          const body = { username: au.value.trim(), password: $('#ap').value };
          if (mode === 'register' && info.needsCode) body.code = $('#ac').value.trim();
          await api(mode === 'login' ? '/api/login' : '/api/register', 'POST', body);
          await start();
        } catch (er) { msg = ''; draw(er.message); }
      };
    };
    draw();
  }

  async function start() {
    me = await api('/api/me');
    document.body.classList.remove('guest');
    $('#who').hidden = false; $('#whoName').textContent = '👤 ' + me.username;
    if (!location.hash || location.hash === '#') location.hash = '#inicio';
    route();
  }
  $('#logout').onclick = async () => { try { await api('/api/logout', 'POST', {}); } catch (e) { /* ya sin sesión */ } me = null; location.hash = ''; showAuth('Cerraste sesión.'); };

  /* ---------- reloj de la sesión (2 h) ---------- */
  const TOTAL = 120 * 60;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
  const clock = { run: lsGet('clockRun', null), base: lsGet('clockBase', 0) };
  const elapsed = () => clock.base + (clock.run ? (Date.now() - clock.run) / 1000 : 0);
  function drawClock() {
    const s = Math.floor(elapsed()), m = Math.floor(s / 60);
    $('#clockTime').textContent = Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + ' / 2:00';
    $('#clock').classList.toggle('warn', s >= TOTAL - 600 && s < TOTAL);
    $('#clock').classList.toggle('late', s >= TOTAL);
    $('#clockBtn').textContent = clock.run ? '⏸' : '▶';
  }
  $('#clockBtn').onclick = () => {
    if (clock.run) { clock.base = elapsed(); clock.run = null; } else clock.run = Date.now();
    lsSet('clockRun', clock.run); lsSet('clockBase', clock.base); drawClock();
  };
  $('#clockReset').onclick = () => { clock.run = null; clock.base = 0; lsSet('clockRun', null); lsSet('clockBase', 0); drawClock(); };
  setInterval(drawClock, 1000); drawClock();

  /* ---------- navegación ---------- */
  const ROUTES = [['inicio', 'Inicio'], ...window.MODULES.map(m => [m.id, modLabel(m)]), ['constructor', '🛠 Constructor'], ['recursos', 'Recursos']];
  function drawNav(cur) {
    nav.innerHTML = ROUTES.map(([id, label]) => {
      const m = window.MODULES.find(x => x.id === id);
      return `<a href="#${id}" class="${id === cur ? 'on' : ''}">${esc(label)}${m && moduleDone(m) ? '<span class="ok">✓</span>' : ''}</a>`;
    }).join('');
  }
  function route() {
    if (!me) return;
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
    const rows = window.MODULES.map(m => {
      const t = `${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}`; start += m.min;
      return `<a href="#${m.id}" style="text-decoration:none"><li><div class="ic">${m.icon}</div><div class="t"><b>${esc(modLabel(m))}</b><span>${esc(m.goal)}</span></div><div class="m">${m.min} min<small>desde ${t}</small>${moduleDone(m) ? '<div class="done">✓ listo</div>' : ''}</div></li></a>`;
    }).join('');
    view.innerHTML = `
      <section class="hero"><span class="kick">Taller de 2 horas</span><h1>Hola, ${esc(me.username)}: vamos a crear tu agente de IA</h1>
        <p>Primero preparas tus modelos (Groq y Ollama), después aprendes las piezas de un agente y terminas con uno propio, probado y exportado.</p>
        <a class="btn" href="#m0">${moduleDone(window.MODULES[0]) ? 'Ir al módulo 1' : 'Empezar: prepara tu entorno'}</a>
        <div class="dir"><span>Facultad de Ingeniería en Inteligencia Artificial · Universidad Santo Tomás, Bucaramanga</span><span>Curso dirigido por <b>Dr.-Ing. Cesar Hernando Valencia Niño</b></span></div></section>
      <div class="status"><h3 style="margin:0">Tu entorno</h3>
        <div class="row2"><span>Cuenta en el taller</span><span class="pill y">✓ ${esc(me.username)}</span></div>
        <div class="row2"><span>Groq (modelo en la nube)</span><span class="pill ${me.hasKey ? 'y' : 'n'}">${me.hasKey ? '✓ API key ' + esc(me.keyHint) : 'Falta tu API key'}</span></div>
        <div class="row2"><span>Ollama (modelo en tu equipo)</span><span class="pill ${settings().ollamaOk ? 'y' : 'n'}">${settings().ollamaOk ? '✓ ' + esc(settings().ollamaModel || 'conectado') : 'Sin conectar'}</span></div>
        ${me.hasKey && settings().ollamaOk ? '' : '<a href="#m0">Completar en el módulo 0 →</a>'}</div>
      <h2 class="sec-title">Agenda</h2>
      <ul class="agenda">${rows}</ul>
      <div class="card" style="margin-top:18px"><h3>Tu avance</h3><div class="bar"><i id="prog"></i></div><p id="progTxt" style="color:var(--muted);font-size:14px"></p></div>`;
    const d = doneChecks(), t = totalChecks();
    $('#prog').style.width = (d / t * 100) + '%';
    $('#progTxt').textContent = `${d} de ${t} puntos de control completados`;
  }

  /* ---------- módulo ---------- */
  function lesson(m) {
    const idx = window.MODULES.indexOf(m), prev = window.MODULES[idx - 1], next = window.MODULES[idx + 1];
    view.innerHTML = `
      <div class="pagehead"><div class="min">Módulo ${m.id.slice(1)} · ${m.min} min</div><h1>${m.icon} ${esc(m.title)}</h1><p>${esc(m.goal)}</p></div>
      <h2 class="sec-title">Ideas clave</h2>
      <div class="grid g2">${m.concepts.map(c => `<div class="card"><h3>${esc(c[0])}</h3><p>${esc(c[1])}</p></div>`).join('')}</div>
      ${m.setup ? '<h2 class="sec-title">Paso a paso</h2><div class="setup" id="setup"></div>' : `
      <h2 class="sec-title">Práctica guiada</h2>
      <ol class="steps">${m.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <p style="margin-top:14px"><a class="btn" id="open" href="#constructor">Abrir en el Constructor →</a></p>
      <h2 class="sec-title">Puntos de control</h2>
      <div class="checks">${m.check.map((c, k) => `<label><input type="checkbox" data-k="${m.id}.${k}" ${checks()[m.id + '.' + k] ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>`}
      <div class="pager">${prev ? `<a class="btn sec" href="#${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="btn" href="#${next.id}">${esc(next.title)} →</a>` : '<a class="btn" href="#recursos">Recursos →</a>'}</div>`;
    if (m.setup) return setup();
    $('#open').onclick = () => { if (m.preset) { store.set('cfg', window.PRESETS[m.preset]); store.set('chat', []); } };
    view.querySelectorAll('.checks input').forEach(c => c.onchange = () => { setCheck(c.dataset.k, c.checked); drawNav(m.id); });
  }

  /* ---------- módulo 0: cuentas y modelos ---------- */
  const OLLAMA_URL = 'http://localhost:11434';
  const TOOL_MODELS = /llama3\.[123]|qwen2\.5|qwen3|mistral|command-r|firefunction|granite3|smollm2|hermes3/i;
  function cmd(text) { return `<pre class="cmd">${esc(text)}<button type="button" data-copy="${esc(text)}">Copiar</button></pre>`; }
  function setup() {
    const box = $('#setup'), origin = location.origin;
    const own = k => `<label class="self"><input type="checkbox" data-s="${k}" ${checks()[k] ? 'checked' : ''}> Ya lo hice</label>`;
    box.innerHTML = `
      <div class="sstep ${checks()['s.groq'] ? 'ok' : ''}"><div class="num">1</div><h3>Crea tu cuenta en Groq</h3>
        <ol><li>Abre <b>console.groq.com</b> y pulsa <b>Sign up</b>.</li><li>Entra con Google, GitHub o tu correo.</li><li>Si te pide confirmar el correo, confírmalo y vuelve a entrar.</li></ol>
        <div class="act"><a class="btn sm" href="https://console.groq.com" target="_blank" rel="noopener">Abrir Groq ↗</a>${own('s.groq')}</div></div>
      <div class="sstep ${me.hasKey ? 'ok' : ''}"><div class="num">2</div><h3>Crea tu API key y guárdala aquí</h3>
        <ol><li>En Groq, en el menú de la izquierda, abre <b>API Keys</b>.</li><li>Pulsa <b>Create API Key</b>, ponle un nombre (por ejemplo «taller») y créala.</li><li>Cópiala ya: empieza por <b>gsk_</b> y solo se muestra una vez.</li><li>Pégala abajo. La verifico con Groq y la guardo cifrada en tu cuenta.</li></ol>
        <div class="act"><input type="password" id="gk" placeholder="${me.hasKey ? 'Guardada (' + esc(me.keyHint) + '). Pega otra para reemplazarla' : 'gsk_…'}" autocomplete="off"><button class="btn sm" id="gkSave" type="button">Guardar y verificar</button>${me.hasKey ? '<button class="btn sm sec" id="gkDel" type="button">Borrar mi clave</button>' : ''}</div>
        <p class="msg2" id="gkMsg">${me.hasKey ? '<span class="good">✓ Tu clave está guardada. Ya puedes usar modelos de Groq.</span>' : ''}</p></div>
      <div class="sstep ${checks()['s.ollama'] ? 'ok' : ''}"><div class="num">3</div><h3>Instala Ollama</h3>
        <ol><li>Entra a <b>ollama.com/download</b> y descarga el instalador de tu sistema (Mac, Windows o Linux).</li><li>Ábrelo y sigue la instalación. Al terminar, Ollama queda corriendo en segundo plano.</li><li>En Linux, en vez del instalador: ejecuta el comando de abajo.</li></ol>
        ${cmd('curl -fsSL https://ollama.com/install.sh | sh')}
        <div class="act"><a class="btn sm" href="https://ollama.com/download" target="_blank" rel="noopener">Abrir descargas de Ollama ↗</a>${own('s.ollama')}</div></div>
      <div class="sstep ${checks()['s.pull'] ? 'ok' : ''}"><div class="num">4</div><h3>Descarga un modelo</h3>
        <ol><li>Abre una terminal (Mac: <b>Terminal</b>; Windows: <b>PowerShell</b>).</li><li>Ejecuta el comando. Pesa unos 2 GB: <b>déjalo descargando y sigue con el módulo 1</b>, no hace falta esperar.</li></ol>
        ${cmd('ollama pull llama3.2')}
        <p class="msg2" style="color:var(--muted)">Es un modelo pequeño que sabe usar herramientas, suficiente para este taller. Para ver lo que ya tienes: <code>ollama list</code>.</p>
        <div class="act">${own('s.pull')}</div></div>
      <div class="sstep ${checks()['s.origin'] ? 'ok' : ''}"><div class="num">5</div><h3>Autoriza esta página en Ollama</h3>
        <p style="margin:2px 0;color:#3b4252">Por seguridad, Ollama solo acepta páginas de tu propio equipo. Hay que decirle que esta dirección es de confianza (una sola vez):</p>
        <div class="os">Mac (Terminal)</div>${cmd(`launchctl setenv OLLAMA_ORIGINS "${origin}"`)}<p class="msg2" style="margin:0;color:var(--muted)">Después cierra Ollama (icono de la barra de menú → Quit) y ábrelo de nuevo.</p>
        <div class="os">Windows (PowerShell)</div>${cmd(`setx OLLAMA_ORIGINS "${origin}"`)}<p class="msg2" style="margin:0;color:var(--muted)">Después cierra Ollama desde la bandeja del sistema y ábrelo de nuevo.</p>
        <div class="os">Linux</div>${cmd(`sudo systemctl edit ollama\n# en el editor agrega estas dos líneas y guarda:\n[Service]\nEnvironment="OLLAMA_ORIGINS=${origin}"\n\nsudo systemctl restart ollama`)}
        <div class="act">${own('s.origin')}</div></div>
      <div class="sstep ${settings().ollamaOk ? 'ok' : ''}"><div class="num">6</div><h3>Prueba la conexión con Ollama</h3>
        <p style="margin:2px 0;color:#3b4252">Usa Chrome o Edge. Si el navegador pregunta si permites conectarse a dispositivos de tu red local, acepta.</p>
        <div class="act"><button class="btn sm" id="olTest" type="button">Probar conexión</button><select id="olModel" hidden></select></div>
        <p class="msg2" id="olMsg">${settings().ollamaOk ? `<span class="good">✓ Conectado. Modelo elegido: ${esc(settings().ollamaModel || '')}</span>` : ''}</p></div>`;

    box.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '¡Copiado!'; } catch (e) { b.textContent = 'Selecciona y copia'; } setTimeout(() => { b.textContent = 'Copiar'; }, 1500); });
    box.querySelectorAll('[data-s]').forEach(c => c.onchange = () => { setCheck(c.dataset.s, c.checked); c.closest('.sstep').classList.toggle('ok', c.checked); });

    $('#gkSave').onclick = async () => {
      const key = $('#gk').value.trim(), msg = $('#gkMsg'); if (!key) { msg.innerHTML = '<span class="bad">Pega tu API key primero.</span>'; return; }
      msg.textContent = 'Verificando con Groq…'; $('#gkSave').disabled = true;
      try { const r = await api('/api/me/groq-key', 'PUT', { key }); me.hasKey = true; me.keyHint = r.keyHint; drawNav('m0'); setup(); $('#gkMsg').innerHTML = '<span class="good">✓ Clave verificada y guardada.</span>'; }
      catch (e) { msg.innerHTML = `<span class="bad">${esc(e.message)}</span>`; $('#gkSave').disabled = false; }
    };
    if ($('#gkDel')) $('#gkDel').onclick = async () => { await api('/api/me/groq-key', 'DELETE'); me.hasKey = false; me.keyHint = null; drawNav('m0'); setup(); };

    const model = $('#olModel');
    $('#olTest').onclick = async () => {
      const msg = $('#olMsg'); msg.textContent = 'Buscando Ollama…';
      try {
        const names = await ollamaModels();
        if (!names.length) { msg.innerHTML = '<span class="bad">Ollama responde, pero no tiene modelos. Haz el paso 4 (<code>ollama pull llama3.2</code>) y vuelve a probar.</span>'; return; }
        const pick = names.find(n => n === settings().ollamaModel) || names.find(n => TOOL_MODELS.test(n)) || names[0];
        model.hidden = false; model.innerHTML = names.map(n => `<option ${n === pick ? 'selected' : ''}>${esc(n)}</option>`).join('');
        const apply = () => { setSettings({ ollamaOk: true, ollamaModel: model.value }); drawNav('m0'); msg.innerHTML = `<span class="good">✓ Conectado. Modelo elegido: ${esc(model.value)}</span>` + (TOOL_MODELS.test(model.value) ? '' : '<br><span class="bad">Ojo: este modelo quizá no sabe usar herramientas. Para el módulo 3 conviene llama3.2.</span>'); };
        model.onchange = apply; apply(); box.querySelectorAll('.sstep')[5].classList.add('ok');
      } catch (e) {
        msg.innerHTML = '<span class="bad">No pude conectar con Ollama. Revisa que esté abierto, que hiciste el paso 5 (y reiniciaste Ollama) y que usas Chrome o Edge.</span>';
      }
    };
  }

  async function ollamaModels() {
    const r = await fetch(OLLAMA_URL + '/api/tags');
    if (!r.ok) throw new Error('Ollama no respondió');
    return ((await r.json()).models || []).map(m => m.name);
  }

  /* ---------- recursos ---------- */
  function resources() {
    const L = [
      ['Groq · claves y modelos', 'https://console.groq.com/keys', 'Administra tus API keys.'],
      ['Groq · llamadas a herramientas', 'https://console.groq.com/docs/tool-use', 'Cómo un modelo pide ejecutar funciones.'],
      ['Ollama · biblioteca de modelos', 'https://ollama.com/library', 'Otros modelos que puedes descargar.'],
      ['Open-Meteo', 'https://open-meteo.com/en/docs', 'La API de clima sin clave que usa la herramienta.'],
      ['LangChain · agentes', 'https://docs.langchain.com/oss/python/langchain/agents', 'Siguiente paso: agentes con más herramientas.'],
      ['LangGraph', 'https://docs.langchain.com/oss/python/langgraph/quickstart', 'Agentes con estado, ciclos y varios roles.'],
      ['FastAPI', 'https://fastapi.tiangolo.com/tutorial/', 'Publicar tu agente como API.'],
      ['Railway', 'https://docs.railway.com/', 'Poner el agente en línea.']
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
    let provider = settings().provider === 'ollama' ? 'ollama' : 'groq';
    const save = () => store.set('cfg', cfg);
    const toolList = info.tools.length ? info.tools : [];
    const noKey = !me.hasKey && !info.sharedKey;

    view.innerHTML = `
      <div id="warn"></div>
      <div class="builder">
        <section class="panel"><h2>Configura tu agente</h2>
          <div class="field"><label for="mine">Mis agentes guardados</label><div class="row"><select id="mine" style="flex:1;min-width:0"><option value="">— ninguno —</option></select><button class="btn sm" id="mineSave" type="button">Guardar</button><button class="btn sm sec" id="mineDel" type="button">Borrar</button></div><small id="mineMsg">Se guardan en tu cuenta.</small></div>
          <div class="field"><label for="preset">Empezar desde un ejemplo</label><select id="preset"><option value="">— elige —</option>${Object.entries(window.PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="prov">Dónde corre el modelo</label><select id="prov"><option value="groq">En la nube · Groq (tu API key)</option><option value="ollama">En mi equipo · Ollama</option></select></div>
          <div class="field"><label for="name">Nombre</label><input type="text" id="name" maxlength="40"></div>
          <div class="field"><label for="system">Instrucciones (rol, tarea, tono, formato, límites)</label><textarea id="system" rows="7" maxlength="3000"></textarea></div>
          <div class="field"><label for="model" id="modelLbl">Modelo</label><select id="model"></select></div>
          <div class="field"><label for="temp">Temperatura: <b id="tv"></b></label><input type="range" id="temp" min="0" max="1.5" step="0.1" style="width:100%"></div>
          <div class="field"><label>Herramientas</label>${toolList.map(t => `<label class="tool"><input type="checkbox" data-tool="${esc(t.id)}"><div><b>${esc(t.label)}</b><span>${esc(t.description)}</span></div></label>`).join('')}</div>
          <div class="field"><label for="kn">Conocimiento (tus notas)</label><textarea id="kn" rows="5" maxlength="20000" placeholder="Pega aquí texto que el agente deba consultar."></textarea><small>Si activas «Buscar en mis notas», el agente lo consulta; si no, se le envía como contexto.</small></div>
          <div class="row"><button class="btn sm" id="dlJson" type="button">Descargar .json</button><button class="btn sm sec" id="dlPy" type="button">Descargar Python</button><button class="btn sm sec" id="imp" type="button">Cargar .json</button><input type="file" id="impFile" accept=".json,application/json" hidden></div>
        </section>
        <section class="panel chat"><div class="row" style="justify-content:space-between;align-items:center"><h2 id="title" style="margin:0"></h2><button class="btn sm sec" id="clear" type="button">Nueva conversación</button></div>
          <div class="msgs" id="msgs" aria-live="polite"></div>
          <form class="composer" id="form"><input type="text" id="q" placeholder="Escribe un mensaje…" maxlength="2000" autocomplete="off"><button class="btn" id="send" type="submit">Enviar</button></form>
        </section>
      </div>`;

    const f = {}; ['preset', 'prov', 'name', 'system', 'model', 'modelLbl', 'temp', 'tv', 'kn', 'msgs', 'form', 'q', 'send', 'title', 'warn', 'mine', 'mineMsg'].forEach(id => f[id] = $('#' + id));

    function drawWarn() {
      f.warn.innerHTML = provider === 'groq' && noKey ? '<div class="notice">Todavía no guardaste tu API key de Groq. Hazlo en el <a href="#m0">módulo 0, paso 2</a>, o cambia a «Ollama».</div>'
        : provider === 'ollama' && !settings().ollamaOk ? '<div class="notice">Todavía no conectaste Ollama. Haz los pasos 3 a 6 del <a href="#m0">módulo 0</a>, o cambia a «Groq».</div>' : '';
    }
    function fillModels() {
      if (provider === 'ollama') {
        f.modelLbl.textContent = 'Modelo local (Ollama)';
        const cur = settings().ollamaModel;
        f.model.innerHTML = `<option>${esc(cur || 'sin conectar')}</option>`;
        ollamaModels().then(names => { if (provider === 'ollama' && names.length) { f.model.innerHTML = names.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join(''); } }).catch(() => {});
      } else {
        f.modelLbl.textContent = 'Modelo (Groq)';
        f.model.innerHTML = info.models.map(m => `<option ${m === cfg.model ? 'selected' : ''}>${esc(m)}</option>`).join('');
      }
    }
    function fill() {
      f.prov.value = provider; fillModels(); drawWarn();
      f.name.value = cfg.name; f.system.value = cfg.system; f.temp.value = cfg.temperature; f.tv.textContent = cfg.temperature; f.kn.value = cfg.knowledge || '';
      view.querySelectorAll('[data-tool]').forEach(c => c.checked = (cfg.tools || []).includes(c.dataset.tool)); f.title.textContent = cfg.name || 'Mi agente';
    }
    function read() {
      cfg.name = f.name.value; cfg.system = f.system.value; cfg.temperature = parseFloat(f.temp.value); cfg.knowledge = f.kn.value;
      if (provider === 'groq') cfg.model = f.model.value; else if (f.model.value !== (settings().ollamaModel || '')) setSettings({ ollamaModel: f.model.value });
      cfg.tools = [...view.querySelectorAll('[data-tool]')].filter(c => c.checked).map(c => c.dataset.tool);
      f.tv.textContent = cfg.temperature; f.title.textContent = cfg.name || 'Mi agente'; save();
    }
    view.querySelectorAll('.field input,.field select,.field textarea').forEach(i => { if (!['preset', 'prov', 'mine'].includes(i.id)) i.addEventListener('input', read); });
    f.prov.onchange = () => { provider = f.prov.value; setSettings({ provider }); fillModels(); drawWarn(); };
    f.preset.onchange = () => { if (f.preset.value) { Object.assign(cfg, window.PRESETS[f.preset.value]); save(); fill(); chat = []; store.set('chat', chat); drawChat(); } f.preset.value = ''; };

    /* agentes guardados en la cuenta */
    let mine = [];
    const note = t => { f.mineMsg.textContent = t; };
    async function loadMine(select) {
      try { mine = await api('/api/agents'); } catch (e) { mine = []; }
      f.mine.innerHTML = '<option value="">— ninguno —</option>' + mine.map(a => `<option ${a.name === select ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    }
    f.mine.onchange = () => { const a = mine.find(x => x.name === f.mine.value); if (a) { Object.assign(cfg, window.PRESETS.basico, a.config); save(); fill(); chat = []; store.set('chat', chat); drawChat(); note('Cargado: ' + a.name); } };
    $('#mineSave').onclick = async () => {
      read(); const name = (cfg.name || '').trim(); if (!name) return note('Ponle un nombre al agente.');
      try { await api('/api/agents/' + encodeURIComponent(name), 'PUT', { config: cfg }); await loadMine(name); note('✓ Guardado en tu cuenta: ' + name); } catch (e) { note(e.message); }
    };
    $('#mineDel').onclick = async () => {
      const name = f.mine.value; if (!name) return note('Elige un agente de la lista.');
      try { await api('/api/agents/' + encodeURIComponent(name), 'DELETE'); await loadMine(); note('Borrado: ' + name); } catch (e) { note(e.message); }
    };

    /* chat */
    function bubble(role, text) { const d = el('div', { class: 'msg ' + role }); if (role === 'bot') d.innerHTML = mini(text); else d.textContent = text; f.msgs.appendChild(d); return d; }
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

    // Modo Ollama: el bucle corre en tu navegador; el servidor solo prepara el prompt y ejecuta las herramientas.
    async function askOllama(history) {
      const model = settings().ollamaModel;
      if (!model) throw new Error('Conecta Ollama primero (módulo 0, paso 6).');
      const prep = await api('/api/prepare', 'POST', { config: cfg });
      const messages = [{ role: 'system', content: prep.system }, ...history], steps = [];
      for (let n = 0; n < 5; n++) {
        let r;
        try {
          r = await fetch(OLLAMA_URL + '/api/chat', { method: 'POST', body: JSON.stringify({ model, messages, stream: false, tools: prep.tools.length ? prep.tools : undefined, options: { temperature: prep.temperature } }) });
        } catch (e) { throw new Error('No pude conectar con Ollama. Revisa que esté abierto y los pasos 5 y 6 del módulo 0.'); }
        if (!r.ok) { const t = await r.text(); throw new Error(/does not support tools/i.test(t) ? 'Ese modelo no soporta herramientas. Usa llama3.2 o desactiva las herramientas.' : 'Ollama no pudo responder: ' + t.slice(0, 160)); }
        const msg = (await r.json()).message || {}, calls = msg.tool_calls || [];
        if (!calls.length) return { reply: msg.content || 'No pude generar una respuesta, intenta de nuevo.', steps };
        messages.push(msg);
        for (const c of calls) {
          const name = c.function.name, args = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function.arguments || {});
          const { result } = await api('/api/tool', 'POST', { config: cfg, name, args });
          steps.push({ tool: name, args, result }); messages.push({ role: 'tool', content: result, tool_name: name });
        }
      }
      return { reply: 'Usé demasiadas herramientas sin llegar a una respuesta. Reformula la pregunta o simplifica las instrucciones.', steps };
    }
    const ask = text => {
      const history = chat.map(m => ({ role: m.role, content: m.content })).concat({ role: 'user', content: text });
      return provider === 'ollama' ? askOllama(history) : api('/api/agent', 'POST', { config: cfg, history });
    };
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

    /* exportar / importar */
    const download = (name, text, type) => { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.appendChild(a); a.click(); a.remove(); };
    const slug = () => (cfg.name || 'agente').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'agente';
    $('#dlJson').onclick = () => { read(); download(slug() + '.json', JSON.stringify(cfg, null, 2), 'application/json'); };
    $('#dlPy').onclick = () => { read(); download(slug() + '.py', pythonScript(cfg, toolList, slug()), 'text/x-python'); };
    $('#imp').onclick = () => $('#impFile').click();
    $('#impFile').onchange = async e => {
      try { const o = JSON.parse(await e.target.files[0].text()); Object.assign(cfg, { name: String(o.name || 'Mi agente'), system: String(o.system || ''), model: o.model || cfg.model, temperature: Number(o.temperature) || 0.4, tools: Array.isArray(o.tools) ? o.tools : [], knowledge: String(o.knowledge || '') }); save(); fill(); }
      catch (err) { alert('El archivo no es una configuración válida.'); }
    };
    fill(); drawChat(); loadMine();
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
  function pythonScript(cfg, toolList, slug) {
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
    return `"""${(cfg.name || 'Agente').replace(/"/g, "'")} · generado en el Taller de Agentes de IA
Facultad de Ingeniería en Inteligencia Artificial · Universidad Santo Tomás.

Uso:
  pip install groq
  export GROQ_API_KEY=tu-clave   (la creas gratis en https://console.groq.com/keys)
  python ${slug}.py
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


  /* ---------- arranque ---------- */
  (async function boot() {
    try { info = await api('/api/info'); } catch (e) { /* se usan los valores por defecto */ }
    try { await start(); } catch (e) { showAuth(); }
  })();
})();
