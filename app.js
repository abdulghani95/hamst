/* همسة — UI layer. Business rules live in logic.js (window.Logic). */
(function () {
  'use strict';

  const L = window.Logic;
  const STORE_KEY = 'hamsa.v1';

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (name, cls) => '<svg class="i ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';

  let me = null;
  let contacts = [];
  let active = null;
  let ghost = false;
  let hidePreview = false;
  let mode = 'plain';
  let confirmLogout = false;
  let tickTimer = null;
  const opt = { fade: 30, capsule: 60 };
  let uidN = 0;
  const uid = () => 'm' + ++uidN;

  /* ───────── persistence (identity + settings only) ───────── */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function save() {
    try {
      if (me) localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign({}, me, { ghost, hidePreview })));
      else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* storage unavailable: app still works for this session */ }
  }

  /* ───────── helpers ───────── */
  const wide = () => window.matchMedia('(min-width: 860px)').matches;
  const cur = () => contacts.find((c) => c.id === active) || null;
  const byId = (id) => {
    for (const c of contacts) for (const m of c.msgs) if (m.id === id) return m;
    return null;
  };
  function clock(t) {
    try { return new Date(t).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 2600);
  }
  function avatar(name, moodKey, cls) {
    const color = (L.MOODS[moodKey] || L.MOODS.creative).color;
    const ch = String(name).trim().charAt(0).toUpperCase();
    return '<div class="av ' + (cls || '') + '" style="--mc:' + color + '"><span>' + esc(ch) + '</span></div>';
  }

  /* ───────── seed data (demo conversations) ───────── */
  function mk(from, text, kind, agoMs, option, extra) {
    const m = L.createMessage({ id: uid(), from, text, mode: kind, now: Date.now() - agoMs, option });
    return Object.assign(m, extra || {});
  }
  function seed() {
    const M = 60000;
    contacts = [
      {
        id: 'layla', name: 'ليلى الأمين', handle: 'layla.moon', mood: 'calm', unread: 0, typing: false, ri: 0,
        replies: ['ههه ممتاز! جرّب الآن الكبسولة الزمنية.', 'أحب أن الهوية هنا اسم مستخدم فقط.', 'سأرسل لك شيئًا يتلاشى بعد دقيقة.'],
        msgs: [
          mk('them', 'وصلت إلى همسة أخيرًا، والأجمل أنهم لم يطلبوا رقم هاتفي.', 'plain', 36 * M),
          mk('me', 'فعلًا، اسم مستخدم وبس. جرّبي الرسائل التي تتلاشى.', 'plain', 34 * M, 0, { status: 'read' }),
          mk('them', 'هذه الرسالة ستختفي بعد قليل، اقرأها قبل أن تذهب.', 'fade', 2000, 97),
        ],
      },
      {
        id: 'samer', name: 'سامر خالد', handle: 'samer_k', mood: 'spark', unread: 2, typing: false, ri: 0,
        replies: ['أنا متحمس لليلة الجمعة!', 'لا تخبر أحدًا بالمفاجأة.'],
        msgs: [
          mk('them', 'أرسلت لك كبسولة، لا تفتحها قبل وقتها.', 'plain', 3 * M),
          mk('them', 'مفاجأة: حجزت لنا طاولة الجمعة عند الغروب.', 'capsule', 20000, 60),
        ],
      },
      {
        id: 'reem', name: 'ريم الحداد', handle: 'reem.codes', mood: 'focus', unread: 1, typing: false, ri: 0,
        replies: ['تمام، أراك في الاجتماع.', 'أرسلت لك الملف على البريد الآخر.'],
        msgs: [
          mk('me', 'هل وصلك رابط الاجتماع؟', 'plain', 12 * M, 0, { status: 'read' }),
          mk('them', 'رمز دخول غرفة الاجتماع: 4471', 'secret', 5 * M),
        ],
      },
      {
        id: 'yassin', name: 'ياسين مراد', handle: 'yassin.dev', mood: 'creative', unread: 0, typing: false, ri: 0,
        replies: ['جرّبت الواجهة البنفسجية، حلوة جدًا.', 'متى نبدأ نسخة الجوال؟'],
        msgs: [
          mk('them', 'شفت تصميم همسة؟ الهالة الملونة حول الصور فكرة ذكية.', 'plain', 3 * 60 * M),
          mk('me', 'نعم، وهي تتغير حسب مزاجك.', 'plain', 3 * 60 * M - M, 0, { status: 'read' }),
        ],
      },
    ];
  }

  /* ───────── rendering: conversation list ───────── */
  function sortedContacts() {
    const q = $('#q').value;
    const list = L.searchContacts(contacts, q);
    const last = (c) => (c.msgs.length ? c.msgs[c.msgs.length - 1].t : 0);
    return list.sort((a, b) => last(b) - last(a));
  }
  function renderList() {
    const q = $('#q').value;
    const rows = $('#rows');
    const add = L.canAddHandle(contacts, q, me && me.handle);
    let html = '';
    if (q.trim() && add.ok) {
      html += '<button type="button" class="row add-row" data-add="' + esc(add.handle) + '">' +
        '<span class="plus">' + ic('plus') + '</span>' +
        '<span class="row-text"><b>إضافة @' + esc(add.handle) + '</b><span class="pv">ابدأ محادثة بهذا الاسم</span></span></button>';
    }
    const list = sortedContacts();
    for (const c of list) {
      const lm = L.lastVisible(c);
      const pv = c.typing ? '<span class="pv typing-pv">يكتب…</span>' : '<span class="pv">' + esc(L.previewOf(lm) || 'ابدأ المحادثة') + '</span>';
      html += '<button type="button" class="row" role="listitem" data-open="' + esc(c.id) + '"' +
        (c.id === active ? ' aria-current="true"' : '') + '>' +
        avatar(c.name, c.mood) +
        '<span class="row-text"><span class="row-top"><b>' + esc(c.name) + '</b>' + (lm ? '<time>' + clock(lm.t) + '</time>' : '') + '</span>' +
        '<span class="row-bot">' + pv + (c.unread ? '<span class="badge" aria-label="' + c.unread + ' غير مقروءة">' + c.unread + '</span>' : '') + '</span></span></button>';
    }
    if (!list.length && !(q.trim() && add.ok)) html += '<p class="none">لا توجد نتائج. اكتب @اسم_مستخدم لإضافة صديق.</p>';
    rows.innerHTML = html;
    rows.classList.toggle('blurprev', hidePreview);
  }

  function renderMe() {
    if (!me) return;
    $('#meBtn').innerHTML = avatar(me.name, me.mood, 'sm');
  }

  /* ───────── rendering: chat ───────── */
  function tickHtml(m) {
    if (m.from !== 'me') return '';
    return '<span class="ticks" aria-label="' + (m.status === 'read' ? 'قُرئت' : 'أُرسلت') + '">' + ic('check') + (m.status === 'read' ? ic('check') : '') + '</span>';
  }
  const capPercent = (m, now) => Math.min(100, Math.max(0, (1 - (m.unlockAt - now) / m.total) * 100));
  function bubble(m) {
    if (m.mode === 'sys') return '<div class="sys">' + esc(m.text) + '</div>';
    const mine = m.from === 'me';
    const cls = 'msg ' + (mine ? 'me' : 'them') + (m.gone ? ' vanish' : '');
    const meta = (extra) => '<div class="meta">' + (extra || '') + '<time>' + clock(m.t) + '</time>' + tickHtml(m) + '</div>';
    let body;

    if (m.mode === 'capsule' && !m.unlocked) {
      body = '<div class="b cap"><div class="cap-head">' + ic('hourglass') + (mine ? 'كبسولة زمنية مرسلة' : 'كبسولة زمنية') + '</div>' +
        '<div class="cap-sub">تُفتح بعد <b data-cd="' + m.id + '" data-k="cap">' + L.formatCountdown(m.unlockAt - Date.now()) + '</b></div>' +
        '<div class="bar"><i data-bar="' + m.id + '" style="width:' + capPercent(m, Date.now()) + '%"></i></div></div>';
      return '<div class="' + cls + '" data-id="' + m.id + '">' + body + '</div>';
    }
    if (m.mode === 'capsule') {
      body = '<div class="b"><p>' + esc(m.text) + '</p>' + meta('<span class="chip">' + ic('hourglass') + 'فُتحت</span>') + '</div>';
    } else if (m.mode === 'fade') {
      body = '<div class="b"><p>' + esc(m.text) + '</p>' +
        meta('<span class="chip">' + ic('timer') + '<span data-cd="' + m.id + '" data-k="fade">' + L.formatCountdown(m.expiresAt - Date.now()) + '</span></span>') + '</div>';
    } else if (m.mode === 'secret') {
      if (m.burned) {
        body = '<div class="b burned">' + ic('flame') + 'احترقت بعد القراءة</div>';
      } else if (m.open) {
        body = '<div class="b"><p>' + esc(m.text) + '</p>' +
          meta('<span class="chip">' + ic('flame') + 'تحترق بعد <span data-cd="' + m.id + '" data-k="burn">' + L.formatCountdown(m.openUntil - Date.now()) + '</span></span>') + '</div>';
      } else {
        body = '<button type="button" class="b sec" data-secret="' + m.id + '" aria-label="رسالة سرية، اضغط لقراءتها مرة واحدة">' +
          '<span class="blur">' + esc(m.text) + '</span>' +
          '<span class="hint">' + ic('lock') + 'اضغط للكشف · تُحرق بعد القراءة</span></button>';
      }
    } else {
      body = '<div class="b"><p>' + esc(m.text) + '</p>' + meta() + '</div>';
    }
    return '<div class="' + cls + '" data-id="' + m.id + '">' + body + '</div>';
  }

  function renderChatHead() {
    const c = cur();
    if (!c) return;
    $('#chAv').innerHTML = avatar(c.name, c.mood, 'sm');
    $('#chName').textContent = c.name;
    const st = $('#chStatus');
    if (c.typing) { st.textContent = 'يكتب…'; st.className = 'status live'; }
    else { st.textContent = (ghost ? 'أنت متخفٍّ · ' : 'متصل الآن · ') + 'هالة ' + L.MOODS[c.mood].name; st.className = 'status'; }
    $('#ghostBanner').hidden = !ghost;
  }

  function renderMsgs(force) {
    const c = cur();
    const el = $('#msgs');
    if (!c) { el.innerHTML = ''; return; }
    const near = force || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const keep = el.scrollTop;
    el.innerHTML = c.msgs.map(bubble).join('') +
      (c.typing ? '<div class="msg them" aria-label="يكتب"><div class="b typing"><i></i><i></i><i></i></div></div>' : '');
    el.scrollTop = near ? el.scrollHeight : keep;
    updateCountdowns();
  }

  function hintText() {
    if (mode === 'fade') return 'تختفي من المحادثة بعد ' + L.optionLabel(L.FADE_OPTIONS, opt.fade) + ' من إرسالها.';
    if (mode === 'capsule') return 'تظهر مقفلة وتُفتح بعد ' + L.optionLabel(L.CAPSULE_OPTIONS, opt.capsule) + '.';
    if (mode === 'secret') return 'تُعرض مموّهة وتُحرق بعد قراءتها مرة واحدة.';
    return 'رسالة عادية تبقى في المحادثة.';
  }
  function renderComposer() {
    const defs = [['plain', 'chat', 'عادية'], ['fade', 'timer', 'تتلاشى'], ['capsule', 'hourglass', 'كبسولة'], ['secret', 'flame', 'سرّية']];
    $('#modes').innerHTML = defs.map((d) =>
      '<button type="button" class="mode" data-mode="' + d[0] + '" aria-pressed="' + (mode === d[0]) + '">' + ic(d[1]) + d[2] + '</button>').join('');
    const list = mode === 'fade' ? L.FADE_OPTIONS : mode === 'capsule' ? L.CAPSULE_OPTIONS : null;
    let html = '';
    if (list) {
      html += list.map((o) => '<button type="button" class="opt" data-opt="' + o[0] + '" aria-pressed="' + (opt[mode] === o[0]) + '">' + o[1] + '</button>').join('');
    }
    html += '<span data-hint>' + esc(hintText()) + '</span>';
    $('#opts').innerHTML = html;
  }

  function renderChat(force) {
    const c = cur();
    $('#chatEmpty').hidden = !!c;
    $('#chatBody').hidden = !c;
    $('#main').dataset.view = c ? 'chat' : 'list';
    if (!c) return;
    renderChatHead();
    renderMsgs(force);
  }
  function renderAll(force) {
    renderList();
    renderChat(force);
  }

  function updateCountdowns() {
    const now = Date.now();
    document.querySelectorAll('[data-cd]').forEach((el) => {
      const m = byId(el.dataset.cd);
      if (!m) return;
      const end = el.dataset.k === 'cap' ? m.unlockAt : el.dataset.k === 'fade' ? m.expiresAt : m.openUntil;
      el.textContent = L.formatCountdown(end - now);
    });
    document.querySelectorAll('[data-bar]').forEach((el) => {
      const m = byId(el.dataset.bar);
      if (!m) return;
      el.style.width = capPercent(m, now) + '%';
    });
  }

  /* ───────── time loop ───────── */
  function tick() {
    const now = Date.now();
    let changed = false;
    for (const c of contacts) {
      const r = L.stepContact(c, now);
      if (r.changed) changed = true;
      if (r.newlyUnlocked && c.id !== active) { c.unread += r.newlyUnlocked; toast('فُتحت كبسولة من ' + c.name); }
    }
    if (changed) renderAll(false);
    else updateCountdowns();
  }
  function startTick() {
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 500);
  }

  /* ───────── actions ───────── */
  function openChat(id) {
    const c = contacts.find((x) => x.id === id);
    if (!c) return;
    active = id;
    c.unread = 0;
    renderAll(true);
    if (wide()) $('#msg').focus();
  }
  function closeChat() {
    active = null;
    renderAll(false);
  }

  function addContact(handle) {
    const keys = Object.keys(L.MOODS);
    const c = L.newContact(handle, keys[L.hash32(handle) % keys.length]);
    c.msgs.push({ id: uid(), from: 'them', mode: 'sys', text: 'بدأتما المحادثة عبر اسم المستخدم @' + handle, t: Date.now() });
    contacts.push(c);
    $('#q').value = '';
    openChat(c.id);
    toast('أُضيف @' + handle);
  }

  function scheduleReply(c, sent) {
    const delay = L.replyDelay(sent, Date.now());
    setTimeout(() => {
      if (!contacts.includes(c)) return;
      c.typing = true;
      renderList();
      if (c.id === active) { renderChatHead(); renderMsgs(true); }
    }, Math.max(0, delay - 1500));
    setTimeout(() => {
      if (!contacts.includes(c)) return;
      c.typing = false;
      c.msgs.forEach((x) => { if (x.from === 'me' && x.mode !== 'capsule') x.status = 'read'; });
      c.msgs.push(L.createMessage({ id: uid(), from: 'them', text: L.nextReply(c, sent), mode: 'plain', now: Date.now() }));
      if (c.id !== active) { c.unread++; toast('رسالة جديدة من ' + c.name); }
      renderAll(true);
    }, delay);
  }

  function send() {
    const input = $('#msg');
    const text = input.value.trim();
    const c = cur();
    if (!text || !c) return;
    const o = mode === 'fade' ? opt.fade : mode === 'capsule' ? opt.capsule : 0;
    const m = L.createMessage({ id: uid(), from: 'me', text, mode, now: Date.now(), option: o });
    c.msgs.push(m);
    input.value = '';
    renderAll(true);
    scheduleReply(c, m);
  }

  /* ───────── profile sheet ───────── */
  function qrSvg(seed) {
    const q = L.qrCells(seed);
    let s = '<svg class="qr" viewBox="-1 -1 ' + (q.size + 2) + ' ' + (q.size + 2) + '" shape-rendering="crispEdges" role="img" aria-label="رمز إضافتي">';
    q.cells.forEach((p) => { s += '<rect x="' + p[1] + '" y="' + p[0] + '" width="1" height="1" fill="currentColor"/>'; });
    q.finders.forEach((p) => {
      const x = p[1], y = p[0];
      s += '<rect x="' + x + '" y="' + y + '" width="7" height="7" fill="currentColor"/>' +
        '<rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" fill="var(--surface)"/>' +
        '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" fill="currentColor"/>';
    });
    return s + '</svg>';
  }

  function sheetHtml() {
    const moods = Object.keys(L.MOODS).map((k) =>
      '<button type="button" class="mood" data-mood="' + k + '" style="--c:' + L.MOODS[k].color + '" aria-pressed="' + (me.mood === k) + '"><i></i>' + L.MOODS[k].name + '</button>').join('');
    return '<div class="sh-head">' + avatar(me.name, me.mood) +
      '<div class="grow"><h2 id="sheetTitle">' + esc(me.name) + '</h2>' +
      '<span class="handle">@' + esc(me.handle) + ' <button type="button" id="copyHandle" aria-label="نسخ اسم المستخدم">' + ic('copy') + '</button></span></div>' +
      '<button type="button" class="icon-btn" id="closeSheet" aria-label="إغلاق">' + ic('close') + '</button></div>' +
      '<div class="idbox">' + qrSvg(me.handle + me.code) +
      '<div><small>رمز الاستعادة · احتفظ به في مكان آمن</small><span class="code" id="codeText">' + esc(me.code) + '</span></div></div>' +
      '<div><div class="sh-title">هالة المزاج</div><div class="moods">' + moods + '</div></div>' +
      '<div class="set"><div><b>وضع الشبح</b><span>اقرأ واكتب دون أن يرى الآخرون أثرك.</span></div>' +
      '<button type="button" class="switch" role="switch" id="swGhost" aria-label="وضع الشبح" aria-checked="' + ghost + '"></button></div>' +
      '<div class="set"><div><b>إخفاء معاينة الرسائل</b><span>تمويه آخر رسالة في قائمة المحادثات.</span></div>' +
      '<button type="button" class="switch" role="switch" id="swPrev" aria-label="إخفاء معاينة الرسائل" aria-checked="' + hidePreview + '"></button></div>' +
      '<button type="button" class="btn danger" id="logout">' + (confirmLogout ? 'اضغط مرة أخرى لمسح الهوية' : 'مسح الهوية وتسجيل الخروج') + '</button>';
  }
  function openSheet() {
    confirmLogout = false;
    $('#sheet').innerHTML = sheetHtml();
    $('#scrim').hidden = false;
    $('#sheet').focus();
  }
  function refreshSheet() { $('#sheet').innerHTML = sheetHtml(); }
  function closeSheet() { $('#scrim').hidden = true; confirmLogout = false; $('#meBtn').focus(); }

  function logout() {
    me = null; contacts = []; active = null; ghost = false; hidePreview = false; mode = 'plain';
    clearInterval(tickTimer);
    save();
    $('#scrim').hidden = true;
    $('#main').hidden = true;
    $('#auth').hidden = false;
    $('#q').value = '';
  }

  /* ───────── entry ───────── */
  function enter() {
    seed();
    $('#auth').hidden = true;
    $('#main').hidden = false;
    active = null;
    if (wide()) { active = contacts[0].id; contacts[0].unread = 0; }
    renderMe();
    renderComposer();
    renderAll(true);
    startTick();
  }

  function onAuthSubmit(e) {
    e.preventDefault();
    const n = L.validateName($('#nameInput').value);
    const h = L.validateUsername($('#handleInput').value);
    const err = $('#authErr');
    if (!n.ok || !h.ok) {
      err.textContent = !n.ok ? n.error : h.error;
      err.hidden = false;
      (!n.ok ? $('#nameInput') : $('#handleInput')).focus();
      return;
    }
    err.hidden = true;
    me = { name: n.value, handle: h.value, code: L.recoveryCode(), mood: 'creative' };
    ghost = false; hidePreview = false;
    save();
    enter();
  }

  function bind() {
    $('#authForm').addEventListener('submit', onAuthSubmit);
    $('#q').addEventListener('input', renderList);
    $('#q').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const r = L.canAddHandle(contacts, $('#q').value, me.handle);
      if (r.ok) addContact(r.handle);
    });
    $('#rows').addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) return addContact(add.dataset.add);
      const row = e.target.closest('[data-open]');
      if (row) openChat(row.dataset.open);
    });
    $('#backBtn').addEventListener('click', closeChat);
    $('#meBtn').addEventListener('click', openSheet);
    $('#sendForm').addEventListener('submit', (e) => { e.preventDefault(); send(); });

    $('#modes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      mode = b.dataset.mode;
      renderComposer();
    });
    $('#opts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-opt]');
      if (!b) return;
      opt[mode] = Number(b.dataset.opt);
      renderComposer();
    });
    $('#msgs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-secret]');
      if (!b) return;
      const m = byId(b.dataset.secret);
      if (m && L.openSecret(m, Date.now())) renderMsgs(false);
    });

    $('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim') closeSheet(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#scrim').hidden) closeSheet(); });
    $('#sheet').addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('#closeSheet')) return closeSheet();
      const mood = t.closest('[data-mood]');
      if (mood) { me.mood = mood.dataset.mood; save(); renderMe(); refreshSheet(); renderAll(false); return; }
      if (t.closest('#swGhost')) { ghost = !ghost; save(); refreshSheet(); renderChat(false); return; }
      if (t.closest('#swPrev')) { hidePreview = !hidePreview; save(); refreshSheet(); renderList(); return; }
      if (t.closest('#copyHandle')) {
        const text = '@' + me.handle;
        const ok = () => toast('نُسخ ' + text);
        const fail = () => toast('انسخه يدويًا: ' + text);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail);
        else fail();
        return;
      }
      if (t.closest('#logout')) {
        if (!confirmLogout) { confirmLogout = true; refreshSheet(); return; }
        logout();
      }
    });
  }

  function boot() {
    bind();
    const s = load();
    if (s && s.handle && s.name) {
      me = { name: s.name, handle: s.handle, code: s.code, mood: L.MOODS[s.mood] ? s.mood : 'creative' };
      ghost = !!s.ghost;
      hidePreview = !!s.hidePreview;
      enter();
    }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  boot();
})();
