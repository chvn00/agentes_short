(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view'), nav = $('#nav');
  const pretty = s => String(s).replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); // "ana pérez" → "Ana Pérez"
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); e.innerHTML = html; return e; };

  /* ---------- servidor y sesión ---------- */
  let info = { needsCode: false, sharedKey: false, models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'], formats: {}, tools: [] };
  let me = null; // { username, hasKey, keyHint, progress, settings }
  let groqModels = null; // lista real de Groq (se pide una vez por sesión)

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

  const moduleDone = m => m.setup ? (me.hasKey || info.sharedKey || !!info.serverOllama || !!settings().ollamaOk) : m.check.every((_, i) => checks()[m.id + '.' + i]);
  const totalChecks = () => window.MODULES.reduce((n, m) => n + m.check.length, 0);
  const doneChecks = () => window.MODULES.reduce((n, m) => n + m.check.filter((_, i) => checks()[m.id + '.' + i]).length, 0);
  const modLabel = m => m.id.slice(1) + '. ' + m.title;

  /* ---------- acceso: ingresar o crear cuenta ---------- */
  function showAuth(msg) {
    document.body.classList.add('guest'); $('#who').hidden = true; nav.innerHTML = ''; document.body.classList.remove('menu');
    let mode = 'login';
    const draw = (err) => {
      view.innerHTML = `<section class="card auth"><img class="logoA" src="logo-usta.png" alt="Universidad Santo Tomás, Bucaramanga"><h1 style="font-size:24px">Taller de Agentes de IA</h1><p class="who2">Facultad de Ingeniería en Inteligencia Artificial<br>Dirige: <b>Dr.-Ing. Cesar Hernando Valencia Niño</b></p>
        <p style="color:var(--muted);margin-top:0">${mode === 'login' ? 'Entra con tu nombre y apellido para continuar donde lo dejaste.' : 'Crea tu cuenta con tu nombre y apellido: tu avance, tu API key y tus agentes quedan guardados en tu cuenta.'}</p>
        <div class="tabs"><button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">Ingresar</button><button type="button" data-m="register" class="${mode === 'register' ? 'on' : ''}">Crear cuenta</button></div>
        ${err || msg ? `<p class="err">${esc(err || msg)}</p>` : ''}
        <form id="af" autocomplete="on">
          <div class="field"><label for="au">Nombre y apellido</label><input type="text" id="au" autocomplete="name" placeholder="Ej.: Ana Pérez" required minlength="3" maxlength="60">${mode === 'register' ? '<p class="hint">Con mayúsculas o minúsculas, como prefieras.</p>' : ''}</div>
          <div class="field"><label for="ap">Contraseña</label><input type="password" id="ap" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="${mode === 'login' ? 1 : 8}">${mode === 'register' ? '<p class="hint">Mínimo 8 caracteres.</p>' : ''}</div>
          ${mode === 'register' && info.needsCode ? '<div class="field"><label for="ac">Código de clase</label><input type="text" id="ac" autocomplete="off" required><p class="hint">Te lo da el docente.</p></div>' : ''}
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
    $('#who').hidden = false; $('#whoName').textContent = '👤 ' + pretty(me.username);
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
  const routes = () => [['inicio', 'Inicio', '🏠'], ...window.MODULES.map(m => [m.id, modLabel(m), m.icon]), ['constructor', 'Constructor de agentes', '🛠️'], ['recursos', 'Recursos', '🔗'], ['cuenta', 'Mi cuenta', '⚙️'], ...(me && me.isAdmin ? [['admin', 'Administración', '👑']] : [])];
  function drawNav(cur) {
    nav.innerHTML = routes().map(([id, label, icon]) => {
      const m = window.MODULES.find(x => x.id === id);
      return `<a href="#${id}" class="${id === cur ? 'on' : ''}"><i>${icon}</i><span>${esc(label)}</span>${m && moduleDone(m) ? '<em class="ok">✓</em>' : ''}</a>`;
    }).join('');
    document.body.classList.remove('menu');
  }
  function route() {
    if (!me) return;
    const id = (location.hash || '#inicio').slice(1);
    const known = routes().some(r => r[0] === id) ? id : 'inicio';
    // Los modelos del servidor pueden aparecer o desaparecer (Ollama se abre o se cierra): se revisa al entrar y solo se redibuja si cambió algo.
    if (['inicio', 'm0', 'constructor'].includes(known)) api('/api/info').then(i => { if (JSON.stringify(i.serverOllama) !== JSON.stringify(info.serverOllama) || i.sharedKey !== info.sharedKey) { info = i; route(); } }).catch(() => {});
    drawNav(known);
    view.innerHTML = '';
    if (known === 'inicio') home();
    else if (known === 'constructor') builder();
    else if (known === 'recursos') resources();
    else if (known === 'admin') adminPage();
    else if (known === 'cuenta') accountPage();
    else lesson(window.MODULES.find(m => m.id === known));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  $('#burger').onclick = () => document.body.classList.toggle('menu');
  $('#scrim').onclick = () => document.body.classList.remove('menu');

  /* ---------- inicio ---------- */
  function home() {
    let start = 0;
    const rows = window.MODULES.map(m => {
      const t = `${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}`; start += m.min;
      return `<a href="#${m.id}" style="text-decoration:none"><li><div class="ic">${m.icon}</div><div class="t"><b>${esc(modLabel(m))}</b><span>${esc(m.goal)}</span></div><div class="m">${m.min} min<small>desde ${t}</small>${moduleDone(m) ? '<div class="done">✓ listo</div>' : ''}</div></li></a>`;
    }).join('');
    view.innerHTML = `
      <section class="hero"><span class="kick">Taller de 2 horas</span><h1>Hola, ${esc(pretty(me.username))}: vamos a crear tu agente de IA</h1>
        <p>Primero dejas listos tus modelos (todo desde el navegador, sin instalar nada), después aprendes las piezas de un agente y terminas con uno propio, probado y guardado en tu cuenta.</p>
        <a class="btn" href="#m0">${moduleDone(window.MODULES[0]) ? 'Ir al módulo 1' : 'Empezar: prepara tus modelos'}</a>
        <div class="dir"><span>Facultad de Ingeniería en Inteligencia Artificial · Universidad Santo Tomás, Bucaramanga</span><span>Curso dirigido por <b>Dr.-Ing. Cesar Hernando Valencia Niño</b></span></div></section>
      ${me.isAdmin ? '<div class="card adminCard"><div><h3>👑 Consola del docente</h3><p id="admSum">Estudiantes, avance, agentes y clave de Groq del curso.</p></div><a class="btn" href="#admin">Abrir consola</a></div>' : ''}
      <div class="status"><h3 style="margin:0">Tu entorno</h3>
        <div class="row2"><span>Cuenta en el taller</span><span class="pill y">✓ ${esc(pretty(me.username))}</span></div>
        <div class="row2"><span>Groq con tu propia clave</span><span class="pill ${me.hasKey ? 'y' : 'n'}">${me.hasKey ? '✓ API key ' + esc(me.keyHint) : 'Sin clave propia'}</span></div>
        <div class="row2"><span>Groq con la clave del curso</span><span class="pill ${info.sharedKey ? 'y' : 'n'}">${info.sharedKey ? '✓ Habilitada por el docente' : 'No habilitada'}</span></div>
        <div class="row2"><span>Modelos locales del servidor (sin instalar nada)</span><span class="pill ${info.serverOllama ? 'y' : 'n'}">${info.serverOllama ? '✓ ' + info.serverOllama.map(esc).join(', ') : 'No disponibles'}</span></div>
        ${moduleDone(window.MODULES[0]) ? '' : '<a href="#m0">Completar en el módulo 0 →</a>'}</div>
      <h2 class="sec-title">Agenda</h2>
      <ul class="agenda">${rows}</ul>
      <div class="card" style="margin-top:18px"><h3>Tu avance</h3><div class="bar"><i id="prog"></i></div><p id="progTxt" style="color:var(--muted);font-size:14px"></p></div>`;
    if (me.isAdmin) api('/api/admin/users').then(u => { const st = u.filter(x => !x.isAdmin); $('#admSum').textContent = `${st.length} estudiante${st.length === 1 ? '' : 's'} registrado${st.length === 1 ? '' : 's'} · ${st.filter(x => x.hasKey).length} con API key de Groq · ${st.filter(x => x.ollamaOk).length} con Ollama`; }).catch(() => {});
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
      <div class="status" style="margin:0 0 4px"><h3 style="margin:0">Modelos que ya puedes usar</h3>
        <div class="row2"><span>Modelos locales del servidor</span><span class="pill ${info.serverOllama ? 'y' : 'n'}">${info.serverOllama ? '✓ ' + info.serverOllama.map(esc).join(', ') : 'No disponibles'}</span></div>
        <div class="row2"><span>Groq con la clave del curso</span><span class="pill ${info.sharedKey ? 'y' : 'n'}">${info.sharedKey ? '✓ Habilitada' : 'No habilitada'}</span></div>
        <div class="row2"><span>Groq con tu propia clave</span><span class="pill ${me.hasKey ? 'y' : 'n'}">${me.hasKey ? '✓ Guardada' : 'Pendiente'}</span></div>
        <p style="margin:6px 0 0;color:var(--muted);font-size:14px"><b>No necesitas instalar nada.</b> Con cualquiera de los tres ya puedes crear agentes. Los pasos 1 y 2 son para tener tu propia clave de Groq (así no compartes el límite con el grupo).</p></div>
      <div class="sstep ${checks()['s.groq'] ? 'ok' : ''}"><div class="num">1</div><h3>Crea tu cuenta en Groq <small style="font-weight:400;color:var(--muted)">(opcional si el docente habilitó la clave del curso)</small></h3>
        <ol><li>Abre <b>console.groq.com</b> y pulsa <b>Sign up</b>.</li><li>Entra con Google, GitHub o tu correo.</li><li>Si te pide confirmar el correo, confírmalo y vuelve a entrar.</li></ol>
        <div class="act"><a class="btn sm" href="https://console.groq.com" target="_blank" rel="noopener">Abrir Groq ↗</a>${own('s.groq')}</div></div>
      <div class="sstep ${me.hasKey ? 'ok' : ''}"><div class="num">2</div><h3>Crea tu API key y guárdala aquí</h3>
        <ol><li>En Groq, en el menú de la izquierda, abre <b>API Keys</b>.</li><li>Pulsa <b>Create API Key</b>, ponle un nombre (por ejemplo «taller») y créala.</li><li>Cópiala ya: empieza por <b>gsk_</b> y solo se muestra una vez.</li><li>Pégala abajo. La verifico con Groq y la guardo cifrada en tu cuenta.</li></ol>
        <div class="act"><input type="password" id="gk" placeholder="${me.hasKey ? 'Guardada (' + esc(me.keyHint) + '). Pega otra para reemplazarla' : 'gsk_…'}" autocomplete="off"><button class="btn sm" id="gkSave" type="button">Guardar y verificar</button>${me.hasKey ? '<button class="btn sm sec" id="gkDel" type="button">Borrar mi clave</button>' : ''}</div>
        <p class="msg2" id="gkMsg">${me.hasKey ? '<span class="good">✓ Tu clave está guardada. Ya puedes usar modelos de Groq.</span>' : ''}</p></div>
      <details class="optLocal"><summary>Opcional y avanzado · usar Ollama en tu propio equipo <small>(requiere instalar programas: no es necesario en este taller)</small></summary>
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
        <p class="msg2" id="olMsg">${settings().ollamaOk ? `<span class="good">✓ Conectado. Modelo elegido: ${esc(settings().ollamaModel || '')}</span>` : ''}</p></div>
      </details>`;

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

  /* ---------- mi cuenta ---------- */
  function accountPage() {
    view.innerHTML = `<div class="pagehead"><h1>⚙️ Mi cuenta</h1><p>Tu usuario, tu API key de Groq y tu contraseña.</p></div>
      <div class="grid g2">
        <div class="card"><h3>API key de Groq</h3>
          <p id="acKeyState" style="margin-bottom:8px">${me.hasKey ? `<span class="good">✓ Guardada (${esc(me.keyHint)})</span>` : '<span class="bad">Todavía no tienes una guardada.</span>'}</p>
          <p style="font-size:14px;color:var(--muted)">Pega una clave nueva para reemplazar la actual. La verifico con Groq antes de guardarla y queda cifrada. Puedes crear otra en <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.</p>
          <div class="act sk"><input type="password" id="acKey" placeholder="gsk_…" autocomplete="off"><button class="btn sm" id="acKeySave" type="button">${me.hasKey ? 'Cambiar clave' : 'Guardar clave'}</button>${me.hasKey ? '<button class="btn sm sec" id="acKeyDel" type="button">Borrar mi clave</button>' : ''}</div>
          <p class="msg2" id="acKeyMsg"></p></div>
        <div class="card"><h3>Contraseña</h3>
          ${me.isAdmin ? '<p style="color:var(--muted)">La contraseña del administrador se cambia con la variable <code>ADMIN_PASSWORD</code> en Railway.</p>' : `
          <div class="field"><label for="pwOld">Contraseña actual</label><input type="password" id="pwOld" autocomplete="current-password"></div>
          <div class="field"><label for="pwNew">Contraseña nueva (mínimo 8 caracteres)</label><input type="password" id="pwNew" autocomplete="new-password"></div>
          <button class="btn sm" id="pwSave" type="button">Cambiar contraseña</button><p class="msg2" id="pwMsg"></p>`}</div>
        <div class="card"><h3>Mi sesión</h3><p>Nombre: <b>${esc(pretty(me.username))}</b>${me.isAdmin ? ' · administrador' : ''}</p>
          <p style="margin-top:6px">Ollama: ${settings().ollamaOk ? `<span class="good">✓ ${esc(settings().ollamaModel || 'conectado')}</span>` : '<span class="bad">sin conectar</span>'} · <a href="#m0">configurar en el módulo 0</a></p></div>
      </div>`;
    $('#acKeySave').onclick = async () => {
      const key = $('#acKey').value.trim(), msg = $('#acKeyMsg'); if (!key) { msg.innerHTML = '<span class="bad">Pega tu clave primero.</span>'; return; }
      msg.textContent = 'Verificando con Groq…'; $('#acKeySave').disabled = true;
      try { const r = await api('/api/me/groq-key', 'PUT', { key }); me.hasKey = true; me.keyHint = r.keyHint; groqModels = null; accountPage(); $('#acKeyMsg').innerHTML = '<span class="good">✓ Clave verificada y guardada.</span>'; }
      catch (e) { msg.innerHTML = `<span class="bad">${esc(e.message)}</span>`; $('#acKeySave').disabled = false; }
    };
    if ($('#acKeyDel')) $('#acKeyDel').onclick = async () => { if (!confirm('¿Borrar tu API key de Groq?')) return; await api('/api/me/groq-key', 'DELETE'); me.hasKey = false; me.keyHint = null; groqModels = null; accountPage(); };
    if ($('#pwSave')) $('#pwSave').onclick = async () => {
      const msg = $('#pwMsg');
      try { await api('/api/me/password', 'PUT', { current: $('#pwOld').value, password: $('#pwNew').value }); $('#pwOld').value = ''; $('#pwNew').value = ''; msg.innerHTML = '<span class="good">✓ Contraseña cambiada.</span>'; }
      catch (e) { msg.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
    };
  }

  /* ---------- administración ---------- */
  async function adminPage() {
    view.innerHTML = '<div class="pagehead"><h1>👑 Administración</h1><p>Estudiantes, avance y clave de Groq del curso.</p></div><div id="admBox"><p>Cargando…</p></div>';
    const box = $('#admBox');
    let users, sk;
    try { [users, sk] = await Promise.all([api('/api/admin/users'), api('/api/admin/shared-key')]); }
    catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; }

    const modKeys = window.MODULES.flatMap(m => m.check.map((_, i) => m.id + '.' + i));
    const done = u => modKeys.filter(k => u.progress && u.progress[k]).length;
    const when = d => d ? new Date(d).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const students = users.filter(u => !u.isAdmin);
    const pct = students.length ? Math.round(students.reduce((n, u) => n + done(u), 0) / (students.length * modKeys.length) * 100) : 0;

    box.innerHTML = `
      <div class="card"><h3>Clave de Groq del curso</h3>
        <p style="margin-bottom:8px">Es opcional. La usan quienes todavía no guardaron su propia clave (cada estudiante puede guardar la suya en el módulo 0). Se guarda cifrada y nunca se muestra completa.</p>
        <p class="msg2" id="skState">${sk.hasKey ? `<span class="good">✓ Guardada (${esc(sk.keyHint)})</span>` : sk.fromEnv ? '<span class="good">✓ Hay una clave definida en el servidor (variable GROQ_API_KEY)</span>' : '<span class="bad">Sin clave: cada estudiante necesita la suya.</span>'}</p>
        <div class="act sk"><input type="password" id="skIn" placeholder="gsk_…" autocomplete="off"><button class="btn sm" id="skSave" type="button">Guardar y verificar</button>${sk.hasKey ? '<button class="btn sm sec" id="skDel" type="button">Borrar</button>' : ''}</div></div>
      <div class="stats">
        <div class="card"><b>${students.length}</b><span>estudiantes</span></div>
        <div class="card"><b>${students.filter(u => u.hasKey).length}</b><span>con API key de Groq</span></div>
        <div class="card"><b>${students.filter(u => u.ollamaOk).length}</b><span>con Ollama conectado</span></div>
        <div class="card"><b>${pct}%</b><span>avance promedio</span></div>
      </div>
      <div class="row" style="justify-content:space-between;align-items:center;margin:18px 0 8px"><h2 class="sec-title" style="margin:0">Estudiantes</h2><div class="row"><button class="btn sm dngBtn" id="delSel" type="button" disabled>🗑 Borrar seleccionados</button><button class="btn sm sec" id="csv" type="button">Descargar CSV</button></div></div>
      <div class="tablewrap"><table class="adm"><thead><tr><th><input type="checkbox" id="selAll" title="Seleccionar a todos"></th><th>Usuario</th><th>Creado</th><th>Última vez</th><th>Groq</th><th>Ollama</th><th>Avance</th><th>Agentes</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr data-id="${u.id}"><td>${u.isAdmin ? '' : '<input type="checkbox" class="selU">'}</td><td><b>${esc(pretty(u.username))}</b>${u.isAdmin ? ' <span class="pill y">admin</span>' : ''}</td><td>${when(u.createdAt)}</td><td>${when(u.lastSeen)}</td>
        <td>${u.hasKey ? '✓' : '—'}</td><td>${u.ollamaOk ? '✓ ' + esc(u.ollamaModel || '') : '—'}</td><td>${done(u)}/${modKeys.length}</td><td>${u.agents}</td>
        <td class="acts">${u.agents ? '<button type="button" data-a="ag">Ver agentes</button>' : ''}${u.isAdmin ? '' : '<button type="button" data-a="pw">Nueva contraseña</button><button type="button" data-a="del" class="dng">🗑 Borrar usuario</button>'}</td></tr>`).join('') || '<tr><td colspan="9">Aún no hay usuarios.</td></tr>'}
      </tbody></table></div><div id="agView"></div>`;

    $('#skSave').onclick = async () => {
      const key = $('#skIn').value.trim(), st = $('#skState'); if (!key) { st.innerHTML = '<span class="bad">Pega la clave primero.</span>'; return; }
      st.textContent = 'Verificando con Groq…';
      try { await api('/api/admin/shared-key', 'PUT', { key }); adminPage(); } catch (e) { st.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
    };
    if ($('#skDel')) $('#skDel').onclick = async () => { await api('/api/admin/shared-key', 'DELETE'); adminPage(); };

    $('#csv').onclick = () => {
      const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const head = ['usuario', 'creado', 'ultima_vez', 'groq', 'ollama', 'modelo_ollama', 'puntos_completados', 'puntos_totales', 'agentes'];
      const rows = users.map(u => [u.username, u.createdAt || '', u.lastSeen || '', u.hasKey ? 'si' : 'no', u.ollamaOk ? 'si' : 'no', u.ollamaModel || '', done(u), modKeys.length, u.agents]);
      const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' })), download: 'estudiantes.csv' });
      document.body.appendChild(a); a.click(); a.remove();
    };

    const sel = () => [...box.querySelectorAll('.selU:checked')].map(c => c.closest('tr').dataset.id);
    const upd = () => { const n = sel().length; $('#delSel').disabled = !n; $('#delSel').textContent = n ? `🗑 Borrar seleccionados (${n})` : '🗑 Borrar seleccionados'; };
    $('#selAll').onchange = e => { box.querySelectorAll('.selU').forEach(c => { c.checked = e.target.checked; }); upd(); };
    box.querySelectorAll('.selU').forEach(c => c.onchange = upd);
    $('#delSel').onclick = async () => {
      const ids = sel(); if (!ids.length || !confirm(`¿Borrar ${ids.length} cuenta${ids.length === 1 ? '' : 's'} y todos sus agentes? No se puede deshacer.`)) return;
      try { const r = await api('/api/admin/users/delete', 'POST', { ids }); alert(`${r.deleted} cuenta${r.deleted === 1 ? '' : 's'} borrada${r.deleted === 1 ? '' : 's'}.`); adminPage(); } catch (e) { alert(e.message); }
    };
    box.querySelectorAll('tbody button').forEach(b => b.onclick = async () => {
      const tr = b.closest('tr'), id = tr.dataset.id, name = tr.querySelector('b').textContent;
      try {
        if (b.dataset.a === 'ag') {
          const list = await api(`/api/admin/users/${id}/agents`);
          $('#agView').innerHTML = `<h2 class="sec-title">Agentes de ${esc(name)}</h2>` + list.map(a => `<div class="card" style="margin-bottom:10px"><h3>${esc(a.name)}</h3><p style="white-space:pre-wrap">${esc(a.config.system || '')}</p><p style="color:var(--muted);font-size:13px;margin-top:6px">Modelo: ${esc(a.config.model || '')} · Temperatura: ${esc(a.config.temperature)} · Herramientas: ${esc((a.config.tools || []).join(', ') || 'ninguna')}</p></div>`).join('');
          $('#agView').scrollIntoView({ behavior: 'smooth' });
        } else if (b.dataset.a === 'pw') {
          const p = prompt(`Nueva contraseña para ${name} (mínimo 8 caracteres):`);
          if (p) { await api(`/api/admin/users/${id}/password`, 'POST', { password: p }); alert('Contraseña cambiada. Entrégasela a la persona.'); }
        } else if (confirm(`¿Borrar la cuenta de ${name} y todos sus agentes? No se puede deshacer.`)) { await api(`/api/admin/users/${id}`, 'DELETE'); adminPage(); }
      } catch (e) { alert(e.message); }
    });
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

  const slugApi = n => String(n || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  const apiParams = url => [...new Set([...String(url || '').matchAll(/\{([a-z_][a-z0-9_]{0,19})\}/gi)].map(m => m[1]))].slice(0, 4);
  const API_EXAMPLES = {
    edad: { name: 'edad_por_nombre', description: 'Estima la edad promedio de las personas que tienen un nombre de pila. El parámetro nombre es el nombre en minúsculas.', url: 'https://api.agify.io/?name={nombre}' },
    ciudad: { name: 'ciudad', description: 'Busca una ciudad y devuelve su país, latitud, longitud, altitud y población.', url: 'https://geocoding-api.open-meteo.com/v1/search?name={ciudad}&count=1&language=es' },
    github: { name: 'github_usuario', description: 'Perfil público de un usuario de GitHub: nombre, repositorios públicos y seguidores.', url: 'https://api.github.com/users/{usuario}' },
    vacio: { name: '', description: '', url: '' }
  };

  function builder() {
    const cfg = Object.assign({}, window.PRESETS.basico, store.get('cfg', {}));
    cfg.apis = Array.isArray(cfg.apis) ? cfg.apis : [];
    cfg.memory = Object.assign({ mode: 'window', size: 6 }, cfg.memory);
    cfg.rag = Object.assign({ enabled: (cfg.tools || []).includes('buscar_conocimiento'), k: 3, chunk: 600 }, cfg.rag);
    cfg.maxTokens = cfg.maxTokens || 700;
    cfg.tools = (cfg.tools || []).filter(t => t !== 'buscar_conocimiento');
    let chat = store.get('chat', []);
    const canGroq = me.hasKey || info.sharedKey, canServer = !!info.serverOllama, canLocal = !!settings().ollamaOk;
    let provider = settings().provider;
    if (!(provider === 'groq' || (provider === 'server' && canServer) || (provider === 'ollama' && canLocal))) provider = canGroq || !canServer ? 'groq' : 'server';
    const save = () => store.set('cfg', cfg);
    const TABS = { 1: 'Modelo', 2: 'Personalidad', 3: 'Memoria', 4: 'Herramientas y APIs', 5: 'Conocimiento (RAG)' };
    const toolList = info.tools.filter(t => t.id !== 'buscar_conocimiento');
    const noKey = !canGroq;

    view.innerHTML = `
      <div id="warn"></div>
      <div class="builder">
        <section class="panel cfg"><div class="cfgtop">
            <div class="field"><label for="mine">Mis agentes guardados</label><div class="row"><select id="mine" style="flex:1;min-width:0"><option value="">— ninguno —</option></select><button class="btn sm" id="mineSave" type="button">Guardar</button><button class="btn sm sec" id="mineDel" type="button">Borrar</button></div><small id="mineMsg">Se guardan en tu cuenta.</small></div>
            <div class="field"><label for="preset">Empezar desde un ejemplo</label><select id="preset"><option value="">— elige —</option>${Object.entries(window.PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Exportar o importar</label><div class="row"><button class="btn sm" id="dlJson" type="button">Ver / copiar .json</button><button class="btn sm sec" id="dlLc" type="button">Python con LangChain</button><button class="btn sm sec" id="dlPy" type="button">Python con Groq</button><button class="btn sm sec" id="imp" type="button">Pegar .json</button></div></div>
          </div>
          <div class="ctabs" role="tablist" aria-label="Configuración del agente">${Object.entries(TABS).map(([n, t]) => `<button type="button" class="ctab" role="tab" data-tab="${n}" aria-controls="pane${n}"><span class="n">${n}</span>${t}</button>`).join('')}</div>
          <div class="pane" id="pane1" role="tabpanel" data-pane="1"><div class="body">
            <div class="field"><label for="prov">Dónde corre el modelo</label><select id="prov"><option value="groq">En la nube · Groq</option>${canServer ? '<option value="server">Modelos locales del servidor (sin instalar nada)</option>' : '<option value="" disabled>Modelos locales del servidor: no disponibles en este servidor</option>'}${canLocal ? '<option value="ollama">En mi equipo · Ollama</option>' : ''}</select></div>
            <div class="field"><label for="model" id="modelLbl">Modelo</label><select id="model"></select></div>
            <div class="field"><label for="temp">Temperatura: <b id="tv"></b></label><input type="range" id="temp" min="0" max="1.5" step="0.1" style="width:100%"><div class="scale"><span>0 · preciso y repetible</span><span>1.5 · creativo y variable</span></div>
              <div class="row" style="margin-top:6px"><button type="button" class="btn sm sec" data-temp="0">Preciso · 0</button><button type="button" class="btn sm sec" data-temp="0.5">Equilibrado · 0.5</button><button type="button" class="btn sm sec" data-temp="1.2">Creativo · 1.2</button></div>
              <div class="explain" id="tempExp"></div></div>
            <div class="field"><label for="maxtok">Longitud máxima de la respuesta: <b id="mtv"></b> tokens</label><input type="range" id="maxtok" min="100" max="1500" step="100" style="width:100%"><small>Un token son unas 3/4 de palabra.</small></div>
          </div></div>

          <div class="pane" id="pane2" role="tabpanel" data-pane="2" hidden><div class="body">
            <small style="display:block;margin-bottom:8px">Todo se configura con texto: estos campos llenan una <b>plantilla de prompt</b> (como un <code>ChatPromptTemplate</code> de LangChain) y el modelo la recibe como sus instrucciones.</small>
            <div class="field"><label for="name">Nombre del agente <code class="var">{nombre}</code></label><input type="text" id="name" maxlength="40"></div>
            <div class="field"><label for="persona">Personalidad <code class="var">{personalidad}</code></label><textarea id="persona" rows="2" maxlength="600" placeholder="Ej.: Curiosa, paciente y con sentido del humor; le encanta explicar con analogías."></textarea></div>
            <div class="field"><label for="style">Estilo y tono <code class="var">{estilo}</code></label><input type="text" id="style" maxlength="200" list="styles" placeholder="Ej.: cercano y profesional, sin tecnicismos"><datalist id="styles"><option value="cercano y amable"><option value="formal y profesional"><option value="técnico y preciso"><option value="didáctico, con ejemplos"><option value="breve y directo"><option value="divertido, con humor ligero"></datalist></div>
            <div class="field"><label for="format">Estructura de las respuestas <code class="var">{formato}</code></label><select id="format"></select>
              <textarea id="formatCustom" rows="2" maxlength="600" style="margin-top:6px" hidden></textarea></div>
            <div class="field"><label for="rules">Reglas y límites <code class="var">{reglas}</code></label><textarea id="rules" rows="2" maxlength="800" placeholder="Ej.: No inventes datos. Si no sabes, dilo. Responde siempre en español."></textarea></div>
            <div class="field"><label for="system">Instrucciones adicionales <code class="var">{instrucciones}</code></label><textarea id="system" rows="5" maxlength="3000" placeholder="Cualquier otra indicación sobre el rol y la tarea."></textarea></div>
            <details class="preview"><summary>Ver el prompt final que recibe el modelo</summary><pre id="promptPrev"></pre></details>
          </div></div>

          <div class="pane" id="pane3" role="tabpanel" data-pane="3" hidden><div class="body">
            <div class="field"><label for="memMode">Qué recuerda de la conversación</label><select id="memMode"><option value="none">Sin memoria: solo ve tu último mensaje</option><option value="window">Ventana: los últimos mensajes</option><option value="full">Completa: hasta 20 mensajes</option></select></div>
            <div class="field" id="memSizeBox"><label for="memSize">Mensajes que recuerda: <b id="msv"></b></label><input type="range" id="memSize" min="2" max="20" step="2" style="width:100%"></div>
            <div class="explain" id="memExp"></div>
            <small>Prueba: dile tu nombre y, tres mensajes después, pregunta «¿cómo me llamo?». En el chat, lo que el agente ya olvidó aparece atenuado.</small>
          </div></div>

          <div class="pane" id="pane4" role="tabpanel" data-pane="4" hidden><div class="body">
            <div class="field"><label>Herramientas listas para usar</label>${toolList.map(t => `<label class="tool"><input type="checkbox" data-tool="${esc(t.id)}"><div><b>${esc(t.label)}</b><span>${esc(t.description)}</span></div></label>`).join('')}</div>
            <div class="field"><label>Mis APIs <small style="font-weight:400">(hasta 3, públicas y sin clave)</small></label><div id="apis"></div>
              <div class="row" style="margin-top:6px"><select id="apiEx" style="flex:1;min-width:0"><option value="">+ Agregar API…</option><option value="edad">Ejemplo: edad según el nombre</option><option value="ciudad">Ejemplo: datos de una ciudad</option><option value="github">Ejemplo: usuario de GitHub</option><option value="vacio">En blanco</option></select></div>
              <small>Escribe la URL con los datos variables entre llaves, por ejemplo <code>{nombre}</code>. El agente decide cuándo llamarla y con qué valor. Solo https.</small></div>
          </div></div>

          <div class="pane" id="pane5" role="tabpanel" data-pane="5" hidden><div class="body">
            <label class="tool" style="padding-top:0"><input type="checkbox" id="ragOn"><div><b>Activar RAG</b><span>El agente busca en tus documentos antes de responder y cita lo que encuentra. Sin RAG, el texto se le envía completo como contexto.</span></div></label>
            <div class="field"><label for="kn">Tus documentos</label><textarea id="kn" rows="5" maxlength="60000" placeholder="Pega aquí el texto o carga archivos: se juntan todos en este cuadro."></textarea>
              <div class="row" style="margin-top:6px;align-items:center"><select id="knSample" style="max-width:100%"><option value="">+ Documento de ejemplo…</option>${Object.entries(window.SAMPLE_DOCS).map(([k, d]) => `<option value="${k}">${esc(d.title)}</option>`).join('')}</select><button class="btn sm sec" id="knFile" type="button">Cargar PDF, .md, .txt o .csv</button><button class="btn sm sec" id="knClear" type="button">Vaciar</button><input type="file" id="knFileIn" accept=".pdf,.md,.markdown,.txt,.csv,application/pdf,text/markdown,text/plain,text/csv" multiple hidden><small id="knCount"></small></div><small id="knMsg" style="display:block;margin-top:4px"></small></div>
            <div class="grid2">
              <div class="field"><label for="ragK">Fragmentos a recuperar: <b id="rkv"></b></label><input type="range" id="ragK" min="1" max="5" step="1" style="width:100%"></div>
              <div class="field"><label for="ragChunk">Tamaño de fragmento</label><select id="ragChunk"><option value="300">Pequeño (300)</option><option value="600">Mediano (600)</option><option value="1000">Grande (1000)</option></select></div>
            </div>
            <div class="field"><label for="ragQ">Probar la búsqueda</label><div class="row"><input type="text" id="ragQ" placeholder="Escribe una pregunta de prueba" style="flex:1;min-width:0"><button class="btn sm" id="ragGo" type="button">Buscar</button></div><div id="ragOut"></div></div>
          </div></div>

        </section>
        <section class="panel chat"><div class="row" style="justify-content:space-between;align-items:center"><h2 id="title" style="margin:0"></h2><button class="btn sm sec" id="clear" type="button">Nueva conversación</button></div>
          <div class="sumry" id="sumry"></div>
          <div class="msgs" id="msgs" aria-live="polite"></div>
          <form class="composer" id="form"><input type="text" id="q" placeholder="Escribe un mensaje…" maxlength="2000" autocomplete="off"><button class="btn" id="send" type="submit">Enviar</button></form>
        </section>
      </div>
      <dialog id="pasteDlg" class="codeDlg"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Pegar la configuración de un agente</h3><button class="btn sm sec" id="pasteClose" type="button">Cerrar</button></div>
        <textarea id="pasteText" spellcheck="false" placeholder="Pega aquí el contenido del .json"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn sm" id="pasteLoad" type="button">Cargar en el Constructor</button><small id="pasteMsg" class="bad"></small></div></dialog>
      <dialog id="codeDlg" class="codeDlg"><div class="row" style="justify-content:space-between;align-items:center"><h3 id="codeTitle" style="margin:0"></h3><button class="btn sm sec" id="codeClose" type="button">Cerrar</button></div>
        <p style="color:var(--muted);font-size:13.5px;margin:6px 0" id="codeHelp"></p>
        <textarea id="codeText" readonly spellcheck="false"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn sm" id="codeCopy" type="button">Copiar todo</button><button class="btn sm sec" id="codeSave" type="button">Descargar archivo (si tu equipo lo permite)</button><small id="codeMsg"></small></div></dialog>`;

    const f = {}; ['preset', 'prov', 'name', 'system', 'model', 'modelLbl', 'temp', 'tv', 'maxtok', 'mtv', 'memMode', 'memSize', 'msv', 'memSizeBox', 'apis', 'apiEx', 'ragOn', 'kn', 'knCount', 'ragK', 'rkv', 'ragChunk', 'ragQ', 'persona', 'style', 'format', 'formatCustom', 'rules', 'promptPrev', 'ragOut', 'tempExp', 'memExp', 'knMsg', 'msgs', 'form', 'q', 'send', 'title', 'warn', 'mine', 'mineMsg', 'sumry'].forEach(id => f[id] = $('#' + id));

    const tabBtns = [...view.querySelectorAll('.ctab')], panes = [...view.querySelectorAll('.pane')];
    function showTab(n) {
      n = TABS[n] ? String(n) : '1';
      tabBtns.forEach(b => { const on = b.dataset.tab === n; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
      panes.forEach(p => { p.hidden = p.dataset.pane !== n; });
      store.set('tab', n);
    }
    tabBtns.forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    view.querySelector('.ctabs').addEventListener('keydown', e => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!k) return;
      const cur = tabBtns.findIndex(b => b.classList.contains('on')), nx = tabBtns[(cur + k + tabBtns.length) % tabBtns.length];
      showTab(nx.dataset.tab); nx.focus();
    });
    showTab(store.get('tab', '1'));

    function drawWarn() {
      f.warn.innerHTML = provider === 'groq' && noKey ? `<div class="notice">Todavía no hay clave de Groq para ti. Guárdala en <a href="#cuenta">Mi cuenta</a>${canServer ? ', o cambia a «Modelos locales del servidor»' : ''}; también puedes pedirle al docente que habilite la del curso.</div>` : '';
    }
    function fillModels() {
      if (provider === 'server') {
        f.modelLbl.textContent = 'Modelo local del servidor';
        const cur = settings().serverModel, list = info.serverOllama || [];
        f.model.innerHTML = list.map(n => `<option ${n === (cur || list[0]) ? 'selected' : ''}>${esc(n)}</option>`).join('');
      } else if (provider === 'ollama') {
        f.modelLbl.textContent = 'Modelo local (Ollama en tu equipo)';
        const cur = settings().ollamaModel;
        f.model.innerHTML = `<option>${esc(cur || 'sin conectar')}</option>`;
        ollamaModels().then(names => { if (provider === 'ollama' && names.length) { f.model.innerHTML = names.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join(''); } }).catch(() => {});
      } else {
        f.modelLbl.textContent = 'Modelo (Groq)';
        const list = groqModels || info.models;
        if (!list.includes(cfg.model)) { cfg.model = list[0]; save(); }       // el modelo guardado ya no existe en Groq
        f.model.innerHTML = list.map(m => `<option ${m === cfg.model ? 'selected' : ''}>${esc(m)}</option>`).join('');
      }
    }
    function drawSummary() {
      const mem = cfg.memory.mode === 'none' ? 'sin memoria' : cfg.memory.mode === 'full' ? 'memoria completa' : `memoria de ${cfg.memory.size} mensajes`;
      const nt = cfg.tools.length + cfg.apis.filter(a => a.name && a.url).length;
      f.sumry.innerHTML = [`Temperatura ${cfg.temperature}`, mem, `${nt} herramienta${nt === 1 ? '' : 's'}`, cfg.rag.enabled ? `RAG activo (${cfg.rag.k} fragmentos)` : 'sin RAG'].map(t => `<span>${esc(t)}</span>`).join('');
    }
    function drawApis() {
      f.apis.innerHTML = cfg.apis.map((a, i) => `<div class="apirow" data-i="${i}">
        <input type="text" data-k="name" maxlength="30" placeholder="Nombre corto (ej. paises)" value="${esc(a.name)}">
        <input type="text" data-k="description" maxlength="300" placeholder="Qué hace (el modelo lo lee para decidir cuándo usarla)" value="${esc(a.description)}">
        <input type="text" data-k="url" maxlength="500" placeholder="https://… con {parametros}, ej. https://api.agify.io/?name={nombre}" value="${esc(a.url)}">
        <div class="aprm">Parámetros: <b>${apiParams(a.url).map(p => '{' + p + '}').join(' ') || 'ninguno'}</b></div>
        <div class="row"><button type="button" class="btn sm sec" data-act="test">Probar</button><button type="button" class="btn sm sec" data-act="del">Quitar</button></div><pre class="aptest" hidden></pre></div>`).join('');
    }
    const runtime = () => provider === 'server' ? { provider: 'Ollama, en el servidor del curso', model: settings().serverModel || (info.serverOllama || [])[0] }
      : provider === 'ollama' ? { provider: 'Ollama, en el equipo del estudiante', model: settings().ollamaModel } : { provider: 'Groq', model: cfg.model };
    const FORMAT_LABELS = Object.keys(info.formats || {}).length ? info.formats : { libre: 'Libre (sin formato fijo)', vinetas: 'Viñetas cortas', pasos: 'Pasos numerados', resumen: 'Resumen y detalle', json: 'JSON', personalizado: 'Personalizado' };
    f.format.innerHTML = Object.entries(FORMAT_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    function drawFormat() {
      const custom = f.format.value === 'personalizado', json = f.format.value === 'json';
      f.formatCustom.hidden = !(custom || json);
      f.formatCustom.placeholder = json ? 'Claves del JSON, separadas por comas. Ej.: respuesta, fuente, confianza' : 'Describe cómo quieres que estructure cada respuesta.';
    }
    let prevTimer;
    function drawPrompt() {
      clearTimeout(prevTimer);
      prevTimer = setTimeout(() => api('/api/prepare', 'POST', { config: cfg, runtime: runtime() }).then(p => { if (f.promptPrev.isConnected) f.promptPrev.textContent = p.system; }).catch(() => {}), 350);
    }
    const TEMP_TXT = t => t <= 0.2 ? ['Casi determinista', 'Ante la misma pregunta responde casi igual. Ideal para cálculos, datos exactos y para usar herramientas.']
      : t <= 0.7 ? ['Equilibrado', 'Respuestas naturales y consistentes. Es un buen punto de partida para la mayoría de agentes.']
      : t <= 1.1 ? ['Variado', 'La redacción cambia entre intentos. Sirve para ideas y textos, pero empieza a perder precisión.']
      : ['Muy creativo', 'Cada respuesta es distinta y crece el riesgo de inventar datos o salirse del tema. Úsalo solo para lluvia de ideas.'];
    const MEM_TXT = m => m.mode === 'none' ? ['Sin memoria', 'Cada mensaje se responde como si fuera el primero: el agente no recuerda lo anterior. Sirve para consultas sueltas y es lo más barato en tokens.']
      : m.mode === 'full' ? ['Memoria completa', 'Recuerda hasta 20 mensajes. Mantiene bien el hilo de la conversación, pero gasta más tokens y puede arrastrar temas viejos.']
      : ['Memoria de ventana', `Recuerda solo los últimos ${m.size} mensajes (los tuyos y los suyos). Lo anterior se olvida. Equilibra contexto y costo.`];
    function drawExplain() {
      const [tn, tt] = TEMP_TXT(cfg.temperature), [mn, mt] = MEM_TXT(cfg.memory);
      f.tempExp.innerHTML = `<b>${tn}.</b> ${tt}`; f.memExp.innerHTML = `<b>${mn}.</b> ${mt}`;
    }
    const remembers = () => cfg.memory.mode === 'none' ? 0 : (cfg.memory.mode === 'full' ? 20 : cfg.memory.size) - 1;
    function fill() {
      f.prov.value = provider; fillModels(); drawWarn();
      f.name.value = cfg.name; f.system.value = cfg.system; f.persona.value = cfg.persona || ''; f.style.value = cfg.style || ''; f.rules.value = cfg.rules || '';
      f.format.value = cfg.format || 'libre'; f.formatCustom.value = cfg.formatCustom || ''; drawFormat(); f.temp.value = cfg.temperature; f.tv.textContent = cfg.temperature;
      f.maxtok.value = cfg.maxTokens; f.mtv.textContent = cfg.maxTokens;
      f.memMode.value = cfg.memory.mode; f.memSize.value = cfg.memory.size; f.msv.textContent = cfg.memory.size; f.memSizeBox.hidden = cfg.memory.mode !== 'window';
      view.querySelectorAll('[data-tool]').forEach(c => c.checked = (cfg.tools || []).includes(c.dataset.tool));
      drawApis();
      f.ragOn.checked = cfg.rag.enabled; f.kn.value = cfg.knowledge || ''; f.ragK.value = cfg.rag.k; f.rkv.textContent = cfg.rag.k; f.ragChunk.value = String(cfg.rag.chunk);
      f.knCount.textContent = (cfg.knowledge || '').length + ' / 60000 caracteres'; f.ragOut.innerHTML = '';
      f.title.textContent = cfg.name || 'Mi agente'; drawSummary(); drawExplain(); drawPrompt(); drawChat();
    }
    function read() {
      cfg.name = f.name.value; cfg.system = f.system.value; cfg.persona = f.persona.value; cfg.style = f.style.value; cfg.rules = f.rules.value;
      cfg.format = f.format.value; cfg.formatCustom = f.formatCustom.value; drawFormat(); cfg.temperature = parseFloat(f.temp.value); cfg.maxTokens = parseInt(f.maxtok.value, 10);
      cfg.knowledge = f.kn.value;
      if (provider === 'groq') cfg.model = f.model.value;
      else if (provider === 'server') { if (f.model.value !== settings().serverModel) setSettings({ serverModel: f.model.value }); }
      else if (f.model.value !== (settings().ollamaModel || '')) setSettings({ ollamaModel: f.model.value });
      cfg.memory = { mode: f.memMode.value, size: parseInt(f.memSize.value, 10) };
      cfg.rag = { enabled: f.ragOn.checked, k: parseInt(f.ragK.value, 10), chunk: parseInt(f.ragChunk.value, 10) };
      cfg.tools = [...view.querySelectorAll('[data-tool]')].filter(c => c.checked).map(c => c.dataset.tool);
      f.tv.textContent = cfg.temperature; f.mtv.textContent = cfg.maxTokens; f.msv.textContent = cfg.memory.size; f.rkv.textContent = cfg.rag.k;
      f.memSizeBox.hidden = cfg.memory.mode !== 'window'; f.knCount.textContent = cfg.knowledge.length + ' / 60000 caracteres';
      const sig = cfg.memory.mode + cfg.memory.size;
      f.title.textContent = cfg.name || 'Mi agente'; drawSummary(); drawExplain(); drawPrompt(); save();
      if (sig !== lastSig) { lastSig = sig; drawChat(); }
    }
    let lastSig = '';
    view.querySelectorAll('.cfg input,.cfg select,.cfg textarea').forEach(i => { if (!['preset', 'prov', 'mine', 'apiEx', 'ragQ', 'knFileIn', 'impFile'].includes(i.id) && !i.closest('.apirow')) { i.addEventListener('input', read); i.addEventListener('change', read); } });
    view.querySelectorAll('[data-temp]').forEach(b => b.onclick = () => { f.temp.value = b.dataset.temp; read(); });
    if (!groqModels) api('/api/models').then(r => { groqModels = r.models; if (provider === 'groq' && f.model.isConnected) fillModels(); }).catch(() => {});
    f.prov.onchange = () => { provider = f.prov.value; setSettings({ provider }); fillModels(); drawWarn(); };
    f.prov.value = provider;
    f.preset.onchange = () => { if (f.preset.value) { setCfg(window.PRESETS[f.preset.value]); chat = []; store.set('chat', chat); drawChat(); } f.preset.value = ''; };
    function setCfg(o) {
      const c = JSON.parse(JSON.stringify(o));
      Object.assign(cfg, { persona: '', style: '', rules: '', format: 'libre', formatCustom: '' }, window.PRESETS.basico, c);
      cfg.apis = Array.isArray(c.apis) ? c.apis : []; cfg.memory = Object.assign({ mode: 'window', size: 6 }, c.memory); cfg.maxTokens = c.maxTokens || 700;
      cfg.rag = Object.assign({ enabled: (c.tools || []).includes('buscar_conocimiento'), k: 3, chunk: 600 }, c.rag);
      cfg.tools = (c.tools || []).filter(t => t !== 'buscar_conocimiento'); save(); fill();
    }

    /* APIs propias */
    f.apiEx.onchange = () => {
      const k = f.apiEx.value; f.apiEx.value = ''; if (!k) return;
      if (cfg.apis.length >= 3) return alert('Máximo 3 APIs por agente.');
      cfg.apis.push(Object.assign({}, API_EXAMPLES[k])); save(); drawApis(); drawSummary();
    };
    f.apis.addEventListener('input', e => {
      const row = e.target.closest('.apirow'); if (!row) return; const a = cfg.apis[+row.dataset.i];
      a[e.target.dataset.k] = e.target.value; if (e.target.dataset.k === 'url') row.querySelector('.aprm b').textContent = apiParams(a.url).map(p => '{' + p + '}').join(' ') || 'ninguno';
      save(); drawSummary();
    });
    f.apis.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return; const row = b.closest('.apirow'), i = +row.dataset.i, a = cfg.apis[i];
      if (b.dataset.act === 'del') { cfg.apis.splice(i, 1); save(); drawApis(); drawSummary(); return; }
      const out = row.querySelector('.aptest'); out.hidden = false;
      if (!slugApi(a.name) || !/^https:\/\//i.test(a.url)) { out.textContent = 'Escribe un nombre y una URL que empiece por https://'; return; }
      const args = {}; for (const p of apiParams(a.url)) { const v = prompt(`Valor de prueba para {${p}}:`); if (v === null) { out.hidden = true; return; } args[p] = v; }
      out.textContent = 'Llamando a la API…';
      try { const r = await api('/api/tool', 'POST', { config: cfg, name: 'api_' + slugApi(a.name), args }); out.textContent = r.result.slice(0, 600); } catch (er) { out.textContent = er.message; }
    });

    /* RAG: archivo y prueba de búsqueda */
    $('#knFile').onclick = () => $('#knFileIn').click();
    $('#knSample').onchange = e => {
      const d = window.SAMPLE_DOCS[e.target.value]; e.target.value = ''; if (!d) return;
      const block = (f.kn.value ? '\n\n' : '') + `# ${d.title}\n\n` + d.text;
      f.kn.value = (f.kn.value + block).slice(0, 60000); read(); f.knMsg.textContent = `Se agregó «${d.title}».`;
    };
    $('#knClear').onclick = () => { f.kn.value = ''; f.knMsg.textContent = ''; read(); };
    $('#knFileIn').onchange = async e => {
      const files = [...e.target.files]; e.target.value = ''; const notes = [];
      for (const file of files) {
        f.knMsg.textContent = `Leyendo ${file.name}…`;
        try {
          let text;
          if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
            if (file.size > 10 * 1024 * 1024) throw new Error('pesa más de 10 MB');
            const res = await fetch('/api/extract-text', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'no pude leerlo');
            text = d.text; notes.push(`${file.name}: ${d.pages} página${d.pages === 1 ? '' : 's'}`);
          } else { text = await file.text(); notes.push(file.name); }
          const room = 60000 - f.kn.value.length;
          if (room <= 0) { notes.push('(sin espacio: el cuadro está lleno)'); break; }
          const block = (f.kn.value ? '\n\n' : '') + `# ${file.name}\n\n` + text.trim();
          f.kn.value += block.slice(0, room);
          if (block.length > room) notes.push(`${file.name} se recortó por el límite de 60000 caracteres`);
        } catch (er) { notes.push(`${file.name}: ${er.message}`); }
      }
      read(); f.knMsg.innerHTML = notes.map(esc).join(' · ');
    };
    $('#ragGo').onclick = async () => {
      read(); const q = f.ragQ.value.trim(); if (!q) return;
      f.ragOut.innerHTML = '<small>Buscando…</small>';
      try {
        const r = await api('/api/rag-test', 'POST', { knowledge: cfg.knowledge, query: q, k: cfg.rag.k, chunk: cfg.rag.chunk });
        f.ragOut.innerHTML = `<small>${r.total} fragmento${r.total === 1 ? '' : 's'} en tus documentos</small>` + (r.chunks.length
          ? r.chunks.map((c, n) => `<div class="frag"><b>#${n + 1} · ${c.score} de ${c.of} palabras</b>${esc(c.text)}</div>`).join('')
          : '<div class="frag">Ningún fragmento se parece a esa pregunta. Con esta búsqueda por palabras clave, el agente tampoco encontraría nada.</div>');
      } catch (er) { f.ragOut.innerHTML = `<small class="bad">${esc(er.message)}</small>`; }
    };

    /* agentes guardados en la cuenta */
    let mine = [];
    const note = t => { f.mineMsg.textContent = t; };
    async function loadMine(select) {
      try { mine = await api('/api/agents'); } catch (e) { mine = []; }
      f.mine.innerHTML = '<option value="">— ninguno —</option>' + mine.map(a => `<option ${a.name === select ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    }
    f.mine.onchange = () => { const a = mine.find(x => x.name === f.mine.value); if (a) { setCfg(a.config); chat = []; store.set('chat', chat); drawChat(); note('Cargado: ' + a.name); } };
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
      if (!chat.length) f.msgs.appendChild(el('div', { class: 'empty' }, '<p><b>Escribe algo para probar tu agente.</b></p><p>Cambia temperatura, memoria, herramientas o RAG y vuelve a preguntar para ver la diferencia.</p>'));
      const keepFrom = chat.length - remembers();
      chat.forEach((m, i) => {
        const n0 = f.msgs.childElementCount;
        if (m.role === 'user') bubble('user', m.content); else { trace(m.steps); bubble('bot', m.content); }
        if (i < keepFrom) [...f.msgs.children].slice(n0).forEach(e => e.classList.add('forgot'));
      });
      const lastForgot = [...f.msgs.querySelectorAll('.forgot')].pop();
      if (lastForgot) lastForgot.after(el('div', { class: 'forgotNote' }, 'Lo atenuado ya no está en la memoria del agente'));
      f.msgs.scrollTop = f.msgs.scrollHeight;
    }
    $('#clear').onclick = () => { chat = []; store.set('chat', chat); drawChat(); };

    // Modo Ollama: el bucle corre en tu navegador; el servidor solo prepara el prompt y ejecuta las herramientas.
    async function askOllama(history) {
      const model = settings().ollamaModel;
      if (!model) throw new Error('Conecta Ollama primero (módulo 0, paso 6).');
      const prep = await api('/api/prepare', 'POST', { config: cfg, runtime: runtime() });
      const messages = [{ role: 'system', content: prep.system }, ...history.slice(-prep.historyLimit)], steps = [];
      for (let n = 0; n < 5; n++) {
        let r;
        try {
          r = await fetch(OLLAMA_URL + '/api/chat', { method: 'POST', body: JSON.stringify({ model, messages, stream: false, tools: prep.tools.length ? prep.tools : undefined, options: { temperature: prep.temperature, num_predict: prep.maxTokens } }) });
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
      if (provider === 'server') return api('/api/agent', 'POST', { config: cfg, history, provider: 'server', ollamaModel: f.model.value });
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
    let codeFile = '', codeMime = 'text/plain';
    function showCode(title, help, text, file, mime) {
      $('#codeTitle').textContent = title; $('#codeHelp').textContent = help; $('#codeText').value = text; $('#codeMsg').textContent = '';
      codeFile = file; codeMime = mime; $('#codeDlg').showModal();
    }
    $('#codeClose').onclick = () => $('#codeDlg').close();
    $('#codeCopy').onclick = async () => {
      const ta = $('#codeText'); ta.select();
      let ok = false;
      try { await navigator.clipboard.writeText(ta.value); ok = true; } catch (e) { try { ok = document.execCommand('copy'); } catch (e2) { /* sin portapapeles */ } }
      $('#codeMsg').textContent = ok ? '✓ Copiado' : 'Selecciona el texto y cópialo con Ctrl/Cmd + C';
    };
    $('#codeSave').onclick = () => download(codeFile, $('#codeText').value, codeMime);
    $('#dlJson').onclick = () => { read(); showCode('Configuración de tu agente (.json)', 'Cópiala y guárdala donde quieras; después puedes pegarla en un archivo .json y cargarla con «Cargar .json».', JSON.stringify(cfg, null, 2), slug() + '.json', 'application/json'); };
    $('#dlLc').onclick = async () => {
      read();
      try { const p = await api('/api/prepare', 'POST', { config: cfg, runtime: runtime() }); showCode('Script de Python con LangChain', 'Es tu mismo agente como código. Para ejecutarlo hace falta Python con langchain-groq: sirve para llevártelo después del taller.', langchainScript(cfg, toolList, slug() + '_langchain', p.vars), slug() + '_langchain.py', 'text/x-python'); } catch (e) { alert(e.message); }
    };
    $('#dlPy').onclick = async () => {
      read();
      try { const p = await api('/api/prepare', 'POST', { config: cfg, runtime: runtime() }); showCode('Script de Python con Groq', 'Tu mismo agente con la librería de Groq. Para ejecutarlo hace falta Python con el paquete groq.', pythonScript(cfg, toolList, slug(), p.system), slug() + '.py', 'text/x-python'); } catch (e) { alert(e.message); }
    };
    $('#imp').onclick = () => { $('#pasteText').value = ''; $('#pasteMsg').textContent = ''; $('#pasteDlg').showModal(); };
    $('#pasteClose').onclick = () => $('#pasteDlg').close();
    $('#pasteLoad').onclick = () => {
      try {
        const o = JSON.parse($('#pasteText').value);
        setCfg(Object.assign({}, o, { name: String(o.name || 'Mi agente'), system: String(o.system || ''), temperature: Number(o.temperature) || 0.4, knowledge: String(o.knowledge || '') }));
        $('#pasteDlg').close();
      } catch (err) { $('#pasteMsg').textContent = 'Eso no es una configuración válida: revisa que pegaste el .json completo.'; }
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
  function pythonScript(cfg, toolList, slug, systemText) {
    const sel = (cfg.tools || []).filter(t => PY[t] && t !== 'buscar_conocimiento');
    const ragOn = !!(cfg.rag && cfg.rag.enabled);
    const apis = (cfg.apis || []).filter(a => slugApi(a.name) && /^https:\/\//i.test(a.url));
    const mem = cfg.memory || { mode: 'window', size: 6 };
    const memN = mem.mode === 'none' ? 1 : mem.mode === 'full' ? 20 : mem.size;
    const defs = toolList.filter(t => sel.includes(t.id));
    const schemas = {
      calculadora: { properties: { expresion: { type: 'string' } }, required: ['expresion'] },
      fecha_hora: { properties: { zona: { type: 'string' } }, required: [] },
      clima: { properties: { ciudad: { type: 'string' } }, required: ['ciudad'] }
    };
    const tools = defs.map(t => ({ type: 'function', function: { name: t.id, description: t.description, parameters: Object.assign({ type: 'object' }, schemas[t.id]) } }));
    if (ragOn) tools.push({ type: 'function', function: { name: 'buscar_conocimiento', description: 'Busca fragmentos relevantes en los documentos del usuario.', parameters: { type: 'object', properties: { consulta: { type: 'string' } }, required: ['consulta'] } } });
    apis.forEach(a => { const ps = apiParams(a.url); tools.push({ type: 'function', function: { name: 'api_' + slugApi(a.name), description: a.description || a.name, parameters: { type: 'object', properties: Object.fromEntries(ps.map(p => [p, { type: 'string' }])), required: ps } } }); });
    const py = s => JSON.stringify(s);
    const fnNames = [...sel, ...(ragOn ? ['buscar_conocimiento'] : []), ...apis.map(a => 'api_' + slugApi(a.name))];
    const ragCode = ragOn ? `def buscar_conocimiento(consulta):
    palabras = {w for w in consulta.lower().split() if len(w) > 2}
    partes = [p.strip()[i:i + ${cfg.rag.chunk}] for p in CONOCIMIENTO.split("\\n\\n") if p.strip() for i in range(0, len(p.strip()), ${cfg.rag.chunk})]
    ranking = sorted(partes, key=lambda p: -len(palabras & set(p.lower().split())))
    return "\\n\\n".join(ranking[:${cfg.rag.k}]) or "No hay fragmentos relacionados."` : '';
    const apiCode = apis.length ? `def _api(plantilla, **datos):
    url = plantilla
    for clave, valor in datos.items():
        url = url.replace("{" + clave + "}", urllib.parse.quote(str(valor), safe=""))
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.read(60000).decode("utf-8", "ignore")[:2000]

` + apis.map(a => `def api_${slugApi(a.name)}(**datos):\n    return _api(${py(a.url)}, **datos)`).join('\n\n') : '';
    return `"""${(cfg.name || 'Agente').replace(/"/g, "'")} · generado en el Taller de Agentes de IA
Facultad de Ingeniería en Inteligencia Artificial · Universidad Santo Tomás.

Uso:
  pip install groq
  export GROQ_API_KEY=tu-clave   (la creas gratis en https://console.groq.com/keys)
  python ${slug}.py
"""
import ast, json, math, operator, os, urllib.parse, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo
from groq import Groq  # pip install groq

client = Groq(api_key=os.environ["GROQ_API_KEY"])
MODEL = ${py(cfg.model)}
TEMPERATURE = ${Number(cfg.temperature) || 0}      # 0 = preciso · 1.5 = creativo
MAX_TOKENS = ${(cfg.maxTokens || 700) + (/^(openai\/gpt-oss|qwen\/)/.test(cfg.model) ? 800 : 0)}
MEMORIA = ${memN}      # cuántos mensajes recuerda (${mem.mode === 'none' ? 'sin memoria' : mem.mode === 'full' ? 'memoria completa' : 'ventana'})
SYSTEM = ${py(systemText)}      # nombre, personalidad, estilo, formato y reglas ya incluidos
CONOCIMIENTO = ${py(cfg.knowledge || '')}

${[...sel.map(t => PY[t]), ragCode, apiCode].filter(Boolean).join('\n\n')}

FUNCIONES = {${fnNames.map(t => `"${t}": ${t}`).join(', ')}}
TOOLS = json.loads(r\'\'\'${JSON.stringify(tools)}\'\'\')


def responder(historial):
    """Bucle del agente: el modelo pide una herramienta, la ejecutamos y le devolvemos el resultado."""
    messages = [{"role": "system", "content": SYSTEM}] + historial[-MEMORIA:]
    for _ in range(5):
        kwargs = dict(model=MODEL, temperature=TEMPERATURE, max_tokens=MAX_TOKENS, messages=messages)
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
            print(f"  [herramienta] {c.function.name} -> {out[:200]}")
            messages.append({"role": "tool", "tool_call_id": c.id, "content": out})
    return "Demasiados pasos sin respuesta."


if __name__ == "__main__":
    historial = []
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

  /* ---------- exportar a Python con LangChain ---------- */
  const ANNOT = {
    calculadora: ['def calculadora(expresion):', 'def calculadora(expresion: str) -> str:'],
    fecha_hora: ['def fecha_hora(zona="America/Bogota"):', 'def fecha_hora(zona: str = "America/Bogota") -> str:'],
    clima: ['def clima(ciudad):', 'def clima(ciudad: str) -> str:']
  };
  function langchainScript(cfg, toolList, slug, vars) {
    const py = x => JSON.stringify(x);
    const sel = (cfg.tools || []).filter(t => ANNOT[t]);
    const ragOn = !!(cfg.rag && cfg.rag.enabled);
    const apis = (cfg.apis || []).filter(a => slugApi(a.name) && /^https:\/\//i.test(a.url));
    const mem = cfg.memory || { mode: 'window', size: 6 };
    const memN = mem.mode === 'none' ? 1 : mem.mode === 'full' ? 20 : mem.size;
    const lines = (info.promptLines || []).filter(l => { const k = /\{(\w+)\}/.exec(l)[1]; return vars[k]; });
    const desc = id => (toolList.find(t => t.id === id) || {}).description || id;
    const pyFuncs = [];
    sel.forEach(t => { const [a, b] = ANNOT[t]; pyFuncs.push(PY[t].replace(a, b)); });
    if (ragOn) {
      pyFuncs.push(`def buscar_conocimiento(consulta: str) -> str:
    palabras = {w for w in consulta.lower().split() if len(w) > 2}
    partes = [p.strip()[i:i + ${cfg.rag.chunk}] for p in CONOCIMIENTO.split("\\n\\n") if p.strip() for i in range(0, len(p.strip()), ${cfg.rag.chunk})]
    ranking = sorted(partes, key=lambda p: -len(palabras & set(p.lower().split())))
    return "\\n\\n".join(ranking[:${cfg.rag.k}]) or "No hay fragmentos relacionados."`);
    }
    if (apis.length) {
      pyFuncs.push(`def _api(plantilla, **datos):
    url = plantilla
    for clave, valor in datos.items():
        url = url.replace("{" + clave + "}", urllib.parse.quote(str(valor), safe=""))
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.read(60000).decode("utf-8", "ignore")[:2000]`);
      apis.forEach(a => { const ps = apiParams(a.url); pyFuncs.push(`def api_${slugApi(a.name)}(${ps.map(p => p + ': str').join(', ')}) -> str:\n    return _api(${py(a.url)}${ps.map(p => `, ${p}=${p}`).join('')})`); });
    }
    const toolDefs = [
      ...sel.map(t => [t, desc(t)]),
      ...(ragOn ? [['buscar_conocimiento', 'Busca fragmentos relevantes en los documentos del usuario.']] : []),
      ...apis.map(a => ['api_' + slugApi(a.name), a.description || a.name])
    ];
    return `"""${(cfg.name || 'Agente').replace(/"/g, "'")} · agente con LangChain y Groq
Generado en el Taller de Agentes de IA · Facultad de Ingeniería en Inteligencia Artificial, Universidad Santo Tomás.

Cómo funciona: un ChatPromptTemplate arma las instrucciones con variables (nombre, personalidad, estilo,
formato, reglas), ChatGroq pone el modelo y las herramientas se le enlazan con bind_tools.

Uso:
  pip install langchain-groq langchain-core
  export GROQ_API_KEY=tu-clave   (la creas gratis en https://console.groq.com/keys)
  python ${slug}.py
"""
import ast, json, math, operator, os, urllib.parse, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import StructuredTool
from langchain_groq import ChatGroq

MODEL = ${py(cfg.model)}
TEMPERATURE = ${Number(cfg.temperature) || 0}      # 0 = preciso · 1.5 = creativo
MAX_TOKENS = ${(cfg.maxTokens || 700) + (/^(openai\/gpt-oss|qwen\/)/.test(cfg.model) ? 800 : 0)}
MEMORIA = ${memN}      # cuántos mensajes recuerda (${mem.mode === 'none' ? 'sin memoria' : mem.mode === 'full' ? 'memoria completa' : 'ventana'})
CONOCIMIENTO = ${py(cfg.knowledge || '')}

# 1) La plantilla del prompt: cada {variable} se llena desde VARIABLES.
PLANTILLA = ${py(lines.join('\n'))}
VARIABLES = ${py(Object.fromEntries(lines.map(l => { const k = /\{(\w+)\}/.exec(l)[1]; return [k, vars[k]]; })))}

prompt = ChatPromptTemplate.from_messages([
    ("system", PLANTILLA),
    MessagesPlaceholder("mensajes"),
]).partial(**VARIABLES)

# 2) Las herramientas
${pyFuncs.join('\n\n')}

HERRAMIENTAS = [
${toolDefs.map(([n, d]) => `    StructuredTool.from_function(func=${n}, name=${py(n)}, description=${py(d)}),`).join('\n')}
]

# 3) El modelo y la cadena: prompt | modelo (con herramientas)
llm = ChatGroq(model=MODEL, temperature=TEMPERATURE, max_tokens=MAX_TOKENS)
cadena = prompt | (llm.bind_tools(HERRAMIENTAS) if HERRAMIENTAS else llm)


def responder(mensajes):
    """Bucle del agente: el modelo pide una herramienta, la ejecutamos y le devolvemos el resultado."""
    por_nombre = {h.name: h for h in HERRAMIENTAS}
    for _ in range(5):
        ai = cadena.invoke({"mensajes": mensajes})
        mensajes.append(ai)
        if not ai.tool_calls:
            return ai.content
        for llamada in ai.tool_calls:
            try:
                salida = str(por_nombre[llamada["name"]].invoke(llamada["args"]))
            except Exception as e:
                salida = f"Error: {e}"
            print(f"  [herramienta] {llamada['name']} -> {salida[:200]}")
            mensajes.append(ToolMessage(content=salida, tool_call_id=llamada["id"]))
    return "Demasiados pasos sin respuesta."


if __name__ == "__main__":
    historial = []
    print(${py((cfg.name || 'Agente') + ' listo. Escribe "salir" para terminar.')})
    while True:
        texto = input("Tú: ").strip()
        if texto.lower() in ("salir", "exit", ""):
            break
        respuesta = responder((historial + [HumanMessage(texto)])[-MEMORIA:])
        historial += [HumanMessage(texto), AIMessage(respuesta)]
        print("Agente:", respuesta)
`;
  }

  /* ---------- arranque ---------- */
  (async function boot() {
    try { info = await api('/api/info'); } catch (e) { /* se usan los valores por defecto */ }
    try { await start(); } catch (e) { showAuth(); }
  })();
})();
