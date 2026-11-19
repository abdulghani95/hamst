'use strict';
/* Checks that the repo is shippable: files exist, JSON parses, every
   referenced asset is present, all scripts parse, and there is no phone input. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

test('all shipped files exist', () => {
  for (const f of [
    'index.html', 'sw.js', 'manifest.webmanifest', 'css/style.css', 'js/logic.js', 'js/app.js',
    'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
    'README.md', 'LICENSE', '.gitignore', '.github/workflows/ci.yml', '.github/workflows/pages.yml',
  ]) assert.ok(exists(f), 'missing ' + f);
});

test('JavaScript files parse', () => {
  for (const f of ['sw.js', 'js/logic.js', 'js/app.js', 'scripts/serve.js']) {
    assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), f);
  }
});

test('manifest is valid and its icons exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.dir, 'rtl');
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(exists(path.join('icons', path.basename(i.src))), i.src);
});

test('index.html references only files that exist', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((x) => x[1]).filter((u) => !/^(https?:|data:)/.test(u));
  assert.ok(refs.length >= 5);
  for (const r of refs) assert.ok(exists(r), 'index.html references missing file: ' + r);
});

test('service worker precaches only files that exist', () => {
  const sw = read('sw.js');
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  const files = [...list.matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((f) => f !== './');
  assert.ok(files.length >= 8);
  for (const f of files) assert.ok(exists(f), 'sw precaches missing file: ' + f);
});

test('identity is username-only: no phone or email field anywhere', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /type="tel"/i);
  assert.doesNotMatch(html, /type="email"/i);
  assert.doesNotMatch(html, /autocomplete="(tel|email)/i);
});

test('every id referenced by app.js exists in index.html', () => {
  const html = read('index.html');
  const js = read('js/app.js');
  const ids = new Set([...js.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 15);
  for (const id of ids) {
    const inHtml = html.includes('id="' + id + '"');
    const inJs = js.includes('id="' + id + '"') || js.includes("id=\"" + id + "\"");
    assert.ok(inHtml || inJs, 'no element with id #' + id);
  }
});

test('every icon used in app.js is defined in the sprite', () => {
  const html = read('index.html');
  const js = read('js/app.js');
  const used = new Set([...js.matchAll(/ic\('([a-z-]+)'/g)].map((m) => m[1]));
  for (const d of js.matchAll(/\['(?:plain|fade|capsule|secret)', '([a-z]+)'/g)) used.add(d[1]);
  for (const name of used) assert.ok(html.includes('id="i-' + name + '"'), 'missing icon i-' + name);
});

test('dark theme tokens are defined in both blocks and match', () => {
  const css = read('css/style.css');
  const tokens = (block) => [...block.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]).sort();
  const media = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\) \{([\s\S]*?)\n  \}/)[1];
  const attr = css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)[1];
  assert.deepEqual(tokens(media), tokens(attr));
  const light = css.match(/:root \{([\s\S]*?)\n\}/)[1];
  for (const t of tokens(media)) assert.ok(tokens(light).includes(t), 'token --' + t + ' missing from light :root');
});
