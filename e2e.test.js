'use strict';
/* End-to-end tests in a real browser. Time is faked with Playwright's clock so
   10-second, 20-second and 40-second features run instantly and deterministically.
   Run:  npm run test:e2e        (CHROME_PATH=/path/to/chrome to use an installed Chrome) */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { start } = require('../scripts/serve.js');

const START = new Date('2026-11-19T20:00:00');
const SHOTS = process.env.SHOTS_DIR;
let server, browser, base;

before(async () => {
  server = await start(0);
  base = 'http://localhost:' + server.address().port + '/';
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
});
after(async () => {
  await browser.close();
  server.close();
});

/* ───────── helpers ───────── */
async function open(opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
    colorScheme: opts.colorScheme || 'light',
    locale: 'ar',
    serviceWorkers: opts.sw ? 'allow' : 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('console: ' + m.text());
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); // keep tests offline-safe
  if (!opts.sw) await page.clock.install({ time: START });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  return { ctx, page, problems };
}
async function withApp(opts, fn) {
  const app = await open(opts);
  try {
    await fn(app.page, app);
    assert.deepEqual(app.problems, [], 'no console or page errors');
  } finally {
    await app.ctx.close();
  }
}
async function signup(page, name = 'نور', handle = 'nour.violet') {
  await page.fill('#nameInput', name);
  await page.fill('#handleInput', handle);
  await page.click('#authSubmit');
  await page.waitForSelector('#main', { state: 'visible' });
}
const MOBILE = { width: 390, height: 844 };
const text = (page, sel) => page.locator(sel).first().innerText();
const count = (page, sel) => page.locator(sel).count();
const advance = (page, ms) => page.clock.runFor(ms);

function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/* ───────── sign-up ───────── */
test('sign-up rejects an invalid username and keeps the user on the form', async () => {
  await withApp({}, async (page) => {
    await page.fill('#handleInput', 'a!');
    await page.click('#authSubmit');
    assert.equal(await page.isVisible('#authErr'), true);
    assert.match(await text(page, '#authErr'), /3 إلى 20/);
    assert.equal(await page.isVisible('#main'), false);
    await page.fill('#handleInput', 'nour.violet');
    await page.fill('#nameInput', 'ن');
    await page.click('#authSubmit');
    assert.match(await text(page, '#authErr'), /حرفين/);
    assert.equal(await page.isVisible('#main'), false);
  });
});

test('sign-up needs only a username: opens the app, no phone field, identity stored', async () => {
  await withApp({}, async (page) => {
    assert.equal(await count(page, 'input[type=tel], input[type=email]'), 0);
    await signup(page);
    assert.equal(await page.isVisible('#auth'), false);
    assert.equal(await count(page, '#rows [data-open]'), 4);
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('hamsa.v1')));
    assert.equal(stored.handle, 'nour.violet');
    assert.equal(stored.name, 'نور');
    assert.match(stored.code, /^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    assert.equal(stored.phone, undefined);
  });
});

test('@ prefix and capitals are normalised in the username', async () => {
  await withApp({}, async (page) => {
    await signup(page, 'سلمى', '@Salma.Dev');
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('hamsa.v1')));
    assert.equal(stored.handle, 'salma.dev');
  });
});

/* ───────── messaging ───────── */
test('plain message: appears, shows typing, gets a reply, turns to read ticks', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    assert.equal(await count(page, '#msgs .msg.me'), 1);
    await page.fill('#msg', 'مرحبا ليلى');
    await page.press('#msg', 'Enter');
    assert.equal(await count(page, '#msgs .msg.me'), 2);
    assert.equal(await page.inputValue('#msg'), '');
    assert.equal(await count(page, '#msgs .ticks'), 2);

    await advance(page, 400);
    assert.equal(await page.isVisible('#msgs .typing'), true);
    assert.match(await text(page, '#chStatus'), /يكتب/);

    await advance(page, 2000);
    assert.equal(await page.isVisible('#msgs .typing'), false);
    assert.match(await page.locator('#msgs .msg.them p').last().innerText(), /الكبسولة الزمنية/);
    assert.equal(await page.locator('#msgs .msg.me').last().locator('.ticks .i').count(), 2, 'read receipt');
  });
});

test('empty and whitespace-only messages are not sent', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    const before = await count(page, '#msgs .msg');
    await page.fill('#msg', '   ');
    await page.press('#msg', 'Enter');
    await page.click('#sendBtn');
    assert.equal(await count(page, '#msgs .msg'), before);
  });
});

test('message text is escaped (no HTML injection)', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    await page.fill('#msg', '<img src=x onerror="window.__pwned=1"><b>bold</b>');
    await page.press('#msg', 'Enter');
    await advance(page, 100);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(await count(page, '#msgs b'), 0);
    assert.match(await page.locator('#msgs .msg.me p').last().innerText(), /<img src=x/);
  });
});

test('disappearing message counts down and vanishes; seeded one vanishes too', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    assert.match(await page.locator('#msgs').innerText(), /اقرأها قبل أن تذهب/);
    await page.click('[data-mode="fade"]');
    await page.click('[data-opt="10"]');
    assert.match(await text(page, '[data-hint]'), /10 ث/);
    await page.fill('#msg', 'سر قصير');
    await page.press('#msg', 'Enter');
    assert.equal(await page.isVisible('#msgs [data-k="fade"]:text("0:10")') || await page.isVisible('#msgs [data-k="fade"]:text("0:09")'), true);

    await advance(page, 9000);
    assert.match(await page.locator('#msgs').innerText(), /سر قصير/);
    // The app ticks every 500ms, so step in small slices until the vanish animation starts.
    let seen = 0;
    for (let i = 0; i < 20 && !seen; i++) {
      await advance(page, 100);
      seen = await count(page, '#msgs .vanish');
    }
    assert.equal(seen, 1, 'vanish animation started within ~2s of the 10s expiry');
    await advance(page, 700);
    assert.doesNotMatch(await page.locator('#msgs').innerText(), /سر قصير/);

    await advance(page, 90000);
    assert.doesNotMatch(await page.locator('#msgs').innerText(), /اقرأها قبل أن تذهب/);
    // Layla's special reply to a disappearing message is the last thing left in her row.
    assert.match(await page.locator('#rows [data-open="layla"]').innerText(), /تختفي رسالتك/);
  });
});

test('time capsule: sent locked, opens after the delay, reply arrives after it opens', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    await page.click('[data-mode="capsule"]');
    await page.click('[data-opt="20"]');
    await page.fill('#msg', 'نراك قريبا يا صديقي');
    await page.press('#msg', 'Enter');

    const cap = page.locator('#msgs .msg.me .cap');
    assert.equal(await cap.count(), 1);
    assert.doesNotMatch(await cap.innerText(), /نراك/, 'locked capsule hides its text');
    assert.match(await cap.innerText(), /0:20|0:19/);

    await advance(page, 19000);
    assert.equal(await cap.count(), 1);
    assert.match(await cap.innerText(), /0:0[1-2]/);
    const width = await page.locator('[data-bar]').first().evaluate((el) => parseFloat(el.style.width));
    assert.ok(width > 85 && width < 100, 'progress bar nearly full: ' + width);

    await advance(page, 1500);
    assert.equal(await cap.count(), 0);
    assert.match(await page.locator('#msgs').innerText(), /نراك قريبا يا صديقي/);
    assert.match(await page.locator('#msgs').innerText(), /فُتحت/);

    await advance(page, 3500);
    assert.match(await page.locator('#msgs .msg.them p').last().innerText(), /الكبسولة للتو/);
  });
});

test("their time capsule unlocks live while the chat is open", async () => {
  await withApp({}, async (page) => {
    await signup(page);
    await page.click('[data-open="samer"]');
    assert.equal(await count(page, '#msgs .cap'), 1);
    assert.doesNotMatch(await page.locator('#msgs').innerText(), /طاولة الجمعة/);
    await advance(page, 41000);
    assert.equal(await count(page, '#msgs .cap'), 0);
    assert.match(await page.locator('#msgs').innerText(), /طاولة الجمعة عند الغروب/);
  });
});

test("their time capsule in another chat raises the unread badge and shows a toast", async () => {
  await withApp({}, async (page) => {
    await signup(page);
    assert.equal((await text(page, '[data-open="samer"] .badge')).trim(), '2');
    await advance(page, 41000);
    assert.equal((await text(page, '[data-open="samer"] .badge')).trim(), '3');
    assert.equal(await page.isVisible('#toast'), true);
    assert.match(await text(page, '#toast'), /سامر/);
    assert.match(await text(page, '[data-open="samer"]'), /كبسولة مفتوحة/);
  });
});

test('secret message: blurred, hidden from the list, readable once, then burned and wiped', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    assert.match(await text(page, '[data-open="reem"]'), /رسالة سرية/);
    assert.doesNotMatch(await text(page, '[data-open="reem"]'), /4471/);
    await page.click('[data-open="reem"]');

    assert.equal(await page.locator('.sec .blur').evaluate((el) => getComputedStyle(el).filter), 'blur(7px)');
    await page.click('.sec');
    assert.match(await page.locator('#msgs .msg.them p').last().innerText(), /4471/);
    assert.equal(await count(page, '.sec'), 0);

    await advance(page, 5000);
    assert.match(await page.locator('#msgs').innerText(), /4471/);
    await advance(page, 1500);
    assert.equal(await page.isVisible('#msgs .burned'), true);
    assert.doesNotMatch(await page.content(), /4471/, 'secret text is gone from the DOM');
    assert.match(await text(page, '[data-open="reem"]'), /احترقت/);
  });
});

test('my own secret message burns by itself', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    await page.click('[data-mode="secret"]');
    await page.fill('#msg', 'كلمة سرية جدا');
    await page.press('#msg', 'Enter');
    assert.equal(await count(page, '#msgs .msg.me .sec'), 1);
    await advance(page, 9600);
    assert.equal(await count(page, '#msgs .msg.me .burned'), 1);
    assert.doesNotMatch(await page.content(), /كلمة سرية جدا/);
    assert.match(await page.locator('#msgs .msg.them p').last().innerText(), /احترقت/);
  });
});

/* ───────── contacts ───────── */
test('add a contact by @username (valid, duplicate, invalid)', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    await page.fill('#q', '@sara.k');
    assert.equal(await count(page, '[data-add="sara.k"]'), 1);
    await page.press('#q', 'Enter');
    assert.equal(await text(page, '#chName'), 'sara.k');
    assert.match(await page.locator('#msgs').innerText(), /بدأتما المحادثة عبر اسم المستخدم @sara\.k/);
    assert.equal(await count(page, '#rows [data-open]'), 5);
    assert.equal(await page.inputValue('#q'), '');

    await page.fill('#q', '@layla.moon');
    assert.equal(await count(page, '[data-add]'), 0, 'existing handle is not offered again');
    await page.fill('#q', '@a');
    assert.equal(await count(page, '[data-add]'), 0, 'invalid handle is not offered');
    await page.fill('#q', '@nour.violet');
    assert.equal(await count(page, '[data-add]'), 0, 'cannot add yourself');
  });
});

test('search filters the conversation list by name and handle', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    await page.fill('#q', 'سامر');
    assert.equal(await count(page, '#rows [data-open]'), 1);
    await page.fill('#q', 'reem');
    assert.equal(await count(page, '#rows [data-open]'), 1);
    await page.fill('#q', 'zz'); // too short to be a username, so only "no results"
    assert.equal(await count(page, '#rows [data-open]'), 0);
    assert.equal(await page.isVisible('#rows .none'), true);
    await page.fill('#q', 'zzzzzz'); // a valid username with no match offers "add"
    assert.equal(await count(page, '#rows [data-open]'), 0);
    assert.equal(await count(page, '[data-add="zzzzzz"]'), 1);
    await page.fill('#q', '');
    assert.equal(await count(page, '#rows [data-open]'), 4);
  });
});

/* ───────── profile / settings ───────── */
test('profile sheet: identity, recovery code, copy handle, Escape closes', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    await page.click('#meBtn');
    assert.equal(await page.isVisible('#sheet'), true);
    assert.match(await text(page, '#sheetTitle'), /نور/);
    assert.match(await text(page, '#sheet .handle'), /nour\.violet/);
    assert.match(await text(page, '#codeText'), /^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    assert.ok((await count(page, '#sheet .qr rect')) > 100);
    await page.click('#copyHandle');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '@nour.violet');
    assert.match(await text(page, '#toast'), /نُسخ/);
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#sheet'), false);
  });
});

test('ghost mode: banner and status change, persists across reload', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    assert.equal(await page.isVisible('#ghostBanner'), false);
    assert.match(await text(page, '#chStatus'), /متصل الآن/);
    await page.click('#meBtn');
    await page.click('#swGhost');
    assert.equal(await page.getAttribute('#swGhost', 'aria-checked'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#ghostBanner'), true);
    assert.match(await text(page, '#chStatus'), /أنت متخفٍّ/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.isVisible('#main'), true, 'identity survives reload');
    assert.equal(await page.isVisible('#ghostBanner'), true, 'ghost mode survives reload');
  });
});

test('mood aura: changes my ring colour and is saved', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    const ring = () => page.locator('#meBtn .av').evaluate((el) => el.style.getPropertyValue('--mc').trim());
    assert.equal(await ring(), '#c084fc');
    await page.click('#meBtn');
    await page.click('[data-mood="love"]');
    assert.equal(await ring(), '#ec4899');
    assert.equal(await page.getAttribute('[data-mood="love"]', 'aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await ring(), '#ec4899');
  });
});

test('hide previews blurs the last message in the list', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    assert.equal(await page.locator('#rows .pv').first().evaluate((el) => getComputedStyle(el).filter), 'none');
    await page.click('#meBtn');
    await page.click('#swPrev');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#rows .pv').first().evaluate((el) => getComputedStyle(el).filter), 'blur(5px)');
  });
});

test('sign out asks for confirmation, then wipes the identity', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    await page.click('#meBtn');
    await page.click('#logout');
    assert.match(await text(page, '#logout'), /مرة أخرى/);
    assert.equal(await page.isVisible('#main'), true, 'first click does not sign out');
    await page.click('#logout');
    assert.equal(await page.isVisible('#auth'), true);
    assert.equal(await page.isVisible('#main'), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('hamsa.v1')), null);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.isVisible('#auth'), true);
    // pending reply timers from before sign-out must not crash anything
    await advance(page, 5000);
  });
});

/* ───────── layout ───────── */
for (const scheme of ['light', 'dark']) {
  test('phone layout (' + scheme + '): list -> chat -> back, nothing overflows sideways', async () => {
    await withApp({ viewport: MOBILE, colorScheme: scheme }, async (page) => {
      const overflow = () => page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      assert.deepEqual(await overflow(), { doc: 0, body: 0 }, 'auth screen');
      await signup(page);
      assert.equal(await page.getAttribute('#main', 'data-view'), 'list');
      assert.equal(await page.isVisible('.chat'), false);
      assert.deepEqual(await overflow(), { doc: 0, body: 0 }, 'list');

      await page.click('[data-open="layla"]');
      assert.equal(await page.getAttribute('#main', 'data-view'), 'chat');
      assert.equal(await page.isVisible('.list'), false);
      assert.equal(await page.isVisible('#backBtn'), true);
      await page.click('[data-mode="fade"]');
      await page.fill('#msg', 'رسالة طويلة جدا '.repeat(12));
      await page.press('#msg', 'Enter');
      assert.deepEqual(await overflow(), { doc: 0, body: 0 }, 'chat with a long message');
      assert.equal(await page.locator('#msgs').evaluate((el) => el.scrollWidth - el.clientWidth), 0);

      await page.click('#backBtn');
      assert.equal(await page.getAttribute('#main', 'data-view'), 'list');
      assert.equal(await page.isVisible('.chat'), false);

      await page.click('#meBtn'); // the profile button lives on the list screen
      assert.equal(await page.isVisible('#sheet'), true);
      assert.deepEqual(await overflow(), { doc: 0, body: 0 }, 'sheet');
      const box = await page.locator('#sheet').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= MOBILE.width, 'sheet fits the screen width');
      await page.keyboard.press('Escape');
    });
  });
}

test('desktop layout: both panes visible, no back button', async () => {
  await withApp({}, async (page) => {
    await signup(page);
    assert.equal(await page.isVisible('.list'), true);
    assert.equal(await page.isVisible('.chat'), true);
    assert.equal(await page.isVisible('#backBtn'), false);
    assert.equal(await text(page, '#chName'), 'ليلى الأمين');
    assert.equal(await page.getAttribute('[data-open="layla"]', 'aria-current'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  });
});

/* ───────── themes, contrast, accessibility ───────── */
for (const scheme of ['light', 'dark']) {
  test('theme (' + scheme + '): background follows the OS and every text/surface pair passes WCAG AA', async () => {
    await withApp({ colorScheme: scheme }, async (page) => {
      const v = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const g = (n) => cs.getPropertyValue('--' + n).trim();
        return ['bg', 'surface', 'surface-2', 'fg', 'muted', 'accent', 'accent-ink', 'accent-soft', 'me-a', 'me-b', 'me-ink', 'them', 'warm', 'warm-soft', 'danger']
          .reduce((o, n) => ((o[n] = g(n)), o), {});
      });
      const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const want = scheme === 'dark' ? 'rgb(17, 12, 31)' : 'rgb(245, 241, 253)';
      assert.equal(bodyBg, want);

      const pairs = [
        ['fg on bg', v.fg, v.bg, 7], ['fg on surface', v.fg, v.surface, 7], ['fg on them', v.fg, v.them, 7],
        ['muted on surface', v.muted, v.surface, 4.5], ['muted on bg', v.muted, v.bg, 4.5], ['muted on surface-2', v.muted, v['surface-2'], 4.5],
        ['fg on accent-soft', v.fg, v['accent-soft'], 7],
        ['accent-ink on accent', v['accent-ink'], v.accent, 4.5],
        ['me-ink on me-a', v['me-ink'], v['me-a'], 4.5], ['me-ink on me-b', v['me-ink'], v['me-b'], 4.5],
        ['warm on warm-soft', v.warm, v['warm-soft'], 4.5],
        ['danger on surface', v.danger, v.surface, 4.5],
        ['accent on bg (status text)', v.accent, v.bg, 4.5],
      ];
      for (const [name, a, b, min] of pairs) {
        const r = ratio(a, b);
        assert.ok(r >= min, name + ' contrast ' + r.toFixed(2) + ' < ' + min + ' (' + a + ' on ' + b + ')');
      }
    });
  });
}

test('accessibility: language/direction, names on every control, labelled inputs', async () => {
  await withApp({}, async (page) => {
    assert.equal(await page.getAttribute('html', 'lang'), 'ar');
    assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
    const audit = () => page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('button').forEach((b) => {
        const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
        if (!name) bad.push('button#' + b.id + '.' + b.className);
      });
      document.querySelectorAll('input').forEach((i) => {
        const named = i.getAttribute('aria-label') || (i.id && document.querySelector('label[for="' + i.id + '"]'));
        if (!named) bad.push('input#' + i.id);
      });
      return bad;
    });
    assert.deepEqual(await audit(), [], 'auth screen');
    await signup(page);
    await page.click('#meBtn');
    assert.deepEqual(await audit(), [], 'app + sheet');
    assert.equal(await page.getAttribute('#sheet', 'role'), 'dialog');
    assert.equal(await page.getAttribute('#swGhost', 'role'), 'switch');
  });
});

/* ───────── PWA ───────── */
test('PWA: service worker precaches the shell and the app loads offline', async () => {
  const app = await open({ sw: true });
  try {
    const { page, ctx } = app;
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.waitForFunction(async () => {
      const c = await caches.open('hamsa-v1');
      return (await c.keys()).length >= 9;
    }, null, { timeout: 15000 });
    await page.reload({ waitUntil: 'domcontentloaded' }); // now controlled by the worker
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.isVisible('#auth'), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 241, 253)', 'CSS served from cache');
    assert.equal(await page.evaluate(() => typeof window.Logic.validateUsername), 'function', 'JS served from cache');
    await page.fill('#handleInput', 'offline.user');
    await page.click('#authSubmit');
    assert.equal(await page.isVisible('#main'), true, 'sign-up works offline');
    assert.deepEqual(app.problems, []);
  } finally {
    await app.ctx.close();
  }
});

/* ───────── screenshots (only when SHOTS_DIR is set) ───────── */
test('screenshots', { skip: !SHOTS }, async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  for (const scheme of ['light', 'dark']) {
    await withApp({ colorScheme: scheme }, async (page) => {
      await shot(page, scheme + '-1-auth-desktop');
      await signup(page);
      await page.click('[data-mode="fade"]');
      await page.fill('#msg', 'هذه الرسالة ستتلاشى بعد قليل');
      await page.press('#msg', 'Enter');
      await advance(page, 3000);
      await shot(page, scheme + '-2-chat-desktop');
      await page.click('[data-open="samer"]');
      await shot(page, scheme + '-3-capsule-desktop');
      await page.click('[data-open="reem"]');
      await shot(page, scheme + '-4-secret-desktop');
      await page.click('#meBtn');
      await shot(page, scheme + '-5-sheet-desktop');
    });
    await withApp({ colorScheme: scheme, viewport: MOBILE }, async (page) => {
      await shot(page, scheme + '-6-auth-mobile');
      await signup(page);
      await shot(page, scheme + '-7-list-mobile');
      await page.click('[data-open="layla"]');
      await shot(page, scheme + '-8-chat-mobile');
    });
  }
});
