'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

const T0 = 1_700_000_000_000;
const msg = (o) => L.createMessage(Object.assign({ id: 'x', from: 'me', text: 'hi', now: T0 }, o));

test('validateUsername accepts good handles and normalises them', () => {
  assert.deepEqual(L.validateUsername('nour.violet'), { ok: true, value: 'nour.violet' });
  assert.deepEqual(L.validateUsername('  @Nour_99 '), { ok: true, value: 'nour_99' });
  assert.equal(L.validateUsername('abc').ok, true);
  assert.equal(L.validateUsername('a'.repeat(20)).ok, true);
});

test('validateUsername rejects bad handles', () => {
  for (const bad of ['', 'ab', 'a'.repeat(21), 'a!b', 'has space', '.abc', 'abc.', '_abc', 'a..b', 'a__b', 'نور', null, undefined]) {
    const r = L.validateUsername(bad);
    assert.equal(r.ok, false, 'should reject: ' + bad);
    assert.ok(r.error);
  }
});

test('validateName trims, collapses spaces and enforces length', () => {
  assert.deepEqual(L.validateName('  نور   الهدى '), { ok: true, value: 'نور الهدى' });
  assert.equal(L.validateName('ن').ok, false);
  assert.equal(L.validateName('x'.repeat(25)).ok, false);
  assert.equal(L.validateName('').ok, false);
});

test('recoveryCode has XXX-XXX-XXX shape, safe alphabet, and is not constant', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const c = L.recoveryCode();
    assert.match(c, /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 45);
});

test('recoveryCode is deterministic for a given byte source', () => {
  const bytes = () => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(L.recoveryCode(bytes), 'ABC-DEF-GHJ');
});

test('formatCountdown', () => {
  assert.equal(L.formatCountdown(0), '0:00');
  assert.equal(L.formatCountdown(-500), '0:00');
  assert.equal(L.formatCountdown(1), '0:01');
  assert.equal(L.formatCountdown(9500), '0:10');
  assert.equal(L.formatCountdown(60000), '1:00');
  assert.equal(L.formatCountdown(95000), '1:35');
  assert.equal(L.formatCountdown(3600000), '1:00:00');
  assert.equal(L.formatCountdown(3725000), '1:02:05');
});

test('optionLabel falls back to seconds', () => {
  assert.equal(L.optionLabel(L.FADE_OPTIONS, 60), 'دقيقة');
  assert.equal(L.optionLabel(L.FADE_OPTIONS, 7), '7 ث');
});

test('createMessage sets the right fields per mode', () => {
  const plain = msg({});
  assert.equal(plain.mode, 'plain');
  assert.equal(plain.status, 'sent');

  const fade = msg({ mode: 'fade', option: 30 });
  assert.equal(fade.expiresAt, T0 + 30000);
  assert.equal(fade.gone, false);

  const cap = msg({ mode: 'capsule', option: 20 });
  assert.equal(cap.unlockAt, T0 + 20000);
  assert.equal(cap.total, 20000);
  assert.equal(cap.unlocked, false);

  const sec = msg({ mode: 'secret' });
  assert.equal(sec.open, false);
  assert.equal(sec.burned, false);
  assert.equal(sec.autoBurn, T0 + L.SECRET_AUTO_BURN_MS);

  const theirs = msg({ from: 'them', mode: 'secret' });
  assert.equal(theirs.autoBurn, undefined);
  assert.equal(theirs.status, undefined);
});

test('fade: not gone before expiry, gone at expiry, removed after the vanish animation', () => {
  const m = msg({ mode: 'fade', option: 10 });
  assert.deepEqual(L.stepMessage(m, T0 + 9999), { changed: false, remove: false });
  assert.equal(m.gone, false);
  assert.deepEqual(L.stepMessage(m, T0 + 10000), { changed: true, remove: false });
  assert.equal(m.gone, true);
  assert.deepEqual(L.stepMessage(m, T0 + 10000 + L.VANISH_MS - 1), { changed: false, remove: false });
  assert.deepEqual(L.stepMessage(m, T0 + 10000 + L.VANISH_MS), { changed: false, remove: true });
});

test('capsule: locked until unlockAt, then unlocked exactly once', () => {
  const m = msg({ mode: 'capsule', option: 20 });
  assert.equal(L.stepMessage(m, T0 + 19999).changed, false);
  assert.equal(m.unlocked, false);
  assert.equal(L.stepMessage(m, T0 + 20000).changed, true);
  assert.equal(m.unlocked, true);
  assert.equal(L.stepMessage(m, T0 + 30000).changed, false);
});

test('secret: hidden until opened, burns after the view window', () => {
  const m = msg({ from: 'them', mode: 'secret', text: 'سر' });
  assert.equal(L.stepMessage(m, T0 + 999999).changed, false, 'their secret never self-burns unopened');
  assert.equal(m.text, 'سر');

  assert.equal(L.openSecret(m, T0), true);
  assert.equal(m.open, true);
  assert.equal(L.openSecret(m, T0 + 1), false, 'cannot re-open while open');

  assert.equal(L.stepMessage(m, T0 + L.SECRET_VIEW_MS - 1).changed, false);
  assert.equal(m.text, 'سر');
  assert.equal(L.stepMessage(m, T0 + L.SECRET_VIEW_MS).changed, true);
  assert.equal(m.burned, true);
  assert.equal(m.text, '', 'text is wiped, not just hidden');
  assert.equal(L.openSecret(m, T0 + 99999), false, 'cannot open a burned message');
});

test('secret: sender copy auto-burns', () => {
  const m = msg({ from: 'me', mode: 'secret', text: 'سر' });
  assert.equal(L.stepMessage(m, T0 + L.SECRET_AUTO_BURN_MS - 1).changed, false);
  assert.equal(L.stepMessage(m, T0 + L.SECRET_AUTO_BURN_MS).changed, true);
  assert.equal(m.burned, true);
  assert.equal(m.text, '');
});

test('openSecret ignores non-secret messages and null', () => {
  assert.equal(L.openSecret(msg({}), T0), false);
  assert.equal(L.openSecret(null, T0), false);
});

test('stepContact removes faded messages and reports unlocked capsules from them', () => {
  const c = {
    msgs: [
      msg({ id: 'a', mode: 'fade', option: 1 }),
      msg({ id: 'b', from: 'them', mode: 'capsule', option: 5 }),
      msg({ id: 'c', from: 'me', mode: 'capsule', option: 5 }),
      msg({ id: 'd' }),
    ],
  };
  let r = L.stepContact(c, T0 + 1000);
  assert.equal(r.changed, true);
  assert.equal(c.msgs.length, 4, 'still present while vanishing');
  r = L.stepContact(c, T0 + 1000 + L.VANISH_MS);
  assert.equal(c.msgs.length, 3);
  r = L.stepContact(c, T0 + 5000);
  assert.equal(r.newlyUnlocked, 1, 'only their capsule counts');
  assert.ok(c.msgs.every((m) => m.mode !== 'capsule' || m.unlocked));
});

test('previewOf never leaks protected content', () => {
  assert.equal(L.previewOf(msg({ text: 'مرحبا' })), 'أنت: مرحبا');
  assert.equal(L.previewOf(msg({ from: 'them', text: 'مرحبا' })), 'مرحبا');
  assert.equal(L.previewOf(msg({ from: 'them', mode: 'secret', text: 'سر' })), 'رسالة سرية');
  assert.equal(L.previewOf(msg({ from: 'them', mode: 'capsule', option: 5, text: 'سر' })), 'كبسولة زمنية');
  assert.equal(L.previewOf(msg({ from: 'them', mode: 'fade', option: 5, text: 'سر' })), 'رسالة تتلاشى');
  const burned = msg({ from: 'them', mode: 'secret', text: 'سر' });
  L.burn(burned);
  assert.equal(L.previewOf(burned), 'احترقت الرسالة');
  assert.equal(L.previewOf(null), '');
});

test('lastVisible skips vanished messages', () => {
  const gone = msg({ mode: 'fade', option: 1 });
  gone.gone = true;
  const c = { msgs: [msg({ id: 'a', text: 'one' }), gone] };
  assert.equal(L.lastVisible(c).id, 'a');
  assert.equal(L.lastVisible({ msgs: [] }), null);
});

test('replyDelay waits for capsules to open', () => {
  const cap = msg({ mode: 'capsule', option: 60 });
  assert.equal(L.replyDelay(cap, T0), 62500);
  assert.equal(L.replyDelay(cap, T0 + 70000), 2500);
  assert.equal(L.replyDelay(msg({}), T0), 1800);
});

test('nextReply uses special replies per mode and cycles the list otherwise', () => {
  const c = { replies: ['a', 'b'], ri: 0 };
  assert.equal(L.nextReply(c, msg({})), 'a');
  assert.equal(L.nextReply(c, msg({})), 'b');
  assert.equal(L.nextReply(c, msg({})), 'a');
  assert.match(L.nextReply(c, msg({ mode: 'secret' })), /احترقت/);
  assert.match(L.nextReply(c, msg({ mode: 'capsule', option: 1 })), /الكبسولة/);
  assert.match(L.nextReply(c, msg({ mode: 'fade', option: 1 })), /تختفي/);
  assert.equal(L.nextReply({}, msg({})).length > 0, true);
});

test('newContact and canAddHandle', () => {
  const c = L.newContact('sara.k', 'calm');
  assert.equal(c.id, 'u_sara.k');
  assert.equal(c.name, 'sara.k');
  assert.equal(c.mood, 'calm');
  const list = [c];
  assert.deepEqual(L.canAddHandle(list, '@new.friend', 'nour'), { ok: true, handle: 'new.friend' });
  assert.deepEqual(L.canAddHandle(list, '@SARA.K', 'nour'), { ok: false, reason: 'exists' });
  assert.deepEqual(L.canAddHandle(list, 'nour', 'nour'), { ok: false, reason: 'self' });
  assert.deepEqual(L.canAddHandle(list, '@@', 'nour'), { ok: false, reason: 'invalid' });
});

test('searchContacts matches name and handle', () => {
  const list = [
    { name: 'ليلى الأمين', handle: 'layla.moon' },
    { name: 'سامر خالد', handle: 'samer_k' },
  ];
  assert.equal(L.searchContacts(list, '').length, 2);
  assert.equal(L.searchContacts(list, 'LAYLA').length, 1);
  assert.equal(L.searchContacts(list, '@samer').length, 1);
  assert.equal(L.searchContacts(list, 'سامر')[0].handle, 'samer_k');
  assert.equal(L.searchContacts(list, 'zzz').length, 0);
});

test('qrCells is deterministic, in bounds, and leaves the finder corners clear', () => {
  const a = L.qrCells('nour.violetABC-DEF-GHJ');
  const b = L.qrCells('nour.violetABC-DEF-GHJ');
  const c = L.qrCells('someone.else');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.cells, c.cells);
  assert.equal(a.size, 21);
  assert.ok(a.cells.length > 100 && a.cells.length < 300);
  const inFinder = (r, col) => (r < 8 && col < 8) || (r < 8 && col >= 13) || (r >= 13 && col < 8);
  for (const [r, col] of a.cells) {
    assert.ok(r >= 0 && r < 21 && col >= 0 && col < 21);
    assert.equal(inFinder(r, col), false);
  }
  assert.equal(a.finders.length, 3);
});

test('hash32 is stable', () => {
  assert.equal(L.hash32('a'), 3826002220);
  assert.equal(L.hash32('a'), L.hash32('a'));
  assert.notEqual(L.hash32('a'), L.hash32('b'));
});
