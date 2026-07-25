/* ============================================================================
 * test-powersave-inventory.mjs — 省電外掛的背包增量更新契約
 *
 * 驗證：
 *   1. 戰鬥中的純數量變動只更新角標，不完整重建。
 *   2. 新增/刪除等結構變動最多延遲 1 秒後完整重建。
 *   3. 隱藏欄位不重建，切回背包時立即同步。
 *   4. tick 外的玩家操作維持立即重建。
 * ========================================================================== */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = await readFile(join(ROOT, 'afk-powersave.js'));
const fixture = `<!doctype html>
<html lang="zh-Hant">
<body>
  <button id="mobile-backpack" class="m-nav-btn" data-view="right">背包</button>
  <div id="m-nav"></div>
  <section id="tab-stats" class="hidden"></section>
  <section id="tab-items"></section>
  <section id="tab-weapons" class="hidden"></section>
  <section id="tab-armors" class="hidden"></section>
  <section id="tab-equip" class="hidden"></section>
  <section id="tab-skill" class="hidden"></section>
  <script>
    document.getElementById('m-nav').appendChild(document.getElementById('mobile-backpack'));
    var state = { inTick: false, ff: false };
    var DB = { items: {
      arrow: { type: 'misc' }, meat: { type: 'misc' }, scroll: { type: 'misc' },
      gem: { type: 'misc' }, blade: { type: 'wpn' }
    } };
    var player = {
      cls: 'elf', lv: 85, elfEle: 'wind', mastery: '',
      skills: [], grantedSkills: [],
      d: { str: 12, dex: 24, con: 12, int: 12, wis: 12, weightPct: 10, loadTier: 0, magicDmg: 3, mr: 20 },
      inv: [{ uid: 'a', id: 'arrow', cnt: 2, en: 0 }],
      eq: {}
    };
    var coreCalls = 0;
    function itemSig(item) { return [item.id, item.en || 0, item.attr || ''].join('|'); }
    function updateUI() {}
    function renderMobs() {}
    function renderTabs() {
      coreCalls++;
      for (const id of ['items', 'weapons', 'armors', 'equip', 'skill']) {
        document.getElementById('tab-' + id).innerHTML = '';
      }
      for (const item of player.inv) {
        const d = DB.items[item.id];
        const tab = d.type === 'wpn' ? 'weapons' : ((d.type === 'arm' || d.type === 'acc') ? 'armors' : 'items');
        const row = document.createElement('div');
        row.className = 'list-item';
        row.dataset.tipUid = item.uid;
        row.dataset.tipSrc = 'inv';
        const box = document.createElement('div');
        box.className = 'classic-icon-box';
        if (!(Number(item.en) > 0) && (item.cnt || 1) > 1) {
          const badge = document.createElement('span');
          badge.className = 'classic-icon-corner-value is-count';
          badge.textContent = (item.cnt || 1).toLocaleString();
          box.appendChild(badge);
        }
        row.appendChild(box);
        document.getElementById('tab-' + tab).appendChild(row);
      }
    }
    function switchTab(name) {
      for (const id of ['stats', 'items', 'weapons', 'armors', 'equip', 'skill']) {
        document.getElementById('tab-' + id).classList.toggle('hidden', id !== name);
      }
    }
    document.getElementById('mobile-backpack').addEventListener('click', function () {
      document.body.classList.remove('mview-left', 'mview-mid');
      document.body.classList.add('mview-right');
    });
  </script>
  <script src="/afk-powersave.js"></script>
  <script>window.renderTabs(true);</script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.url === '/afk-powersave.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(plugin);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();

const systemChrome = platform() === 'win32'
  ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
     'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)
  : null;
const browser = await chromium.launch(systemChrome ? { executablePath: systemChrome } : {});

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });

  const hook = await page.evaluate(() => window.__afkPsInventory);
  assert.equal(hook?.countPatchMs, 250, '增量數量更新 hook 未載入');
  assert.equal(hook?.fullRebuildMs, 1000, '完整重建節流 hook 未載入');

  await page.evaluate(() => {
    coreCalls = 0;
    window.testEpochBeforeCount = window.__afkPsInventory.renderEpoch;
    state.inTick = true;
    player.inv[0].cnt = 9;
    window.renderTabs();
  });
  await page.waitForTimeout(350);
  let result = await page.evaluate(() => ({
    coreCalls,
    count: document.querySelector('#tab-items [data-tip-uid="a"] .is-count')?.textContent
  }));
  assert.equal(result.coreCalls, 0, '純數量變動不應完整重建背包');
  assert.equal(result.count, '9', '純數量變動應原地更新角標');
  assert.equal(
    await page.evaluate(() => window.__afkPsInventory.renderEpoch),
    await page.evaluate(() => window.testEpochBeforeCount),
    '純數量更新不應標記為核心 DOM 重建'
  );

  await page.evaluate(() => {
    player.inv.push({ uid: 'b', id: 'meat', cnt: 3, en: 0 });
    window.renderTabs();
  });
  await page.waitForTimeout(1100);
  result = await page.evaluate(() => ({
    coreCalls,
    hasNewRow: !!document.querySelector('#tab-items [data-tip-uid="b"]')
  }));
  assert.equal(result.coreCalls, 1, '結構變動應合併成一次完整重建');
  assert.equal(result.hasNewRow, true, '完整重建後應顯示新增物品');
  assert.equal(
    await page.evaluate(() => window.__afkPsInventory.renderEpoch),
    await page.evaluate(() => window.testEpochBeforeCount + 1),
    '結構變動完整重建後應推進 renderEpoch'
  );

  await page.evaluate(() => {
    state.inTick = false;
    window.switchTab('stats');
    coreCalls = 0;
    state.inTick = true;
    player.inv.push({ uid: 'c', id: 'scroll', cnt: 1, en: 0 });
    window.renderTabs();
  });
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => coreCalls), 0, '隱藏背包不應在背景完整重建');

  await page.evaluate(() => {
    state.inTick = false;
    window.switchTab('items');
  });
  result = await page.evaluate(() => ({
    coreCalls,
    hasDeferredRow: !!document.querySelector('#tab-items [data-tip-uid="c"]')
  }));
  assert.equal(result.coreCalls, 1, '切回背包時應立即補一次完整同步');
  assert.equal(result.hasDeferredRow, true, '切回背包後應顯示延遲內容');

  await page.evaluate(() => {
    coreCalls = 0;
    state.inTick = true;
    player.inv.push({ uid: 'w', id: 'blade', cnt: 1, en: 0 });
    window.renderTabs();
  });
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => coreCalls), 0, '隱藏的武器分頁有新物品時不應重建目前道具分頁');
  await page.evaluate(() => {
    state.inTick = false;
    window.switchTab('weapons');
  });
  result = await page.evaluate(() => ({
    coreCalls,
    hasWeaponRow: !!document.querySelector('#tab-weapons [data-tip-uid="w"]')
  }));
  assert.equal(result.coreCalls, 1, '開啟有結構變動的隱藏分頁時應立即同步');
  assert.equal(result.hasWeaponRow, true, '開啟武器分頁後應顯示延遲內容');

  await page.evaluate(() => {
    window.switchTab('items');
    coreCalls = 0;
    state.inTick = false;
    window.renderTabs();
  });
  assert.equal(await page.evaluate(() => coreCalls), 1, 'tick 外的玩家操作應立即完整重建');

  await page.evaluate(() => {
    coreCalls = 0;
    state.inTick = true;
    window.renderTabs(true);
  });
  assert.equal(await page.evaluate(() => coreCalls), 1, 'force=true 應保留核心的立即同步語意');

  await page.evaluate(() => {
    document.body.className = 'm-mobile mview-mid';
    coreCalls = 0;
    state.inTick = true;
    player.inv.push({ uid: 'd', id: 'gem', cnt: 1, en: 0 });
    window.renderTabs();
  });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => coreCalls), 0, '手機非背包欄時不應重建');
  await page.click('#mobile-backpack');
  await page.waitForTimeout(50);
  result = await page.evaluate(() => ({
    coreCalls,
    hasMobileRow: !!document.querySelector('#tab-items [data-tip-uid="d"]')
  }));
  assert.equal(result.coreCalls, 1, '手機切回背包欄時應立即補同步');
  assert.equal(result.hasMobileRow, true, '手機切回背包欄後應顯示延遲內容');

  console.log('PASS powersave inventory: count patch / 1s rebuild / hidden lazy refresh / immediate user refresh');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
