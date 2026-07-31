import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium, webkit } from 'playwright';
import { loadTestSave } from './load-testsave.mjs';

/*
 * Crazy Sherine 離線 Boss 雙快取回歸。
 *
 * 這支測試載入真實遊戲頁面與玩家存檔；唯一的測試 seam 是 HTTP server
 * 在 afk-offline.js 的 runCatchup() 內注入一個暫停點，把具名 Boss helper
 * 暫時暴露給同一頁面的測試程式。正式檔案不需要留下 debug API，helper、
 * killMob、玩家與地圖物件仍全部是正式 runtime 的那一份。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const offlinePath = join(root, 'afk-offline.js');
const offlineSource = readFileSync(offlinePath, 'utf8');
for (const helper of [
  'bossCacheEntry',
  'bossMergeProfile',
  'beginBossTrue',
  'beginBossReplay',
  'bossReplayStep'
]) {
  assert.match(
    offlineSource,
    new RegExp(`function\\s+${helper}\\s*\\(`),
    `afk-offline.js 必須保留可回歸測試的具名 helper：${helper}()`
  );
}
const probeAnchor = '    var done = 0, died = false, _runErr = null;';
assert.equal(
  offlineSource.split(probeAnchor).length - 1,
  1,
  'afk-offline.js 的 runCatchup 測試注入點應唯一'
);

const probeSource = `${probeAnchor}
    // Test-only injection: scripts/test-offline-grace-boss-cache.mjs
    if (typeof window.__AFK_GRACE_BOSS_TEST_HOOK__ === 'function') {
      await window.__AFK_GRACE_BOSS_TEST_HOOK__({
        bossCacheEntry: bossCacheEntry,
        bossMergeProfile: bossMergeProfile,
        beginBossTrue: beginBossTrue,
        beginBossReplay: beginBossReplay,
        bossReplayStep: bossReplayStep,
        getBossStats: function () { return bossStats; },
        setBossStats: function (value) { bossStats = value || {}; },
        getDone: function () { return done; },
        setDone: function (value) { done = Math.max(0, +value || 0); },
        getTotalTicks: function () { return totalTicks; },
        setTotalTicks: function (value) { totalTicks = Math.max(0, +value || 0); },
        setFastMode: function (value) { fastMode = !!value; },
        isTrueBoss: function () { return fastBossUid != null; }
      });
    }`;
const instrumentedOffline = offlineSource.replace(probeAnchor, probeSource);

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
    if (pathname === '/afk-offline.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(instrumentedOffline);
      return;
    }
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
let browser = null;

async function openPausedCatchup() {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error && error.stack || error)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__afk, null, { timeout: 20000 });
  await loadTestSave(page, { slot: 1 });

  await page.evaluate(() => {
    player.sherineWorld = true;
    player.sherineMad = true;
    player.dead = false;
    player.hp = player.mhp;
    player.mp = player.mmp;
    state.running = true;
    mapState.current = 'zone_08';
    delete player._offStats;

    window.__AFK_GRACE_BOSS_TEST_HOOK__ = function (api) {
      window.__graceBossTestApi = api;
      return new Promise((resolve) => { window.__releaseGraceBossTest = resolve; });
    };
    __afk.forceCatchup(16, false);
  });

  await page.waitForFunction(
    () => window.__graceBossTestApi && window.__afk.isCatchingUp(),
    null,
    { timeout: 20000 }
  );
  return { context, page, errors };
}

async function releaseAndClose(harness) {
  const { context, page, errors } = harness;
  await page.evaluate(() => {
    const api = window.__graceBossTestApi;
    api.setDone(api.getTotalTicks());
    window.__releaseGraceBossTest();
  });
  await page.waitForFunction(() => !window.__afk.isCatchingUp(), null, { timeout: 20000 });
  assert.deepEqual(errors, [], '頁面不得出現未捕捉例外');
  await context.close();
}

try {
  for (const browserCase of [
    { name: 'Chromium', launch: () => chromium.launch(systemChrome ? { executablePath: systemChrome } : {}) },
    { name: 'WebKit', launch: () => webkit.launch() }
  ]) {
    browser = await browserCase.launch();
    try {
  // 1) normal / grace 必須是同名 Boss 下的兩份獨立 profile；更新其中一份
  //    不得改寫或用移動平均污染另一份。
  {
    const harness = await openPausedCatchup();
    const result = await harness.page.evaluate(() => {
      const api = window.__graceBossTestApi;
      api.setBossStats({});
      const entry = api.bossCacheEntry('雙槽測試頭目');

      entry.normal = api.bossMergeProfile(null, 40, true, [[250, 1]]);
      entry.grace = {
        ticks: 400,
        safe: true,
        minor: 2,
        events: [[300, 1], [700, 1]],
        marker: 'grace-sentinel'
      };
      const graceBefore = JSON.stringify(entry.grace);
      entry.normal = api.bossMergeProfile(entry.normal, 60, true, [[500, 1]]);
      const graceAfterNormalMerge = JSON.stringify(entry.grace);
      const normalBeforeGraceMerge = JSON.stringify(entry.normal);
      entry.grace = api.bossMergeProfile(entry.grace, 500, true, [[600, 2]]);
      const normalAfterGraceMerge = JSON.stringify(entry.normal);

      return {
        keys: Object.keys(entry).sort(),
        graceUnchanged: graceBefore === graceAfterNormalMerge,
        normalUnchanged: normalBeforeGraceMerge === normalAfterGraceMerge,
        separated: entry.normal !== entry.grace
      };
    });

    assert.deepEqual(result.keys, ['grace', 'normal']);
    assert.equal(result.graceUnchanged, true, '更新 normal 不得污染 grace');
    assert.equal(result.normalUnchanged, true, '更新 grace 不得污染 normal');
    assert.equal(result.separated, true, 'normal / grace 不得共用同一 profile 物件');
    await releaseAndClose(harness);
  }

  // 2) normal 快取重播途中若 Boss 取得 _grace，而且 grace 尚無快取，
  //    必須切到真打，絕不可沿用 normal 時間直接擊殺。
  {
    const harness = await openPausedCatchup();
    const result = await harness.page.evaluate(() => {
      const api = window.__graceBossTestApi;
      const base = DB.mobs.casper || Object.values(DB.mobs).find((mob) => mob && mob.boss);
      const boss = {
        ...base,
        n: '途中恩賜測試頭目',
        boss: true,
        uid: 'grace-transition-boss',
        _born: 1,
        _dead: false,
        _grace: false,
        curHp: Math.max(1, base.hp || 100),
        hp: Math.max(1, base.hp || 100)
      };
      mapState.current = 'zone_08';
      mapState.mobs = [boss, null, null, null, null];
      // 明確安排下一拍由核心出怪，避免角色移速造成重生延遲差異。
      mapState.spawnAt = [null, state.ticks + 1, null, null, null];

      const normal = { ticks: 100, safe: true, minor: 1, events: [[500, 1]] };
      api.setBossStats({
        [boss.n]: { normal, grace: null }
      });

      const originalSpawnMob = window.spawnMob;
      const originalKillMob = window.killMob;
      const originalSettleDeadMobs = window.settleDeadMobs;
      const probe = { graceApplied: 0, bossKills: 0, minorKills: 0 };

      window.spawnMob = function (idx) {
        const liveBoss = mapState.mobs.find((mob) => mob && mob.uid === boss.uid);
        if (liveBoss && !liveBoss._grace) {
          liveBoss._grace = true;
          liveBoss.hp *= 10;
          liveBoss.curHp = liveBoss.hp;
          probe.graceApplied++;
        }
        const minionBase = DB.mobs.zombie || Object.values(DB.mobs).find((mob) => mob && !mob.boss);
        mapState.mobs[idx] = {
          ...minionBase,
          n: '事件重播小怪',
          uid: `event-minor-${probe.graceApplied}-${idx}`,
          _born: 10 + idx,
          _dead: false,
          curHp: Math.max(1, minionBase.hp || 1),
          hp: Math.max(1, minionBase.hp || 1)
        };
      };
      window.killMob = function (idx) {
        const mob = mapState.mobs[idx];
        if (!mob || mob._dead) return;
        if (mob.uid === boss.uid) probe.bossKills++;
        else probe.minorKills++;
        mob._dead = true;
        mob.curHp = 0;
      };
      window.settleDeadMobs = function () {
        for (let i = 0; i < mapState.mobs.length; i++) {
          if (mapState.mobs[i] && mapState.mobs[i]._dead) mapState.mobs[i] = null;
        }
      };

      api.beginBossReplay(boss, 'normal', normal);
      let stepResult;
      let replaySteps = 0;
      while (replaySteps++ < 10 && !api.isTrueBoss() && probe.bossKills === 0) {
        stepResult = api.bossReplayStep();
      }
      const out = {
        stepResult,
        replaySteps,
        graceApplied: probe.graceApplied,
        bossKills: probe.bossKills,
        minorKills: probe.minorKills,
        bossGrace: !!boss._grace,
        switchedToTrue: api.isTrueBoss()
      };
      window.spawnMob = originalSpawnMob;
      window.killMob = originalKillMob;
      window.settleDeadMobs = originalSettleDeadMobs;
      return out;
    });

    assert.ok(result.graceApplied > 0, '測試必須確實在 normal 重播途中讓 Boss 取得恩賜');
    assert.equal(result.bossGrace, true);
    assert.equal(result.bossKills, 0, '途中取得恩賜不得走 normal 快取直接擊殺');
    assert.equal(result.switchedToTrue, true, '沒有 grace 快取時必須從取得恩賜當下切回真打');
    await releaseAndClose(harness);
  }

  // 3) 離線時間在真打 Boss 中途耗盡：不可偷補擊殺，也不可把截尾樣本
  //    當成一場完整 normal 樣本寫入。
  {
    const harness = await openPausedCatchup();
    const before = await harness.page.evaluate(() => {
      const api = window.__graceBossTestApi;
      const base = DB.mobs.casper || Object.values(DB.mobs).find((mob) => mob && mob.boss);
      const boss = {
        ...base,
        n: '離線耗盡測試頭目',
        boss: true,
        uid: 'time-exhaustion-boss',
        _born: 1,
        _dead: false,
        _grace: false,
        curHp: Math.max(1, base.hp || 100),
        hp: Math.max(1, base.hp || 100)
      };
      mapState.current = 'zone_08';
      mapState.mobs = [boss, null, null, null, null];
      mapState.spawnAt = [null, null, null, null, null];

      const graceSentinel = {
        ticks: 900,
        safe: true,
        minor: 1,
        events: [[500, 1]],
        marker: 'must-survive'
      };
      api.setBossStats({
        [boss.n]: { normal: null, grace: graceSentinel }
      });
      const statsBefore = JSON.stringify(api.getBossStats());

      window.__exhaustionProbe = {
        bossKills: 0,
        ticks: 0,
        doneBefore: 0,
        statsBefore,
        bossName: boss.n
      };
      const originalTick = window.tick;
      const originalKillMob = window.killMob;
      const originalSettleDeadMobs = window.settleDeadMobs;
      window.__restoreExhaustionProbe = function () {
        window.tick = originalTick;
        window.killMob = originalKillMob;
        window.settleDeadMobs = originalSettleDeadMobs;
      };
      window.tick = function () {
        state.ticks++;
        // runCatchup 結束會立即重啟 live timer；只計補跑旗標仍為 true 的拍，
        // 避免測試讀結果前剛好又跑到一拍線上 tick 而產生競速。
        if (window.__afk && window.__afk.isCatchingUp()) window.__exhaustionProbe.ticks++;
        // 故意永遠不打死 Boss。
      };
      window.killMob = function (idx) {
        const mob = mapState.mobs[idx];
        if (mob && mob.uid === boss.uid) window.__exhaustionProbe.bossKills++;
      };
      window.settleDeadMobs = function () {};

      api.setDone(api.getTotalTicks() - 3);
      window.__exhaustionProbe.doneBefore = api.getDone();
      api.setFastMode(true);
      api.beginBossTrue(boss, 'normal', 'incomplete-test');
      return { totalTicks: api.getTotalTicks(), done: api.getDone() };
    });

    assert.equal(before.totalTicks - before.done, 3, '測試必須只留下 3 拍離線時間');
    await harness.page.evaluate(() => window.__releaseGraceBossTest());
    await harness.page.waitForFunction(() => !window.__afk.isCatchingUp(), null, { timeout: 20000 });
    const result = await harness.page.evaluate(() => {
      const api = window.__graceBossTestApi;
      const probe = window.__exhaustionProbe;
      const entry = api.getBossStats()[probe.bossName];
      const out = {
        bossKills: probe.bossKills,
        ticks: probe.ticks,
        doneDelta: api.getDone() - probe.doneBefore,
        normal: entry && entry.normal,
        graceMarker: entry && entry.grace && entry.grace.marker,
        statsBefore: probe.statsBefore,
        statsAfter: JSON.stringify(api.getBossStats())
      };
      window.__restoreExhaustionProbe();
      return out;
    });

    assert.equal(result.doneDelta, 3, '離線 done 只應推進剩餘的 3 拍');
    assert.equal(result.ticks, 3, '補跑期間只應逐拍執行剩餘的 3 拍');
    assert.equal(result.bossKills, 0, '離線時間耗盡不可補算 Boss 擊殺');
    assert.equal(result.normal, null, '未擊殺的截尾戰鬥不得寫成完整 normal 樣本');
    assert.equal(result.graceMarker, 'must-survive', '未完成 normal 戰鬥不得碰 grace 快取');
    assert.equal(result.statsAfter, result.statsBefore, '未完成戰鬥不得改寫任何 Boss profile');
    assert.deepEqual(harness.errors, [], '頁面不得出現未捕捉例外');
    await harness.context.close();
  }

  // 4) 快取完成擊殺仍必須交給正式 killMob。以 Boss 必掉金幣及
  //    __afkKillTally 同時增加，證明不是直接刪 mob／手動灌離線紀錄。
  {
    const harness = await openPausedCatchup();
    const result = await harness.page.evaluate(() => {
      const api = window.__graceBossTestApi;
      const base = DB.mobs.casper || Object.values(DB.mobs).find((mob) => mob && mob.boss);
      const boss = {
        ...base,
        n: '真實掉落管線測試頭目',
        boss: true,
        uid: 'real-kill-pipeline-boss',
        _born: 1,
        _dead: false,
        _grace: false,
        curHp: Math.max(1, base.hp || 100),
        hp: Math.max(1, base.hp || 100)
      };
      mapState.current = 'zone_08';
      mapState.mobs = [boss, null, null, null, null];
      mapState.spawnAt = [null, null, null, null, null];
      player.dead = false;
      player.hp = player.mhp;
      player.gold = 1_000;
      const goldBefore = player.gold;
      // 正常圖重生延遲下限是 5 tick；使用 1 tick profile 可保證完成擊殺
      // 前不會另生小怪、觸發隨機恩賜，避免把 1% 真實 RNG 變成測試 flake。
      const profile = { ticks: 1, safe: true, minor: 0, events: [] };
      api.setBossStats({
        [boss.n]: { normal: profile, grace: null }
      });

      api.beginBossReplay(boss, 'normal', profile);
      let stepResult;
      let replaySteps = 0;
      while (replaySteps++ < 10 && !boss._dead) stepResult = api.bossReplayStep();
      return {
        stepResult,
        replaySteps,
        dead: !!boss._dead,
        goldBefore,
        goldAfter: player.gold,
        tallied: (window.__afkKillTally && window.__afkKillTally[boss.n]) || 0
      };
    });

    assert.equal(result.dead, true, '快取重播完成後 Boss 應由正式擊殺管線標記死亡');
    assert.ok(result.goldAfter > result.goldBefore, 'Boss 必掉金幣應由正式 killMob 發放');
    assert.equal(result.tallied, 1, '正式離線擊殺 tally 應恰記一隻 Boss');
    await releaseAndClose(harness);
  }

  // 5) 純 Boss 圖只有中央格有效；其他永久空格不可讓事件重播逐拍 pump。
  //    同時把快取 deadline 精確設成離線終點，必須仍完成最後一拍的正式擊殺。
  {
    const harness = await openPausedCatchup();
    const result = await harness.page.evaluate(() => {
      const api = window.__graceBossTestApi;
      const pureMap = PURE_BOSS_MAPS.find((map) => DB.maps[map] && !KING_ROOMS[map]);
      const base = DB.mobs.casper || Object.values(DB.mobs).find((mob) => mob && mob.boss);
      const boss = {
        ...base,
        n: '純頭目圖截止拍測試頭目',
        boss: true,
        uid: 'pure-boss-deadline',
        _born: 1,
        _dead: false,
        _grace: false,
        curHp: Math.max(1, base.hp || 100),
        hp: Math.max(1, base.hp || 100)
      };
      mapState.current = pureMap;
      mapState.mobs = [null, boss, null, null, null];
      mapState.spawnAt = [null, null, null, null, null];
      api.setDone(0);
      api.setTotalTicks(250);

      const profile = { ticks: 250, safe: true, minor: 0, events: [] };
      const originalMaybeSpawnMobs = window.maybeSpawnMobs;
      let spawnPumps = 0;
      window.maybeSpawnMobs = function () {
        spawnPumps++;
        return originalMaybeSpawnMobs.apply(this, arguments);
      };

      api.beginBossReplay(boss, 'normal', profile);
      const stepResult = api.bossReplayStep();
      const out = {
        pureMap,
        stepResult,
        spawnPumps,
        done: api.getDone(),
        totalTicks: api.getTotalTicks(),
        dead: !!boss._dead,
        tallied: (window.__afkKillTally && window.__afkKillTally[boss.n]) || 0
      };
      window.maybeSpawnMobs = originalMaybeSpawnMobs;
      return out;
    });

    assert.ok(result.pureMap, '測試必須找到核心純 Boss 圖');
    assert.ok(result.spawnPumps <= 3, `純 Boss 圖重播不得逐拍 pump（實際 ${result.spawnPumps} 次）`);
    assert.equal(result.done, result.totalTicks, '測試必須精確落在離線截止拍');
    assert.equal(result.dead, true, 'Boss 在離線截止拍死亡仍必須完成正式擊殺');
    assert.equal(result.tallied, 1, '截止拍 Boss 擊殺 tally 應恰記一隻');
    await releaseAndClose(harness);
  }

  // 6) normal 重播在出怪拍取得恩賜時，該拍要算入 grace profile。
  //    normal 先走 1 拍、grace 需 10 拍，總截止應是 10 而不是 11。
  {
    const harness = await openPausedCatchup();
    const result = await harness.page.evaluate(() => {
      const api = window.__graceBossTestApi;
      const base = DB.mobs.casper || Object.values(DB.mobs).find((mob) => mob && mob.boss);
      const minorBase = DB.mobs.zombie || Object.values(DB.mobs).find((mob) => mob && !mob.boss);
      const boss = {
        ...base,
        n: '恩賜相位測試頭目',
        boss: true,
        uid: 'grace-phase-boss',
        _born: 1,
        _dead: false,
        _grace: false,
        curHp: Math.max(1, base.hp || 100),
        hp: Math.max(1, base.hp || 100)
      };
      mapState.current = 'zone_08';
      mapState.mobs = [boss, null, null, null, null];
      mapState.spawnAt = [null, state.ticks + 1, null, null, null];
      api.setDone(0);
      api.setTotalTicks(1_000);
      const normal = { ticks: 100, safe: true, minor: 0, events: [] };
      const grace = { ticks: 10, safe: true, minor: 0, events: [] };
      api.setBossStats({ [boss.n]: { normal, grace } });

      const originalSpawnMob = window.spawnMob;
      const originalKillMob = window.killMob;
      const originalSettleDeadMobs = window.settleDeadMobs;
      const originalRandom = Math.random;
      Math.random = () => 0.99; // 不走 5% grace 抽驗
      window.spawnMob = function (idx) {
        boss._grace = true;
        boss.hp *= 10;
        boss.curHp = boss.hp;
        mapState.mobs[idx] = {
          ...minorBase,
          n: '恩賜相位小怪',
          uid: `grace-phase-minor-${idx}`,
          _born: 10 + idx,
          _dead: false,
          curHp: Math.max(1, minorBase.hp || 1),
          hp: Math.max(1, minorBase.hp || 1)
        };
      };
      window.killMob = function (idx) {
        const mob = mapState.mobs[idx];
        if (!mob || mob._dead) return;
        mob._dead = true;
        mob.curHp = 0;
      };
      window.settleDeadMobs = function () {
        for (let i = 0; i < mapState.mobs.length; i++) {
          if (mapState.mobs[i] && mapState.mobs[i]._dead) mapState.mobs[i] = null;
        }
      };

      const startDone = api.getDone();
      api.beginBossReplay(boss, 'normal', normal);
      api.bossReplayStep();
      const transitionDone = api.getDone();
      let steps = 0;
      while (!boss._dead && steps++ < 10) api.bossReplayStep();
      const out = {
        startDone,
        transitionDone,
        finalDone: api.getDone(),
        grace: !!boss._grace,
        dead: !!boss._dead,
        switchedToTrue: api.isTrueBoss()
      };
      Math.random = originalRandom;
      window.spawnMob = originalSpawnMob;
      window.killMob = originalKillMob;
      window.settleDeadMobs = originalSettleDeadMobs;
      return out;
    });

    assert.equal(result.transitionDone - result.startDone, 1, 'normal 應在第一個出怪拍取得恩賜');
    assert.equal(result.grace, true);
    assert.equal(result.switchedToTrue, false, '已有 grace 安全快取時不得退回逐拍真打');
    assert.equal(result.dead, true);
    assert.equal(result.finalDone - result.startDone, 10, '取得恩賜當拍必須包含在 10 拍 grace profile 內');
    await releaseAndClose(harness);
  }

      console.log(`PASS offline Crazy Sherine Boss dual-cache regression (${browserCase.name})`);
    } finally {
      await browser.close();
      browser = null;
    }
  }
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
