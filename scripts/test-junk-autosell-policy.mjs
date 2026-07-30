import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium } from 'playwright';

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
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const pageErrors = [];
const logs = [];
page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
page.on('console', (message) => logs.push(message.text()));

try {
  const port = server.address().port;
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AFK_JUNK_AUTOSELL_POLICY?.installed && window.__afk, null, { timeout: 20000 });

  const result = await page.evaluate(() => {
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
    state.running = false;
    player.dead = false;
    player.autoSellOn = true;

    const makeScroll = (uid, count = 1) => ({
      id: 'scroll_teleport', uid, cnt: count, en: 0,
      bless: false, anc: false, attr: null, seteff: false,
      lock: false, junk: false,
    });
    const readStoredPlayer = () => {
      const saved = _saveUnwrap(_lzGet('lineage_idle_save_' + currentSlot));
      if (!saved?.payload) throw new Error('測試存檔不存在');
      return JSON.parse(saved.payload).p;
    };
    const baseRules = () => ({
      delaySec: 10,
      protectBless: true, protectAnc: true, protectAttr: true, protectSet: true,
      protectLegend: true, protectOldSeries: true, protectRelic: true,
      protectCraftEquip: false, craftSets: 1,
      equip: { wpn: { on: false, max: 0 }, arm: { on: false, max: 0 }, acc: { on: false, max: 0 } },
      misc: {}, overrides: {},
    });

    const immediate = makeScroll('junk-immediate', 2);
    player.inv = [immediate];
    player.junkPrefs = {};
    player.autoSellRules = baseRules();
    toggleJunk(immediate.uid);
    const storedAfterToggle = readStoredPlayer();
    const storedImmediate = storedAfterToggle.inv.find((item) => item.uid === immediate.uid);
    const immediateSig = itemSig(immediate);
    const persistence = {
      memoryJunk: immediate.junk,
      storedJunk: storedImmediate?.junk,
      storedPref: storedAfterToggle.junkPrefs?.[immediateSig],
      storedSince: storedImmediate?.junkSince,
    };
    immediate.junk = false;
    player.junkPrefs = {};
    loadGame();
    state.running = false;
    const reloaded = player.inv.find((item) => item.uid === 'junk-immediate');
    persistence.reloadedJunk = reloaded?.junk;
    persistence.reloadedPref = player.junkPrefs?.[itemSig(reloaded)];

    const partial = makeScroll('junk-rule-conflict', 10);
    partial.junk = true;
    partial._ruleJunk = true;
    partial._autoSellQty = 5;
    partial.junkSince = Date.now() - 20_000;
    player.inv = [partial];
    player.junkPrefs = { [itemSig(partial)]: true };
    player.autoSellRules = baseRules();
    player.autoSellRules.misc.scroll = { on: true, keep: 5 };
    applyAutoSellRules();
    const conflictAfterRule = {
      junk: partial.junk,
      ruleJunk: partial._ruleJunk,
      autoSellQty: partial._autoSellQty,
    };
    autoSellJunk();
    const conflict = {
      afterRule: conflictAfterRule,
      remaining: player.inv.some((item) => item.uid === partial.uid),
    };

    const quick = makeScroll('junk-quick', 1);
    quick._ruleJunk = true;
    quick._autoSellQty = 1;
    player.inv = [quick];
    player.junkPrefs = {};
    player.autoSellRules = baseRules();
    toggleQuickJunk('item');
    toggleQuickJunkItem('item', quick.uid);
    runQuickJunk('item');
    const quickStored = readStoredPlayer();
    const quickStoredItem = quickStored.inv.find((item) => item.uid === quick.uid);
    const quickResult = {
      junk: quick.junk,
      ruleJunk: quick._ruleJunk,
      since: quick.junkSince,
      pref: player.junkPrefs[itemSig(quick)],
      storedJunk: quickStoredItem?.junk,
      storedPref: quickStored.junkPrefs?.[itemSig(quick)],
    };

    const virtual = makeScroll('junk-offline-clock', 1);
    virtual.junk = true;
    virtual.junkSince = null; // 舊存檔／新掉落可能沒有有效時間戳，不可在第一輪直接誤賣。
    player.inv = [virtual];
    player.junkPrefs = { [itemSig(virtual)]: true };
    player.autoSellRules = baseRules();
    const originalIsCatchingUp = window.__afk.isCatchingUp;
    window.__afk.isCatchingUp = () => true;
    const beforeTick = state.ticks;
    autoSellJunk();
    const presentAtZero = player.inv.some((item) => item.uid === virtual.uid);
    state.ticks = beforeTick + 100;
    autoSellJunk();
    const presentAfterTenSeconds = player.inv.some((item) => item.uid === virtual.uid);
    window.__afk.isCatchingUp = originalIsCatchingUp;

    return {
      policy: window.AFK_JUNK_AUTOSELL_POLICY,
      hooks: {
        toggle: !!window.toggleJunk.__afkJunkAutosellPolicy,
        quick: !!window.runQuickJunk.__afkJunkAutosellPolicy,
        rules: !!window.applyAutoSellRules.__afkJunkAutosellPolicy,
        sell: !!window.autoSellJunk.__afkJunkAutosellPolicy,
      },
      persistence,
      conflict,
      quick: quickResult,
      virtual: { presentAtZero, presentAfterTenSeconds },
    };
  });

  assert.equal(result.policy.version, '1.0.0-local');
  assert.deepEqual(result.hooks, { toggle: true, quick: true, rules: true, sell: true });
  assert.equal(result.persistence.memoryJunk, true, '單件標記後記憶體必須立即是廢品');
  assert.equal(result.persistence.storedJunk, true, '單件標記後必須立即寫入存檔');
  assert.equal(result.persistence.storedPref, true, '廢品完整簽章記憶必須立即寫入存檔');
  assert.ok(Number.isFinite(result.persistence.storedSince), '廢品等待時間起點必須持久化');
  assert.equal(result.persistence.reloadedJunk, true, '重新載入後廢品標記不得消失');
  assert.equal(result.persistence.reloadedPref, true, '重新載入後廢品記憶不得消失');
  assert.deepEqual(
    result.conflict.afterRule,
    { junk: true, ruleJunk: undefined, autoSellQty: undefined },
    '玩家明確標記不得再被保留 N 個規則改回'
  );
  assert.equal(result.conflict.remaining, false, '玩家明確標記的整疊物品必須自動賣出');
  assert.equal(result.quick.junk, true, '快速廢品必須完成標記');
  assert.equal(result.quick.ruleJunk, undefined, '快速廢品必須清除殘留規則旗標');
  assert.ok(Number.isFinite(result.quick.since), '快速廢品必須建立等待時間');
  assert.equal(result.quick.pref, true, '快速廢品必須寫入完整簽章記憶');
  assert.equal(result.quick.storedJunk, true, '快速廢品必須持久化標記');
  assert.equal(result.quick.storedPref, true, '快速廢品必須持久化完整簽章記憶');
  assert.deepEqual(
    result.virtual,
    { presentAtZero: true, presentAfterTenSeconds: false },
    '離線快轉十秒必須推進自動賣出等待時間'
  );
  assert.equal(pageErrors.length, 0, `頁面發生例外：${pageErrors.join('\n')}`);
  assert.ok(logs.some((line) => line.includes('[AFK-junk-autosell-policy] hooks OK')),
    '廢品安全政策未印出 hooks OK');

  console.log('PASS junk autosell policy:', JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
