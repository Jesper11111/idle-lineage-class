/**
 * PWA 圖片快取回歸測試：
 *   1. 新 SW 接管時會整桶刪掉舊 img-v3／過期資產桶，不列舉桶內 entry。
 *   2. 一般圖片與動畫幀進入各自的 manifest 版本桶。
 *   3. 頁面啟動流程不再發送全量圖片／動畫 reconciliation。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve('.');
const PAGES_BASE = '/idle-lineage-class';
const swSource = readFileSync('sw.js', 'utf8');
const pwaSource = readFileSync('afk-pwa.js', 'utf8');
const versionMatch = swSource.match(/const ASSET_CACHE_VERSIONS = (\{[^\n]*\});/);
assert(versionMatch, 'sw.js 缺少 ASSET_CACHE_VERSIONS');
const versions = JSON.parse(versionMatch[1]);

function shard(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) % 8;
}

function group(path) {
  const clean = String(path).replace(/^\/+/, '').replace(/^public\//, '');
  const animated = clean.match(/^assets\/(anim|classanim|morphanim)\/([^/]+)/);
  if (animated) return `${animated[1]}-${shard(animated[1] + '/' + animated[2])}`;
  const regular = clean.match(/^assets\/([^/]+)/);
  return regular ? `static-${regular[1]}` : null;
}

function cacheName(path) {
  const key = group(path);
  assert(key && versions[key], `資產沒有版本桶：${path}`);
  return `asset-${key}-${versions[key]}`;
}

const manifest = JSON.parse(readFileSync('assets-manifest.json', 'utf8'));
const animationManifest = JSON.parse(readFileSync('anim-manifest.json', 'utf8'));
for (const [path] of [...manifest, ...animationManifest]) cacheName(path);
const staticPath = manifest.find(([path]) => path === 'assets/background/background.png')?.[0];
const animationFolder = animationManifest.find(([path]) => path.startsWith('assets/anim/'))?.[0];
const animationFile = animationFolder && readdirSync(resolve(ROOT, animationFolder), { recursive: true })
  .find((path) => String(path).endsWith('.png'));
const animationPath = animationFile && `${animationFolder}/${String(animationFile).replaceAll('\\', '/')}`;
assert(staticPath && animationPath, '測試用靜態圖或動畫幀不存在');

const fixture = '<!doctype html><meta charset="utf-8"><title>PWA cache test</title>';
const server = createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch { res.writeHead(400).end(); return; }
  if (pathname === '/' || pathname === '/test.html' || pathname === `${PAGES_BASE}/test.html`) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fixture);
    return;
  }
  const relative = pathname.replace(new RegExp(`^${PAGES_BASE}/`), '/').replace(/^\/+/, '');
  const file = resolve(ROOT, relative);
  if (file !== ROOT && file.startsWith(ROOT + sep)) {
    try {
      if (statSync(file).isFile()) {
        const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' :
          file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(readFileSync(file));
        return;
      }
    } catch {}
  }
  res.writeHead(404).end();
});

await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}${PAGES_BASE}/test.html`);

  await page.evaluate(async () => {
    const legacy = await caches.open('img-v3');
    await legacy.put('/legacy-entry.png', new Response('legacy'));
    const stale = await caches.open('asset-anim-0-stale');
    await stale.put('/stale-entry.png', new Response('stale'));
  });

  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/idle-lineage-class/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  const responses = await page.evaluate(async ({ staticPath, animationPath }) => {
    const a = await fetch('/idle-lineage-class/' + staticPath);
    const b = await fetch('/idle-lineage-class/' + animationPath);
    return [a.status, b.status];
  }, { staticPath, animationPath });
  assert.deepEqual(responses, [200, 200], '資產請求沒有正常回應');

  const cacheState = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries = {};
    for (const name of names) entries[name] = (await (await caches.open(name)).keys()).length;
    return { names, entries };
  });
  const expectedStatic = cacheName(staticPath);
  const expectedAnimation = cacheName(animationPath);
  assert(!cacheState.names.includes('img-v3'), '舊 img-v3 桶未在 activate 整桶淘汰');
  assert(!cacheState.names.includes('asset-anim-0-stale'), '過期資產分片桶未淘汰');
  assert(cacheState.names.includes(expectedStatic), `一般圖片未進入 ${expectedStatic}`);
  assert(cacheState.names.includes(expectedAnimation), `動畫幀未進入 ${expectedAnimation}`);
  assert.equal(cacheState.entries[expectedStatic], 1, '一般圖片桶 entry 數不符');
  assert.equal(cacheState.entries[expectedAnimation], 1, '動畫桶 entry 數不符');

  const startupBlock = pwaSource.slice(
    pwaSource.indexOf('function watchUpdates'),
    pwaSource.indexOf('watchUpdates();')
  );
  assert(!/\breconcileImages\(\)/.test(startupBlock), '頁面啟動仍呼叫 reconcileImages');
  assert(!/\breconcileAnim\(\)/.test(startupBlock), '頁面啟動仍呼叫 reconcileAnim');
  const compatibilityBlock = swSource.slice(
    swSource.indexOf('async function reconcileImages'),
    swSource.indexOf('// cache-first + 連網補存。')
  );
  assert(!/\bcaches?\.|cache\.keys/.test(compatibilityBlock), '舊頁面相容回覆仍會存取圖片快取');

  console.log(`PASS PWA versioned cache: ${Object.keys(versions).length} groups covered / legacy buckets removed / ${expectedStatic} / ${expectedAnimation}`);
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
