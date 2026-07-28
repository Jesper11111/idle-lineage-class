import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium, devices } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const systemChrome = platform() === 'win32'
  ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
     'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)
  : null;
const browser = await chromium.launch(systemChrome ? { executablePath: systemChrome } : {});
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));

try {
  const port = server.address().port;
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('m-afk-nav-train'));

  await page.evaluate(() => {
    currentSlot = 16;
    try { _lzRemoveStored('lineage_idle_save_16'); } catch {}
    selectClass('m_knight');
    const stats = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    let guard = 100;
    while (guard-- > 0) {
      const before = stats.reduce((sum, key) => sum + Number(curCreate[key] || 0), 0);
      for (const key of stats) adjStat(key, 1);
      const after = stats.reduce((sum, key) => sum + Number(curCreate[key] || 0), 0);
      if (after >= Number(createBase[curCreate.cls].pts || 0)) break;
      if (after === before) throw new Error('創角配點無法完成');
    }
    startGame();
    const original = window.__afkMobileMemoryLifecycle;
    window.__trainingLifecycleCalls = [];
    window.__afkMobileMemoryLifecycle = function (reason) {
      window.__trainingLifecycleCalls.push(reason);
      return original?.apply(this, arguments);
    };
    document.getElementById('m-afk-nav-train').click();
  });

  const modal = page.locator('#m-train-modal');
  await modal.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#m-train-nomp').count(), 1, '缺少 MP 不消耗選項');
  assert.equal(await page.locator('#m-train-go').count(), 1, '缺少進入木人場按鈕');

  const modalGeometry = await page.evaluate(() => {
    document.body.classList.add('mlog-open');
    const button = document.getElementById('m-train-go');
    const rect = button.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      z: Number(getComputedStyle(document.getElementById('m-train-modal')).zIndex),
      clickable: top === button || button.contains(top),
    };
  });
  assert.ok(modalGeometry.z > 9600, '選怪視窗必須高於手機日誌與底部導覽');
  assert.equal(modalGeometry.clickable, true, '手機選怪視窗的進入按鈕被覆蓋');

  await page.locator('#m-train-nomp').check();
  await page.evaluate(() => {
    document.body.classList.remove('mlog-open', 'mview-left', 'mview-right');
    document.body.classList.add('mview-center');
    document.getElementById('m-train-go').click();
  });
  await page.waitForFunction(() => mapState.current === 'afk_dummy');
  await page.waitForFunction(() => document.getElementById('m-train-hud')?.style.display !== 'none');

  const entered = await page.evaluate(() => ({
    map: mapState.current,
    lifecycle: window.__trainingLifecycleCalls.slice(),
    savedNoMp: localStorage.getItem('afk_training_nomp_16'),
    hasSourceTab: !!document.getElementById('m-train-tab-src'),
    hasTargetTab: !!document.getElementById('m-train-tab-mob'),
  }));
  assert.equal(entered.map, 'afk_dummy');
  assert.ok(entered.lifecycle.includes('map-change'), '進木人場前未釋放上一張圖的手機圖片資源');
  assert.equal(entered.savedNoMp, '1', 'MP 選項未依角色保存');
  assert.equal(entered.hasSourceTab, true, '缺少來源 DPS 分頁');
  assert.equal(entered.hasTargetTab, true, '缺少目標 DPS 分頁');

  await page.evaluate(() => { player.mp = 0; });
  await page.waitForFunction(() => player.mmp === 0 || player.mp === player.mmp);

  const visibility = await page.evaluate(async () => {
    const hud = document.getElementById('m-train-hud');
    const visible = () => getComputedStyle(hud).display !== 'none';
    const out = { center: visible() };
    document.body.classList.remove('mview-center');
    document.body.classList.add('mview-right');
    await new Promise((resolve) => setTimeout(resolve, 0));
    out.right = visible();
    document.body.classList.remove('mview-right');
    document.body.classList.add('mview-center', 'mlog-open');
    await new Promise((resolve) => setTimeout(resolve, 0));
    out.log = visible();
    document.body.classList.remove('mlog-open');
    await new Promise((resolve) => setTimeout(resolve, 0));
    out.centerAgain = visible();
    return out;
  });
  assert.deepEqual(visibility, { center: true, right: false, log: false, centerAgain: true },
    '木人場 HUD 的手機視圖／日誌避讓規則錯誤');

  await page.locator('#m-train-tab-mob').click();
  assert.ok((await page.locator('#m-train-list').textContent()).length > 0, '目標 DPS 分頁沒有內容');
  await page.locator('#m-train-tab-src').click();
  await page.locator('#m-train-exit').click();
  await page.waitForFunction(() => mapState.current !== 'afk_dummy');
  assert.equal(pageErrors.length, 0, `頁面例外：${pageErrors.join('\n')}`);

  console.log('PASS PP training backport: lifecycle / source-target HUD / MP option / mobile overlays');
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
