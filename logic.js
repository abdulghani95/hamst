/*
 * همسة — Hamsa messenger
 * Pure logic with no DOM access, so it runs in the browser (window.Logic)
 * and under Node for unit tests (require('./js/logic.js')).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MOODS = {
    calm: { name: 'هادئ', color: '#38bdf8' },
    spark: { name: 'متحمس', color: '#f59e0b' },
    creative: { name: 'مبدع', color: '#c084fc' },
    love: { name: 'عاطفي', color: '#ec4899' },
    focus: { name: 'مركّز', color: '#22c55e' },
  };

  // [seconds, label]
  const FADE_OPTIONS = [[10, '10 ث'], [30, '30 ث'], [60, 'دقيقة']];
  const CAPSULE_OPTIONS = [[20, '20 ث'], [60, 'دقيقة'], [3600, 'ساعة']];
  const MODES = ['plain', 'fade', 'capsule', 'secret'];

  const SECRET_VIEW_MS = 6000; // how long a secret message stays readable once opened
  const SECRET_AUTO_BURN_MS = 9000; // sender's copy burns on its own
  const VANISH_MS = 450; // length of the vanish animation before removal

  const HANDLE_RE = /^[a-z0-9._]{3,20}$/;
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

  function normalizeHandle(s) {
    return String(s == null ? '' : s).trim().replace(/^@+/, '').toLowerCase();
  }

  function validateUsername(input) {
    const value = normalizeHandle(input);
    if (!HANDLE_RE.test(value) || /^[._]|[._]$/.test(value) || /[._]{2}/.test(value)) {
      return {
        ok: false,
        error: 'استخدم من 3 إلى 20 حرفًا إنجليزيًا أو أرقامًا أو نقطة، دون بدء الاسم أو إنهائه بنقطة.',
      };
    }
    return { ok: true, value };
  }

  function validateName(input) {
    const value = String(input == null ? '' : input).trim().replace(/\s+/g, ' ');
    if (value.length < 2 || value.length > 24) {
      return { ok: false, error: 'اكتب اسمًا ظاهرًا من حرفين إلى 24 حرفًا.' };
    }
    return { ok: true, value };
  }

  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // randomBytes(n) -> array-like of n bytes. Defaults to Web Crypto / Node crypto.
  function defaultRandomBytes(n) {
    const out = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(out);
    else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }

  function recoveryCode(randomBytes) {
    const bytes = (randomBytes || defaultRandomBytes)(9);
    let chars = '';
    for (let i = 0; i < 9; i++) chars += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return chars.slice(0, 3) + '-' + chars.slice(3, 6) + '-' + chars.slice(6, 9);
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function formatCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }

  function optionLabel(list, seconds) {
    const hit = list.find((o) => o[0] === seconds);
    return hit ? hit[1] : seconds + ' ث';
  }

  /*
   * Message shapes
   *   plain   : { text }
   *   fade    : { text, expiresAt, gone, goneAt }
   *   capsule : { text, unlockAt, total, unlocked }
   *   secret  : { text, open, openUntil, burned, autoBurn (mine only) }
   *   sys     : { text }   (centred notice)
   */
  function createMessage(o) {
    const now = o.now;
    const m = {
      id: o.id,
      from: o.from,
      text: o.text,
      mode: o.mode || 'plain',
      t: now,
    };
    if (m.from === 'me') m.status = o.status || 'sent';
    if (m.mode === 'fade') {
      m.expiresAt = now + o.option * 1000;
      m.gone = false;
    } else if (m.mode === 'capsule') {
      m.total = o.option * 1000;
      m.unlockAt = now + m.total;
      m.unlocked = false;
    } else if (m.mode === 'secret') {
      m.open = false;
      m.burned = false;
      if (m.from === 'me') m.autoBurn = now + SECRET_AUTO_BURN_MS;
    }
    return m;
  }

  function burn(m) {
    m.burned = true;
    m.open = false;
    m.text = '';
  }

  function openSecret(m, now) {
    if (!m || m.mode !== 'secret' || m.burned || m.open) return false;
    m.open = true;
    m.openUntil = now + SECRET_VIEW_MS;
    return true;
  }

  // Advance one message to `now`. Returns { changed, remove }.
  function stepMessage(m, now) {
    let changed = false;
    let remove = false;
    if (m.mode === 'fade') {
      if (!m.gone && now >= m.expiresAt) {
        m.gone = true;
        m.goneAt = now;
        changed = true;
      }
      if (m.gone && now - m.goneAt >= VANISH_MS) remove = true;
    } else if (m.mode === 'capsule') {
      if (!m.unlocked && now >= m.unlockAt) {
        m.unlocked = true;
        changed = true;
      }
    } else if (m.mode === 'secret' && !m.burned) {
      if (m.open && now >= m.openUntil) {
        burn(m);
        changed = true;
      } else if (!m.open && m.from === 'me' && m.autoBurn && now >= m.autoBurn) {
        burn(m);
        changed = true;
      }
    }
    return { changed, remove };
  }

  // Advance a whole contact. Returns { changed, newlyUnlockedFromThem }.
  function stepContact(c, now) {
    let changed = false;
    let newlyUnlocked = 0;
    for (const m of c.msgs) {
      const wasUnlocked = m.unlocked;
      const r = stepMessage(m, now);
      if (r.changed) changed = true;
      if (m.mode === 'capsule' && !wasUnlocked && m.unlocked && m.from === 'them') newlyUnlocked++;
    }
    const before = c.msgs.length;
    c.msgs = c.msgs.filter((m) => !(m.mode === 'fade' && m.gone && now - m.goneAt >= VANISH_MS));
    if (c.msgs.length !== before) changed = true;
    return { changed, newlyUnlocked };
  }

  function previewOf(m) {
    if (!m) return '';
    if (m.mode === 'sys') return m.text;
    const p = m.from === 'me' ? 'أنت: ' : '';
    if (m.mode === 'fade') return p + (m.gone ? 'اختفت الرسالة' : 'رسالة تتلاشى');
    if (m.mode === 'capsule') return p + (m.unlocked ? 'كبسولة مفتوحة' : 'كبسولة زمنية');
    if (m.mode === 'secret') return p + (m.burned ? 'احترقت الرسالة' : 'رسالة سرية');
    return p + m.text;
  }

  function lastVisible(c) {
    for (let i = c.msgs.length - 1; i >= 0; i--) if (!c.msgs[i].gone) return c.msgs[i];
    return null;
  }

  function replyDelay(m, now) {
    if (m.mode === 'capsule') return Math.max(0, m.unlockAt - now) + 2500;
    return 1800;
  }

  const SPECIAL_REPLIES = {
    fade: 'سأردّ قبل أن تختفي رسالتك!',
    capsule: 'فتحتُ الكبسولة للتو، كانت تستحق الانتظار.',
    secret: 'قرأتها واحترقت. شكرًا على ثقتك.',
  };
  const GENERIC_REPLIES = [
    'وصلتني! أحب أن الهوية هنا اسم مستخدم فقط.',
    'جرّب رسالة تتلاشى، ستعجبك.',
    'ممتاز، نكمل الحديث بعد قليل.',
  ];

  function nextReply(contact, sent) {
    if (sent && SPECIAL_REPLIES[sent.mode]) return SPECIAL_REPLIES[sent.mode];
    const list = contact.replies && contact.replies.length ? contact.replies : GENERIC_REPLIES;
    const i = contact.ri || 0;
    contact.ri = i + 1;
    return list[i % list.length];
  }

  function newContact(handle, moodKey) {
    return {
      id: 'u_' + handle,
      name: handle,
      handle,
      mood: moodKey,
      unread: 0,
      typing: false,
      ri: 0,
      replies: GENERIC_REPLIES.slice(),
      msgs: [],
    };
  }

  function searchContacts(contacts, q) {
    const s = normalizeHandle(q);
    if (!s) return contacts.slice();
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(s) || c.handle.toLowerCase().includes(s) || c.name.includes(String(q).trim())
    );
  }

  function canAddHandle(contacts, q, selfHandle) {
    const v = validateUsername(q);
    if (!v.ok) return { ok: false, reason: 'invalid' };
    if (selfHandle && v.value === normalizeHandle(selfHandle)) return { ok: false, reason: 'self' };
    if (contacts.some((c) => c.handle === v.value)) return { ok: false, reason: 'exists' };
    return { ok: true, handle: v.value };
  }

  // Deterministic QR-looking pattern (for the add-me code). Not a real QR code.
  function qrCells(seed, size) {
    const N = size || 21;
    let x = hash32(String(seed)) || 1;
    const rnd = () => {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
    const inFinder = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);
    const cells = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (inFinder(r, c)) continue;
        if (rnd() > 0.52) cells.push([r, c]);
      }
    }
    const finders = [[0, 0], [0, N - 7], [N - 7, 0]];
    return { size: N, cells, finders };
  }

  return {
    MOODS, FADE_OPTIONS, CAPSULE_OPTIONS, MODES,
    SECRET_VIEW_MS, SECRET_AUTO_BURN_MS, VANISH_MS,
    normalizeHandle, validateUsername, validateName,
    hash32, recoveryCode, formatCountdown, optionLabel,
    createMessage, burn, openSecret, stepMessage, stepContact,
    previewOf, lastVisible, replyDelay, nextReply, newContact,
    searchContacts, canAddHandle, qrCells,
  };
});
