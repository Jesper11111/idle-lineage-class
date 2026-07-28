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

async function createRole(slot, rawClass, name, gold) {
  await page.evaluate(({ slot, rawClass, name, gold }) => {
    currentSlot = slot;
    try { _lzRemoveStored('lineage_idle_save_' + slot); } catch {}
    selectClass(rawClass);
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
    player.name = name;
    player.gold = gold;
    saveGame();
  }, { slot, rawClass, name, gold });
  await page.waitForSelector('#m-nav [data-view="logout"]');
}

async function openLogout() {
  await page.locator('#m-nav [data-view="logout"]').click();
  await page.locator('#m-logout-modal.open').waitFor({ state: 'visible' });
}

async function switchTo(slot) {
  await openLogout();
  await page.locator(`.m-logout-slot-go[data-slot="${slot}"]`).click();
  await page.waitForFunction((target) =>
    currentSlot === target && player?.cls &&
    !document.getElementById('game-screen').classList.contains('hidden') &&
    !document.getElementById('m-logout-overlay'), slot);
}

try {
  const port = server.address().port;
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof startGame === 'function' && typeof returnToCharacterSelect === 'function');

  await createRole(15, 'm_knight', '十五號騎士', 151515);
  await openLogout();
  const loneRoster = await page.evaluate(() => ({
    title: getComputedStyle(document.getElementById('m-logout-roster-t')).display,
    slots: getComputedStyle(document.getElementById('m-logout-slots')).display,
    rows: document.querySelectorAll('.m-logout-slot').length,
  }));
  assert.deepEqual(loneRoster, { title: 'none', slots: 'none', rows: 0 },
    '只有一隻角色時，切換角色區應整段收起');
  await page.locator('#m-logout-cancel').click();

  await page.evaluate(() => {
    if (!returnToCharacterSelect()) throw new Error('無法返回選角');
  });
  await createRole(16, 'm_mage', '十六號法師', 161616);

  await page.evaluate(() => {
    window.__roleSwitchBusyOriginal = window.__afk?.isCatchingUp;
    if (window.__afk) window.__afk.isCatchingUp = () => true;
  });
  await openLogout();
  const blocked = await page.evaluate(() => ({
    title: document.getElementById('m-logout-roster-t').textContent,
    buttons: document.querySelectorAll('.m-logout-slot-go').length,
    rows: document.querySelectorAll('.m-logout-slot').length,
  }));
  assert.match(blocked.title, /離線結算中/, '離線結算中未顯示禁止換角原因');
  assert.equal(blocked.buttons, 0, '離線結算中仍出現換角按鈕');
  assert.equal(blocked.rows, 2, '登出清單未列出兩個已建立的高編號角色');
  await page.locator('#m-logout-cancel').click();
  await page.evaluate(() => {
    if (window.__afk) window.__afk.isCatchingUp = window.__roleSwitchBusyOriginal;
  });

  await switchTo(15);
  let state = await page.evaluate(() => ({
    slot: currentSlot, name: player.name, gold: player.gold,
    overlay: !!document.getElementById('m-logout-overlay'),
  }));
  assert.deepEqual(state, { slot: 15, name: '十五號騎士', gold: 151515, overlay: false },
    '第一次直接換角載入錯誤或遮罩未清除');

  await switchTo(16);
  await switchTo(15);
  await switchTo(16);
  state = await page.evaluate(() => {
    const saved = (slot) => {
      const unwrapped = _saveUnwrap(_lzGet('lineage_idle_save_' + slot));
      return JSON.parse(unwrapped.payload).p;
    };
    const role15 = saved(15);
    const role16 = saved(16);
    return {
      current: { slot: currentSlot, name: player.name, gold: player.gold },
      role15: { name: role15.name, gold: role15.gold },
      role16: { name: role16.name, gold: role16.gold },
      running: state.running,
      overlay: !!document.getElementById('m-logout-overlay'),
    };
  });
  assert.deepEqual(state, {
    current: { slot: 16, name: '十六號法師', gold: 161616 },
    role15: { name: '十五號騎士', gold: 151515 },
    role16: { name: '十六號法師', gold: 161616 },
    running: true,
    overlay: false,
  }, '重複直接換角後角色資料遭覆蓋或遊戲計時器未恢復');
  assert.equal(pageErrors.length, 0, `頁面例外：${pageErrors.join('\n')}`);

  console.log('PASS PP role switch: occupied slots / >8 slots / offline guard / repeat switch / no overwrite');
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
