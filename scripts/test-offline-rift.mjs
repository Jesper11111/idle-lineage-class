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
  await page.waitForFunction(
    () => window.__afk && window.__afk.version === '2.3.0-jesper-rift-offline',
    null,
    { timeout: 20000 }
  );
  await loadTestSave(page, { slot: 1 });

  const prepared = await page.evaluate(() => {
    player.riftRewardMs = null;
    gainItem('mat_crack_core', 1, true, true);
    player.dead = false;
    player.hp = player.mhp;
    player.mp = player.mmp;

    window.__riftOfflineProbe = { kills: 0, bossSpawns: 0 };
    const originalKillMob = window.killMob;
    const originalSpawnRiftMob = window.spawnRiftMob;
    window.__riftOfflineRestore = () => {
      window.killMob = originalKillMob;
      window.spawnRiftMob = originalSpawnRiftMob;
    };
    window.killMob = function (idx) {
      const mob = mapState.mobs[idx];
      const result = originalKillMob.apply(this, arguments);
      if (mob && mob._dead) window.__riftOfflineProbe.kills++;
      return result;
    };
    window.spawnRiftMob = function (idx) {
      const result = originalSpawnRiftMob.apply(this, arguments);
      const mob = mapState.mobs[idx];
      if (mob && mob.boss) window.__riftOfflineProbe.bossSpawns++;
      return result;
    };

    enterRift();
    const before = __afk.riftSnapshot();
    if (!before) throw new Error('進入裂痕後沒有建立旅程快照');

    // 模擬關閉六分鐘後重新載入同一角色。loadGame 會走正式 offlinePreLoad/offlineAfterLoad，
    // 不是直接呼叫內部 helper，因此同時驗證快照被載入流程暫時清掉後仍能用 pre 值還原。
    saveGame();
    localStorage.setItem('afk_map_1', 'rift_battle');
    localStorage.setItem('afk_ts_1', String(Date.now() - 360000));
    loadGame();

    return {
      before,
      map: mapState.current,
      rankBefore: before.rankMs,
      battleBefore: before.battleMs
    };
  });

  await page.waitForFunction(
    () => window.__afk && !window.__afk.isCatchingUp(),
    null,
    { timeout: 120000 }
  );

  const result = await page.evaluate(() => {
    const snap = __afk.riftSnapshot();
    const noteHost = document.createElement('div');
    renderRiftEntrance(noteHost);
    const note = noteHost.querySelector('.afk-rift-offline-note');

    const battleDifficultyProbe = (() => {
      const oldBase = state.__afkRiftBattleBaseMs;
      const oldTick = state.__afkRiftBattleBaseTick;
      state.__afkRiftBattleBaseMs = 31 * 60000;
      state.__afkRiftBattleBaseTick = state.ticks;
      const mult = riftDamageMult();
      state.__afkRiftBattleBaseMs = oldBase;
      state.__afkRiftBattleBaseTick = oldTick;
      return mult;
    })();

    const rankBeforeEnd = snap && snap.rankMs;
    const runningBeforeEnd = !!(snap && state.riftRun);
    const storedBeforeEnd = __afk.readRift();
    riftEndRun();
    const rankRow = sherineWorldActive() ? player.riftRankSherine : player.riftRank;
    const out = {
      mapBeforeEnd: mapState.current,
      runningBeforeEnd,
      battleMs: snap && snap.battleMs,
      rankMs: rankBeforeEnd,
      kills: window.__riftOfflineProbe.kills,
      bossSpawns: window.__riftOfflineProbe.bossSpawns,
      stored: storedBeforeEnd,
      difficultyAt31m: battleDifficultyProbe,
      endedRankMs: rankRow && rankRow.last && rankRow.last.ms,
      rewardMs: player.riftRewardMs,
      note: note && note.textContent
    };
    window.__riftOfflineRestore();
    return out;
  });

  console.log('offline rift probe:', JSON.stringify({
    prepared,
    result,
    afkLogs: logs.filter((line) => line.includes('[AFK]')).slice(-20)
  }));

  assert.equal(prepared.map, 'rift_battle', 'loadGame 必須在同一流程內啟動裂痕離線補跑');
  assert.equal(result.mapBeforeEnd, 'rift_battle', '離線結算存活後必須回到時空裂痕');
  assert.equal(result.runningBeforeEnd, true, '離線結算後裂痕旅程必須仍在進行');
  assert.ok(result.battleMs >= prepared.battleBefore + 355000,
    `裂痕戰鬥時間必須推進約六分鐘（before=${prepared.battleBefore}, after=${result.battleMs}）`);
  assert.ok(result.rankMs < prepared.rankBefore + 30000,
    `離線六分鐘不可灌入排名時間（before=${prepared.rankBefore}, after=${result.rankMs}）`);
  assert.ok(result.kills > 0, '離線裂痕必須實際經過 killMob 管線取得戰鬥收益');
  assert.ok(result.bossSpawns > 0, '離線超過五分鐘必須依虛擬戰鬥時間生成強制頭目');
  assert.ok(result.stored && result.stored.battleMs >= result.battleMs - 1000,
    '離線完成後必須重新寫回裂痕旅程快照');
  assert.ok(result.stored && result.stored.bossDueMs > 300000,
    '首隻強制頭目生成後必須把下一次虛擬期限推進五分鐘');
  assert.equal(result.difficultyAt31m, 1.2, '裂痕難度必須按虛擬戰鬥時間推進');
  assert.ok(result.endedRankMs < 30000, `結束裂痕時排名不得包含六分鐘離線時間（${result.endedRankMs}ms）`);
  assert.equal(result.rewardMs, result.endedRankMs, '入口停留獎勵時間必須與排除離線後的排名時間一致');
  assert.match(result.note || '', /離線期間.*戰鬥.*不計入裂痕排名/u, '裂痕入口必須明確說明離線規則');

  console.log('PASS offline rift:', JSON.stringify({ prepared, result }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
