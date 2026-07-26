import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium } from 'playwright';
import { loadTestSave } from './load-testsave.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(req.url.split('?')[0]);
    if (pathname === '/') pathname = '/index.html';
    const file = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const systemChrome = platform() === 'win32'
  ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
     'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)
  : null;
const browser = await chromium.launch(systemChrome ? { executablePath: systemChrome } : {});
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const logs = [];
page.on('console', (msg) => logs.push(msg.text()));

try {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AFK_BOSSRING && window.__afk, null, { timeout: 20000 });
  await loadTestSave(page, { slot: 1 });
  await page.waitForFunction(() => document.getElementById('set-teleport-boss'), null, { timeout: 5000 });

  const prepared = await page.evaluate(() => {
    const bossToggle = document.getElementById('set-teleport-boss');
    bossToggle.checked = true;
    bossToggle.dispatchEvent(new Event('change'));
    const fleeToggle = document.getElementById('set-teleport');
    if (fleeToggle) fleeToggle.checked = true;   // 故意同時開啟，驗證找王優先、不可把王瞬移掉

    if (!hasTeleportRing()) gainItem('acc_116', 1, true, true);
    gainItem('scroll_teleport', 2000, true, true);
    player.gold = Math.max(player.gold || 0, 1_000_000_000);
    player.dead = false;
    player.hp = player.mhp;
    player.mp = player.mmp;
    delete player._offStats;                    // 強制先走 5 分鐘真模擬取樣，再切快速事件段

    const select = document.getElementById('map-select');
    if (!Array.from(select.options).some((option) => option.value === 'zone_08')) {
      const option = document.createElement('option');
      option.value = 'zone_08';
      option.textContent = '古魯丁地監3樓';
      select.appendChild(option);
    }
    select.value = 'zone_08';                   // 低階圖含四名卡士柏一族 BOSS，真實角色可安全完成長離線測試
    changeMap(true);

    const scrollCount = () => player.inv.reduce(
      (sum, item) => sum + ((item && item.id === 'scroll_teleport') ? (item.cnt || 1) : 0),
      0
    );
    window.__bossringIntegrationProbe = {
      before: scrollCount(),
      gained: 0,
      huntUses: 0,
      fleeUses: 0,
      bossKills: 0,
      scrollCount
    };

    const originalUseItem = window.useItem;
    const originalGainItem = window.gainItem;
    const originalKillMob = window.killMob;
    window.__bossringIntegrationRestore = () => {
      window.useItem = originalUseItem;
      window.gainItem = originalGainItem;
      window.killMob = originalKillMob;
    };
    window.useItem = function (uid, silent) {
      const item = player.inv.find((entry) => entry && entry.uid === uid);
      if (item && item.id === 'scroll_teleport') {
        if (silent) window.__bossringIntegrationProbe.fleeUses++;
        else window.__bossringIntegrationProbe.huntUses++;
      }
      return originalUseItem.apply(this, arguments);
    };
    window.gainItem = function (id, cnt) {
      if (id === 'scroll_teleport') window.__bossringIntegrationProbe.gained += (cnt == null ? 1 : cnt);
      return originalGainItem.apply(this, arguments);
    };
    window.killMob = function (idx) {
      const mob = mapState.mobs[idx];
      if (mob && mob.boss && !mob._dead) window.__bossringIntegrationProbe.bossKills++;
      return originalKillMob.apply(this, arguments);
    };

    __afk.forceCatchup(26, false);              // 低擊殺樣本會由 5 分鐘延長到 15 分鐘；再留 11 分鐘驗快速段
    return {
      cls: player.cls,
      lv: player.lv,
      map: mapState.current,
      ring: hasTeleportRing()
    };
  });

  await page.waitForFunction(() => window.__afk && !window.__afk.isCatchingUp(), null, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const probe = window.__bossringIntegrationProbe;
    const after = probe.scrollCount();
    const out = {
      before: probe.before,
      after,
      gained: probe.gained,
      consumed: probe.before + probe.gained - after,
      huntUses: probe.huntUses,
      fleeUses: probe.fleeUses,
      bossKills: probe.bossKills,
      map: mapState.current,
      alive: !player.dead,
      cacheReady: !!(player._offStats && player._offStats.svcE > 0)
    };
    window.__bossringIntegrationRestore();
    return out;
  });

  console.log('offline bossring integration probe:', JSON.stringify({
    prepared,
    result,
    afkLogs: logs.filter((line) => line.includes('[AFK]')).slice(-30)
  }));
  assert.equal(prepared.ring, true, '真實存檔必須已持有傳送控制戒指');
  assert.equal(prepared.map, 'zone_08');
  assert.ok(result.huntUses > 0, '離線期間必須實際使用非 silent 瞬移卷軸召王');
  assert.equal(result.fleeUses, 0, '同時勾選迴避頭目時也不可把召來的王瞬移掉');
  assert.ok(result.bossKills > 0, '離線期間必須透過真實 killMob 管線擊殺 BOSS');
  assert.equal(result.consumed, result.huntUses, '召王卷軸必須每次恰扣一張，不得被快速耗率重複扣除');
  assert.equal(result.map, 'zone_08', '離線結算後必須回原狩獵圖');
  assert.equal(result.alive, true);
  assert.equal(result.cacheReady, true, '長離線必須完成取樣並產生快速結算快取');
  assert.ok(logs.some((line) => line.includes('快速結算啟動')), '測試必須實際進入事件式快速結算');

  console.log('PASS offline bossring integration:', JSON.stringify({ prepared, result }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
