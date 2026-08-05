/* ============================================================================
 * test-powersave-inventory.mjs — 省電外掛的背包增量更新契約
 *
 * 驗證：
 *   1. 戰鬥中的純數量變動只更新角標，不完整重建。
 *   2. 新增/刪除等結構變動最多延遲 1 秒後完整重建。
 *   3. 隱藏欄位不重建，切回背包時立即同步。
 *   4. 桌機 tick 外操作維持立即重建；手機未開背包時 force／玩家操作也延後。
 *   5. 戰鬥中的自動整理只排序資料，不以 force=true 重建隱藏背包。
 *   6. 手機隱藏背包後切回桌面版，立即重建一次，不能留下空白分頁。
 *   7. 既有雙省電玩家自動取得新 nofx，且實際注入濾鏡覆寫樣式。
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
const basePlugin = await readFile(join(ROOT, 'afk-powersave.js'));
const inventoryPlugin = await readFile(join(ROOT, 'afk-powersave-inventory.js'));
const fixture = `<!doctype html>
<html lang="zh-Hant">
<body>
  <button id="mobile-backpack" class="m-nav-btn" data-view="right">背包</button>
  <div id="m-nav"></div>
  <main id="game-screen">
  <section id="tab-stats" class="hidden"></section>
  <section id="tab-items"></section>
  <section id="tab-weapons" class="hidden"></section>
  <section id="tab-armors" class="hidden"></section>
  <section id="tab-equip" class="hidden"></section>
  <section id="tab-skill" class="hidden"></section>
  </main>
  <script>
    document.getElementById('m-nav').appendChild(document.getElementById('mobile-backpack'));
    var state = { inTick: false, ff: false, running: true, ticks: 0 };
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
      const equipHeader = document.createElement('div');
      equipHeader.className = 'classic-list-toolbar';
      const weight = document.createElement('span');
      weight.textContent = '負重 ' + (player.d.weightPct || 0) + '%';
      equipHeader.appendChild(weight);
      document.getElementById('tab-equip').appendChild(equipHeader);
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
    var _autoSortAt = -99999;
    function invSortCmp(a, b) { return String(a.id).localeCompare(String(b.id)); }
    function resetCatchupGainItemIndex() {}
    function autoSortInventory() {
      if (!player || !Array.isArray(player.inv) || !state.running) return;
      if (player.inventoryAutoSort === false) return;
      if (state.ticks - _autoSortAt < 100) return;
      _autoSortAt = state.ticks;
      player.inv.sort(invSortCmp);
      resetCatchupGainItemIndex();
      renderTabs(true);
    }
    document.getElementById('mobile-backpack').addEventListener('click', function () {
      document.body.classList.remove('mview-left', 'mview-mid');
      document.body.classList.add('mview-right');
    });
  </script>
  <script src="/afk-powersave.js"></script>
  <script src="/afk-powersave-inventory.js"></script>
  <script>window.renderTabs(true);</script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.url === '/afk-powersave.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(basePlugin);
    return;
  }
  if (req.url === '/afk-powersave-inventory.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(inventoryPlugin);
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
  await page.addInitScript(() => {
    localStorage.setItem('afk_ps_noanim', '1');
    localStorage.setItem('afk_ps_lowfps', '1');
  });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });

  assert.deepEqual(await page.evaluate(() => ({
    nofx: localStorage.getItem('afk_ps_nofx'),
    style: !!document.getElementById('afk-ps-nofx'),
  })), { nofx: '1', style: true },
  '既有雙省電設定應自動遷移並立即關閉高成本光暈／濾鏡');

  const hook = await page.evaluate(() => window.__afkPsInventory);
  assert.equal(hook?.countPatchMs, 250, '增量數量更新 hook 未載入');
  assert.equal(hook?.fullRebuildMs, 1000, '完整重建節流 hook 未載入');
  assert.equal(hook?.autoSortDeferred, true, '自動整理延遲重繪 hook 未載入');
  assert.equal(hook?.mobileDormancy, true, '手機離開背包後的 DOM 休眠 hook 未載入');
  assert.equal(
    await page.evaluate(() => window.autoSortInventory?.__afkPsInventory),
    true,
    'autoSortInventory 未由背包省電層包裝'
  );

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
    window.switchTab('equip');
    coreCalls = 0;
    state.inTick = true;
    player.d.weightPct = 83;
    player.d.loadTier = 2;
    window.renderTabs();
  });
  await page.waitForTimeout(350);
  result = await page.evaluate(() => ({
    coreCalls,
    weight: document.querySelector('#tab-equip > .classic-list-toolbar span')?.textContent,
    title: document.querySelector('#tab-equip > .classic-list-toolbar')?.title
  }));
  assert.equal(result.coreCalls, 0, '戰鬥掉落造成負重變化時不得完整重建五個背包分頁');
  assert.equal(result.weight, '負重 83%', '裝備分頁負重必須以增量方式更新');
  assert.match(result.title, /82%/, '負重階段提示必須同步更新');
  await page.evaluate(() => {
    state.inTick = false;
    window.switchTab('items');
  });

  await page.evaluate(() => {
    document.body.className = 'm-mobile mview-mid';
    coreCalls = 0;
    state.inTick = true;
    player.inv.push({ uid: 'd', id: 'gem', cnt: 1, en: 0 });
    window.renderTabs();
  });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => coreCalls), 0, '手機非背包欄時不應重建');
  assert.equal(
    await page.evaluate(() => ['items', 'weapons', 'armors', 'equip', 'skill']
      .reduce((sum, id) => sum + document.getElementById('tab-' + id).childElementCount, 0)),
    0,
    '手機離開背包後必須卸下五個分頁 DOM，而不是只停止重繪'
  );
  await page.evaluate(() => {
    state.inTick = false;
    window.renderTabs(true);
  });
  assert.equal(await page.evaluate(() => coreCalls), 0,
    '手機未顯示背包時，tick 外 force=true 也不得重建看不見的五個分頁');
  await page.click('#mobile-backpack');
  await page.waitForTimeout(50);
  result = await page.evaluate(() => ({
    coreCalls,
    hasMobileRow: !!document.querySelector('#tab-items [data-tip-uid="d"]')
  }));
  assert.equal(result.coreCalls, 1, '手機切回背包欄時應立即補同步');
  assert.equal(result.hasMobileRow, true, '手機切回背包欄後應顯示延遲內容');

  await page.evaluate(() => {
    document.body.className = 'm-mobile mview-mid';
    window.switchTab('items');
    window.renderTabs(true);
    coreCalls = 0;
    state.inTick = true;
    state.ticks += 100;
    player.inv.reverse();
    window.autoSortInventory();
    state.inTick = false;
  });
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => coreCalls), 0, '手機非背包欄的自動整理不應強制重建');
  await page.click('#mobile-backpack');
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => coreCalls), 1, '自動整理後切回背包應立即補同步');

  await page.evaluate(() => {
    coreCalls = 0;
    document.getElementById('game-screen').classList.add('hidden');
  });
  await page.waitForTimeout(50);
  assert.equal(
    await page.evaluate(() => ['items', 'weapons', 'armors', 'equip', 'skill']
      .reduce((sum, id) => sum + document.getElementById('tab-' + id).childElementCount, 0)),
    0,
    '切到角色選擇畫面時，即使 body 仍是 mview-right 也必須卸下背包 DOM'
  );
  await page.evaluate(() => {
    window.renderTabs(true);
  });
  assert.equal(await page.evaluate(() => coreCalls), 0,
    '遊戲畫面隱藏時 force=true 也不得把背包重建到角色選擇畫面背後');
  await page.evaluate(() => {
    document.getElementById('game-screen').classList.remove('hidden');
  });
  await page.waitForTimeout(50);
  result = await page.evaluate(() => ({
    coreCalls,
    hasRoleReturnRow: !!document.querySelector('#tab-items [data-tip-uid="d"]')
  }));
  assert.equal(result.coreCalls, 1, '從角色選擇返回遊戲且背包欄可見時必須只重建一次');
  assert.equal(result.hasRoleReturnRow, true, '返回遊戲後背包不得留白');

  await page.evaluate(() => {
    document.body.className = 'm-mobile mview-mid';
  });
  await page.waitForTimeout(50);
  assert.equal(
    await page.evaluate(() => ['items', 'weapons', 'armors', 'equip', 'skill']
      .reduce((sum, id) => sum + document.getElementById('tab-' + id).childElementCount, 0)),
    0,
    '手機隱藏狀態應先卸下背包 DOM'
  );
  await page.evaluate(() => {
    coreCalls = 0;
    document.body.className = '';
  });
  await page.waitForTimeout(50);
  result = await page.evaluate(() => ({
    coreCalls,
    hasDesktopRow: !!document.querySelector('#tab-items [data-tip-uid="d"]')
  }));
  assert.equal(result.coreCalls, 1, '手機休眠後切回桌面版必須立即重建一次背包');
  assert.equal(result.hasDesktopRow, true, '切回桌面版後不得留下空白背包');

  console.log('PASS powersave inventory: count patch / hidden lazy refresh / auto-sort deferral / mobile-desktop restore');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
