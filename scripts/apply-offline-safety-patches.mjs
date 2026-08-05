/**
 * apply-offline-safety-patches.mjs
 *
 * PP 最新版已恢復 afk-offline 實戰補跑；本腳本只補回 Jesper 版的安全政策：
 *   - 新舊離線引擎嚴格互斥
 *   - 每存檔位首次切換只建立新錨點，不補算凍結區間
 *   - 安塔瑞斯／攻城 V2 特殊副本禁止離線模擬
 *   - 遷移完成前，選角頁不顯示歷史殘留的掛機地圖／時間
 *   - 離頁 checkpoint 依已落盤進度去重，且存檔失敗時不推進收益錨點
 *   - 瘋狂席琳 Boss 以 normal／grace 雙快取＋事件重播避免耗時污染與全逐拍卡頓
 *
 * 所有替換皆以 PP 完成品的明確錨點定位；錨點改寫時直接失敗，不靜默降級。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const OFFLINE_FILE = 'afk-offline.js';
const SLOTINFO_FILE = 'afk-slotinfo.js';
const BOSSRING_FILE = 'afk-bossring.js';
const TOGGLES_FILE = 'afk-toggles.js';
const MARKER = '// 🔒 Jesper offline safety policy v4';
const SLOTINFO_MARKER = '// 🔒 Jesper offline migration visibility guard';
const OFFSTATS_MARKER = '// 🔒 Jesper offline cache contract v5';
const BOSSRING_MARKER = '// 🔒 Jesper offline boss hunt bridge v1';
const OFFLINE_BOSSRING_MARKER = '// 🔒 Jesper offline boss hunt settlement bridge v1';
const OLD_CRAZY_BOSS_CACHE_MARKER = '// 🔒 Jesper Crazy Sherine Boss cache safety v1';
const CRAZY_BOSS_CACHE_MARKER = '// 🔒 Jesper Crazy Sherine Boss event cache v2';
const RIFT_OFFLINE_MARKER = '// 🔒 Jesper rift offline journey v1';
const AUTOSELL_POLICY_CHAIN_MARKER = '// 🔒 Jesper junk autosell policy chain v1';
const CHECKPOINT_COMMIT_MARKER = '// 🔒 Jesper offline checkpoint commit gate v1';

function replaceOne(src, from, to, file, label) {
  const at = src.indexOf(from);
  if (at < 0) throw new Error(`[${file}] 找不到「${label}」錨點；PP 可能改寫了離線流程，拒絕不確定替換。`);
  if (src.indexOf(from, at + from.length) >= 0) throw new Error(`[${file}] 「${label}」錨點出現不只一次，拒絕不確定替換。`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

function finishFile(file, before, after) {
  if (CHECK) {
    if (after !== before) {
      throw new Error(`[${file}] --check 發現補丁尚未完整套用；請先執行 node scripts/apply-offline-safety-patches.mjs。`);
    }
    return;
  }
  writeFileSync(file, after);
}

function patchBossring() {
  let src = readFileSync(BOSSRING_FILE, 'utf8').replace(/\r\n/g, '\n');
  const srcBefore = src;
  if (!src.includes(BOSSRING_MARKER)) {
    src = replaceOne(
      src,
      ' *   - 只在「線上前景遊玩」跑（離線快速結算 state.ff 期間不套用；跟遇 BOSS 自動逃離互斥＝有王就不瞬移）。',
      ' *   - 線上前景與本站離線掛機都適用；離線由結算引擎按虛擬時間主動呼叫，跟遇 BOSS 自動逃離互斥＝有王就不瞬移。',
      BOSSRING_FILE,
      '檔頭適用範圍說明'
    );

    const uiScopeAnchors = [
      '<span class="text-xs text-slate-500">需帶戒指·離線不套用·每角色分開</span>',
      '<span class="text-xs text-slate-500">離線不套用</span>',
    ];
    const uiScopeMatches = uiScopeAnchors.filter(anchor => src.includes(anchor));
    if (uiScopeMatches.length !== 1) {
      throw new Error(`[${BOSSRING_FILE}] 「玩家介面適用範圍說明」錨點數量錯誤：${uiScopeMatches.length}`);
    }
    src = replaceOne(
      src,
      uiScopeMatches[0],
      '<span class="text-xs text-slate-500">戒指放背包即生效（不必裝備）·線上/離線皆適用·每角色分開</span>',
      BOSSRING_FILE,
      '玩家介面適用範圍說明'
    );

    src = replaceOne(
      src,
      "    function huntActive() {\n" +
      "        try {\n" +
      "            return isOn() && typeof state !== 'undefined' && state && state.running && !state.ff\n" +
      "                && hasTeleportRing() && !excludedMap() && mapHasBossPool();\n" +
      "        } catch (e) { return false; }\n" +
      "    }\n" +
      "    window.AFK_BOSSRING = { huntActive: huntActive };",
      "    " + BOSSRING_MARKER + "\n" +
      "    // 只有本站 afk-offline 的真實離線結算可在 state.ff 下啟用；背景分頁補跑仍維持線上規則。\n" +
      "    function offlineCatchupActive() {\n" +
      "        try {\n" +
      "            return typeof state !== 'undefined' && state && state.ff\n" +
      "                && window.__afk && typeof window.__afk.isCatchingUp === 'function'\n" +
      "                && window.__afk.isCatchingUp();\n" +
      "        } catch (e) { return false; }\n" +
      "    }\n" +
      "    function huntActive() {\n" +
      "        try {\n" +
      "            return isOn() && typeof state !== 'undefined' && state && state.running\n" +
      "                && (!state.ff || offlineCatchupActive())\n" +
      "                && hasTeleportRing() && !excludedMap() && mapHasBossPool();\n" +
      "        } catch (e) { return false; }\n" +
      "    }\n" +
      "    function signature() {\n" +
      "        try { return { on: !!isOn(), ring: !!hasTeleportRing() }; }\n" +
      "        catch (e) { return { on: false, ring: false, error: true }; }\n" +
      "    }\n" +
      "    function offlineStep(remainingTicks) {\n" +
      "        if (!offlineCatchupActive()) return 'inactive';\n" +
      "        // 結算尾端不再開新一輪：落點會重建地圖，否則卷軸已扣但 BOSS 還沒出生就被清掉。\n" +
      "        if (Number.isFinite(remainingTicks) && remainingTicks < WAIT_SPAWN_TICKS) return 'ending';\n" +
      "        return tick(true);\n" +
      "    }\n" +
      "    window.AFK_BOSSRING = {\n" +
      "        huntActive: huntActive,\n" +
      "        offlineCatchupActive: offlineCatchupActive,\n" +
      "        offlineStep: offlineStep,\n" +
      "        signature: signature\n" +
      "    };",
      BOSSRING_FILE,
      '離線結算公開介面'
    );

    src = replaceOne(
      src,
      "    var _waitUntil = 0;   // 瞬移後「等 BOSS 生成」期限(比照 main 的 _autoBossHuntUntil);逾時容許重試\n" +
      "    function tick() {\n" +
      "        try {\n" +
      "            if (!isOn()) return;                         // 勾選框沒勾 → 不自動\n" +
      "            if (typeof state === 'undefined' || !state || !state.running || state.ff) return;   // 只線上前景\n" +
      "            if (typeof mapState === 'undefined' || !mapState || !mapState.mobs) return;\n" +
      "            if (typeof player === 'undefined' || !player || !player.inv) return;\n" +
      "            if (!hasTeleportRing()) return;              // 沒戒指\n" +
      "            if (anyBoss()) { _waitUntil = 0; return; }   // 場上有王 → 打它，不瞬移（與自動逃離互斥）\n" +
      "            if (mapState.forceBoss) return;              // 已排定必出 BOSS → 等它生出來\n" +
      "            if ((state.ticks || 0) < _waitUntil) return; // 剛瞬移過:BOSS 生成要幾秒,等滿再重試\n" +
      "            if (excludedMap()) return;                   // 排除地圖\n" +
      "            if (!mapHasBossPool()) return;               // 無 BOSS 池的圖不動作(防無限燒卷軸)\n" +
      "            if (state._manualTpUntil && (state.ticks || 0) < state._manualTpUntil) return;   // 手動瞬移後抑制期\n" +
      "            var sc = player.inv.find(function (i) { return i && i.id === 'scroll_teleport' && (i.cnt || 1) >= 1; });\n" +
      "            if (!sc) {\n" +
      "                // 缺瞬移卷軸→比照上游「迴避頭目」自動購買一張(勾了功能=同意買;金幣不夠才作罷)\n" +
      "                try {\n" +
      "                    var cost = shopPrice(DB.items.scroll_teleport.p);\n" +
      "                    if (player.gold >= cost) {\n" +
      "                        player.gold -= cost;\n" +
      "                        gainItem('scroll_teleport', 1, true, true);\n" +
      "                        sc = player.inv.find(function (i) { return i && i.id === 'scroll_teleport' && (i.cnt || 1) >= 1; });\n" +
      "                    }\n" +
      "                } catch (e) {}\n" +
      "            }\n" +
      "            if (!sc) return;                             // 買不起也沒存貨 → 不動\n" +
      "            var before = scrollCount();\n" +
      "            useItem(sc.uid, false, true);                // 非 silent=戒指 forceBoss;keepModal=自動觸發別關玩家開著的視窗\n" +
      "            var blocked = (before >= 0 && scrollCount() === before);\n" +
      "            _waitUntil = (state.ticks || 0) + (blocked ? WAIT_BLOCKED_TICKS : WAIT_SPAWN_TICKS);\n" +
      "        } catch (e) {}\n" +
      "    }\n" +
      "    setInterval(tick, 1000);",
      "    var _waitUntilBySlot = {};   // 各存檔位分開，避免切角色後沿用上一隻角色的等待期限\n" +
      "    function waitKey() { return validSlot() ? String(currentSlot) : '_global'; }\n" +
      "    function readWaitUntil() { return _waitUntilBySlot[waitKey()] || 0; }\n" +
      "    function writeWaitUntil(v) { _waitUntilBySlot[waitKey()] = Math.max(0, Number(v) || 0); }\n" +
      "    function tick(allowOffline) {\n" +
      "        try {\n" +
      "            if (!isOn()) return 'off';                         // 勾選框沒勾 → 不自動\n" +
      "            if (typeof state === 'undefined' || !state || !state.running) return 'inactive';\n" +
      "            if (state.ff && !allowOffline) return 'inactive';  // 一般 timer 不介入補跑；離線只由 offlineStep 主動驅動\n" +
      "            if (typeof mapState === 'undefined' || !mapState || !mapState.mobs) return 'inactive';\n" +
      "            if (typeof player === 'undefined' || !player || !player.inv) return 'inactive';\n" +
      "            if (!hasTeleportRing()) return 'no-ring';          // 沒戒指\n" +
      "            if (anyBoss()) { writeWaitUntil(0); return 'boss'; } // 場上有王 → 打它，不瞬移（與自動逃離互斥）\n" +
      "            if (mapState.forceBoss) return 'waiting';          // 已排定必出 BOSS → 等它生出來\n" +
      "            if ((state.ticks || 0) < readWaitUntil()) return 'waiting';\n" +
      "            if (excludedMap()) return 'excluded';              // 排除地圖\n" +
      "            if (!mapHasBossPool()) return 'no-pool';           // 無 BOSS 池的圖不動作(防無限燒卷軸)\n" +
      "            if (state._manualTpUntil && (state.ticks || 0) < state._manualTpUntil) return 'manual-wait';\n" +
      "            var sc = player.inv.find(function (i) { return i && i.id === 'scroll_teleport' && (i.cnt || 1) >= 1; });\n" +
      "            if (!sc) {\n" +
      "                // 缺瞬移卷軸→比照上游「迴避頭目」自動購買一張(勾了功能=同意買;金幣不夠才作罷)\n" +
      "                try {\n" +
      "                    var cost = shopPrice(DB.items.scroll_teleport.p);\n" +
      "                    if (player.gold >= cost) {\n" +
      "                        player.gold -= cost;\n" +
      "                        gainItem('scroll_teleport', 1, true, true);\n" +
      "                        sc = player.inv.find(function (i) { return i && i.id === 'scroll_teleport' && (i.cnt || 1) >= 1; });\n" +
      "                    }\n" +
      "                } catch (e) {}\n" +
      "            }\n" +
      "            if (!sc) return 'no-scroll';                       // 買不起也沒存貨 → 不動\n" +
      "            var before = scrollCount();\n" +
      "            useItem(sc.uid, false, true);                      // 非 silent=戒指 forceBoss;keepModal=自動觸發別關玩家開著的視窗\n" +
      "            var blocked = (before >= 0 && scrollCount() === before);\n" +
      "            writeWaitUntil((state.ticks || 0) + (blocked ? WAIT_BLOCKED_TICKS : WAIT_SPAWN_TICKS));\n" +
      "            return blocked ? 'blocked' : 'used';\n" +
      "        } catch (e) { return 'error'; }\n" +
      "    }\n" +
      "    setInterval(function () { tick(false); }, 1000);",
      BOSSRING_FILE,
      '線上與離線共用召王步驟'
    );
  }

  const required = [
    BOSSRING_MARKER,
    '線上/離線皆適用',
    'function offlineCatchupActive()',
    'offlineStep: offlineStep',
    'signature: signature',
    'var _waitUntilBySlot = {}',
    'if (state.ff && !allowOffline)',
    "return blocked ? 'blocked' : 'used'",
    'setInterval(function () { tick(false); }, 1000)'
  ];
  const missing = required.filter(x => !src.includes(x));
  if (missing.length) throw new Error(`[${BOSSRING_FILE}] 離線召王補丁驗證失敗：${missing.join(' | ')}`);
  finishFile(BOSSRING_FILE, srcBefore, src);

  let toggles = readFileSync(TOGGLES_FILE, 'utf8').replace(/\r\n/g, '\n');
  const togglesBefore = toggles;
  const oldDescs = [
    "desc: '持傳送控制戒指時，場上無 BOSS 自動用瞬移卷軸召來（線上前景；排名/裂痕/軍王/攻城不套用）'",
    "desc: '帶著傳送控制戒指時，場上沒 BOSS 就自動用瞬移卷軸找一隻'",
    "desc: '傳送控制戒指放背包就生效（不必裝備）；場上沒 BOSS 就自動用瞬移卷軸找一隻'",
    "desc: '持傳送控制戒指時，場上無 BOSS 自動用瞬移卷軸召來（線上/離線；排名/裂痕/軍王/攻城不套用）'",
  ];
  const newDesc = "desc: '戒指放背包即生效（不必裝備）；場上無 BOSS 自動用瞬移卷軸召來（線上/離線；排名/裂痕/軍王/攻城不套用）'";
  if (!toggles.includes(newDesc)) {
    const matches = oldDescs.filter(desc => toggles.includes(desc));
    if (matches.length !== 1) {
      throw new Error(`[${TOGGLES_FILE}] 離線召王外掛說明錨點數量錯誤：${matches.length}`);
    }
    toggles = replaceOne(toggles, matches[0], newDesc, TOGGLES_FILE, '外掛說明');
  }
  if (!toggles.includes(newDesc)) throw new Error(`[${TOGGLES_FILE}] 找不到離線召王外掛說明。`);
  finishFile(TOGGLES_FILE, togglesBefore, toggles);
}

function patchRiftOffline(src) {
  if (src.includes(RIFT_OFFLINE_MARKER)) return src;

  const riftHelpers = `  ${RIFT_OFFLINE_MARKER}
  // 裂痕的戰鬥難度／強制頭目使用 state.ticks 推進，故離線補跑會照虛擬時間變難；
  // 排名與入口停留獎勵則只累計前景在線時間，離線結算耗時與離線區間一律排除。
  function riftKey() { return 'afk_rift_' + currentSlot; }
  function clearRiftRuntime() {
    if (typeof state === 'undefined' || !state) return;
    delete state.__afkRiftBattleBaseMs;
    delete state.__afkRiftBattleBaseTick;
    delete state.__afkRiftRankBaseMs;
    delete state.__afkRiftRankStartedAt;
    delete state.__afkRiftBossDueElapsedMs;
  }
  function readRift() {
    try {
      var raw = localStorage.getItem(riftKey());
      var data = raw ? JSON.parse(raw) : null;
      if (!data || data.v !== 1 || !(Number(data.battleMs) >= 0) || !(Number(data.rankMs) >= 0)) return null;
      return {
        v: 1,
        battleMs: Math.max(0, Number(data.battleMs) || 0),
        rankMs: Math.max(0, Number(data.rankMs) || 0),
        bossDueMs: Math.max(0, Number(data.bossDueMs) || 300000)
      };
    } catch (e) { return null; }
  }
  function adoptLiveRiftRuntime() {
    if (typeof state === 'undefined' || !state || !state.riftRun) return false;
    if (!(Number(state.__afkRiftBattleBaseMs) >= 0)) {
      var now = Date.now();
      var liveMs = Math.max(0, now - (Number(state.riftStartMs) || now));
      state.__afkRiftBattleBaseMs = liveMs;
      state.__afkRiftBattleBaseTick = Number(state.ticks) || 0;
      state.__afkRiftRankBaseMs = 0;
      state.__afkRiftRankStartedAt = Number(state.riftStartMs) || now;
      state.__afkRiftBossDueElapsedMs = liveMs + Math.max(0, (Number(state.riftBossDue) || (now + 300000)) - now);
    }
    return true;
  }
  function riftBattleElapsedMs() {
    if (!adoptLiveRiftRuntime()) return 0;
    var base = Math.max(0, Number(state.__afkRiftBattleBaseMs) || 0);
    var baseTick = Number(state.__afkRiftBattleBaseTick);
    if (!Number.isFinite(baseTick)) baseTick = Number(state.ticks) || 0;
    return base + Math.max(0, (Number(state.ticks) || 0) - baseTick) * TICK_MS;
  }
  function riftRankElapsedMs() {
    if (!adoptLiveRiftRuntime()) return 0;
    var base = Math.max(0, Number(state.__afkRiftRankBaseMs) || 0);
    if (catchingUp || state.ff) return base;
    var started = Number(state.__afkRiftRankStartedAt) || Date.now();
    return base + Math.max(0, Date.now() - started);
  }
  function riftSnapshot() {
    if (!adoptLiveRiftRuntime()) return null;
    return {
      v: 1,
      battleMs: Math.max(0, Math.round(riftBattleElapsedMs())),
      rankMs: Math.max(0, Math.round(riftRankElapsedMs())),
      bossDueMs: Math.max(0, Math.round(Number(state.__afkRiftBossDueElapsedMs) || 300000))
    };
  }
  function writeRiftSnapshot() {
    try {
      var data = riftSnapshot();
      if (data) localStorage.setItem(riftKey(), JSON.stringify(data));
      else localStorage.removeItem(riftKey());
    } catch (e) {}
  }
  function restoreRiftRuntime(data) {
    if (!data || typeof state === 'undefined' || !state) return false;
    var now = Date.now();
    state.riftRun = true;
    state.__afkRiftBattleBaseMs = Math.max(0, Number(data.battleMs) || 0);
    state.__afkRiftBattleBaseTick = Number(state.ticks) || 0;
    state.__afkRiftRankBaseMs = Math.max(0, Number(data.rankMs) || 0);
    state.__afkRiftRankStartedAt = now;
    state.__afkRiftBossDueElapsedMs = Math.max(
      state.__afkRiftBattleBaseMs,
      Number(data.bossDueMs) || (state.__afkRiftBattleBaseMs + 300000)
    );
    state.riftStartMs = now - state.__afkRiftRankBaseMs;
    state.riftBossDue = now + Math.max(0, state.__afkRiftBossDueElapsedMs - state.__afkRiftBattleBaseMs);
    return true;
  }
  function sealRiftRuntimeAfterCatchup() {
    if (!state || !state.riftRun) return;
    var battleMs = riftBattleElapsedMs();
    var rankMs = riftRankElapsedMs();
    state.__afkRiftBattleBaseMs = battleMs;
    state.__afkRiftBattleBaseTick = Number(state.ticks) || 0;
    state.__afkRiftRankBaseMs = rankMs;
    state.__afkRiftRankStartedAt = Date.now();
    state.riftStartMs = Date.now() - rankMs;
    state.riftBossDue = Date.now() + Math.max(0, (Number(state.__afkRiftBossDueElapsedMs) || (battleMs + 300000)) - battleMs);
  }
  function installRiftOfflineHooks() {
    if (typeof enterRift === 'function') {
      var _enterRift = enterRift;
      window.enterRift = function () {
        var wasRunning = !!(state && state.riftRun);
        var result = _enterRift.apply(this, arguments);
        if (!wasRunning && state && state.riftRun) {
          var now = Date.now();
          state.__afkRiftBattleBaseMs = 0;
          state.__afkRiftBattleBaseTick = Number(state.ticks) || 0;
          state.__afkRiftRankBaseMs = 0;
          state.__afkRiftRankStartedAt = now;
          state.__afkRiftBossDueElapsedMs = 300000;
          state.riftStartMs = now;
          state.riftBossDue = now + 300000;
          writeRiftSnapshot();
        }
        return result;
      };
    }
    if (typeof riftDamageMult === 'function') {
      var _riftDamageMult = riftDamageMult;
      window.riftDamageMult = function () {
        if (!state || !state.riftRun || !adoptLiveRiftRuntime()) return _riftDamageMult.apply(this, arguments);
        var minutes = Math.floor(riftBattleElapsedMs() / 60000);
        return 1 + 0.2 * Math.max(0, minutes - 30);
      };
    }
    if (typeof spawnRiftMob === 'function') {
      var _spawnRiftMob = spawnRiftMob;
      window.spawnRiftMob = function () {
        if (!state || !state.riftRun || !adoptLiveRiftRuntime()) return _spawnRiftMob.apply(this, arguments);
        var now = Date.now();
        var battleMs = riftBattleElapsedMs();
        var rankStart = state.riftStartMs, bossDue = state.riftBossDue;
        var dueElapsed = Math.max(battleMs, Number(state.__afkRiftBossDueElapsedMs) || (battleMs + 300000));
        state.riftStartMs = now - battleMs;
        state.riftBossDue = now + Math.max(0, dueElapsed - battleMs);
        try {
          return _spawnRiftMob.apply(this, arguments);
        } finally {
          state.__afkRiftBossDueElapsedMs = battleMs + Math.max(0, (Number(state.riftBossDue) || now) - Date.now());
          state.riftStartMs = rankStart;
          state.riftBossDue = bossDue;
        }
      };
    }
    if (typeof riftEndRun === 'function') {
      var _riftEndRun = riftEndRun;
      window.riftEndRun = function () {
        if (!state || !state.riftRun || !adoptLiveRiftRuntime()) return _riftEndRun.apply(this, arguments);
        state.riftStartMs = Date.now() - riftRankElapsedMs();
        var result = _riftEndRun.apply(this, arguments);
        clearRiftRuntime();
        try { localStorage.removeItem(riftKey()); } catch (e) {}
        return result;
      };
    }
    if (typeof renderRiftEntrance === 'function') {
      var _renderRiftEntrance = renderRiftEntrance;
      window.renderRiftEntrance = function (container) {
        var result = _renderRiftEntrance.apply(this, arguments);
        try {
          if (container && !container.querySelector('.afk-rift-offline-note')) {
            var note = document.createElement('div');
            note.className = 'afk-rift-offline-note text-cyan-300 text-xs rounded border border-cyan-800/70 bg-cyan-950/30 p-2';
            note.textContent = '支援離線掛機：離線期間照常取得戰鬥經驗、金幣與掉落，但不計入裂痕排名及入口停留獎勵時間。';
            container.appendChild(note);
          }
        } catch (e) {}
        return result;
      };
    }
  }
  installRiftOfflineHooks();`;

  src = replaceOne(
    src,
    "  function oblKey()     { return 'afk_obl_' + currentSlot; }\n" +
    "  function migrationKey(slot)",
    "  function oblKey()     { return 'afk_obl_' + currentSlot; }\n" +
    riftHelpers + "\n" +
    "  function migrationKey(slot)",
    OFFLINE_FILE,
    '時空裂痕離線旅程 helper'
  );

  src = replaceOne(
    src,
    "      if (typeof state !== 'undefined' && state && state.oblivion) {\n" +
    "        localStorage.setItem(oblKey(), JSON.stringify({ phase: state.oblivion }));\n" +
    "      } else {\n" +
    "        localStorage.removeItem(oblKey());\n" +
    "      }\n",
    "      if (typeof state !== 'undefined' && state && state.oblivion) {\n" +
    "        localStorage.setItem(oblKey(), JSON.stringify({ phase: state.oblivion }));\n" +
    "      } else {\n" +
    "        localStorage.removeItem(oblKey());\n" +
    "      }\n" +
    "      // 🌀 裂痕旅程另存於外掛鍵；核心 save 不保存 state.riftRun，重載後靠這份接回。\n" +
    "      writeRiftSnapshot();\n",
    OFFLINE_FILE,
    '時空裂痕心跳快照'
  );

  src = replaceOne(
    src,
    "  async function runCatchup(totalTicks, withOverlay, huntMap, prePride, preObl, timing) {",
    "  async function runCatchup(totalTicks, withOverlay, huntMap, prePride, preObl, timing, preRift) {",
    OFFLINE_FILE,
    '離線結算裂痕參數'
  );
  src = replaceOne(
    src,
    "    var isObl = !isClimb && !!(preObl && preObl.phase && typeof enterOblivionMap === 'function');   // 🏝️ 遺忘之島旅程:同攀登,還原 state.oblivion 後用 enterOblivionMap 進場(島地圖非選單地圖)\n" +
    "    // ⚔ 軍王之室",
    "    var isObl = !isClimb && !!(preObl && preObl.phase && typeof enterOblivionMap === 'function');   // 🏝️ 遺忘之島旅程:同攀登,還原 state.oblivion 後用 enterOblivionMap 進場(島地圖非選單地圖)\n" +
    "    var isRift = !isClimb && !isObl && huntMap === 'rift_battle' && !!preRift && typeof enterRiftMap === 'function';\n" +
    "    // ⚔ 軍王之室",
    OFFLINE_FILE,
    '裂痕離線模式判定'
  );
  src = replaceOne(
    src,
    "    } else if (isObl) {\n" +
    "      // 遺忘之島:還原原作不存檔的旅程旗標,用 enterOblivionMap 進場(ff=true 故不碰 DOM)。\n" +
    "      // 補跑期間「途中擊敗傳送門→進本島」由原作 settleDeadMobs 內的 state._oblivionAdvance 流程自動處理。\n" +
    "      state.oblivion = preObl.phase;\n" +
    "      state._oblivionAdvance = false;\n" +
    "      enterOblivionMap(huntMap);\n" +
    "    } else {\n",
    "    } else if (isObl) {\n" +
    "      // 遺忘之島:還原原作不存檔的旅程旗標,用 enterOblivionMap 進場(ff=true 故不碰 DOM)。\n" +
    "      // 補跑期間「途中擊敗傳送門→進本島」由原作 settleDeadMobs 內的 state._oblivionAdvance 流程自動處理。\n" +
    "      state.oblivion = preObl.phase;\n" +
    "      state._oblivionAdvance = false;\n" +
    "      enterOblivionMap(huntMap);\n" +
    "    } else if (isRift) {\n" +
    "      // 裂痕不在 DB.maps，也不走 gotoMap；還原外掛旅程後直接用原作進場函式接回。\n" +
    "      restoreRiftRuntime(preRift);\n" +
    "      enterRiftMap();\n" +
    "    } else {\n",
    OFFLINE_FILE,
    '裂痕離線進場'
  );
  src = replaceOne(
    src,
    "    var fastEligible = !isClimb && !isKing && (!isObl || (preObl && preObl.phase === 'island'))\n",
    "    // 裂痕難度隨虛擬時間持續提高；不可沿用低難度快速樣本，先固定完整模擬保證死亡與收益正確。\n" +
    "    var fastEligible = !isClimb && !isKing && !isRift && (!isObl || (preObl && preObl.phase === 'island'))\n",
    OFFLINE_FILE,
    '裂痕停用快速樣本'
  );
  src = replaceOne(
    src,
    "      } else if (isObl) { hKind = 'oblivion'; hMap = mapName(oblEndMap || (mapState && mapState.current) || huntMap); }\n" +
    "      else if (isKing)",
    "      } else if (isObl) { hKind = 'oblivion'; hMap = mapName(oblEndMap || (mapState && mapState.current) || huntMap); }\n" +
    "      else if (isRift) { hKind = 'rift'; hMap = '時空裂痕'; }\n" +
    "      else if (isKing)",
    OFFLINE_FILE,
    '裂痕離線紀錄分類'
  );
  src = replaceOne(
    src,
    "        while (done < totalTicks && !player.dead && state.running && !_abortCatchup &&\n",
    "        while (done < totalTicks && !player.dead && state.running && (!_abortCatchup) && (!isRift || state.riftRun) &&\n",
    OFFLINE_FILE,
    '裂痕死亡停止補跑'
  );
  src = replaceOne(
    src,
    "    var after = snapshot();\n",
    "    if (isRift && !state.riftRun) died = true;   // 裂痕死亡由核心立即回入口並清 dead；用旅程旗標保留「撞死即停」語意\n" +
    "    var after = snapshot();\n",
    OFFLINE_FILE,
    '裂痕死亡結果'
  );
  src = replaceOne(
    src,
    "    player.dead = false;\n" +
    "    if (isClimb) {\n",
    "    player.dead = false;\n" +
    "    if (isRift) {\n" +
    "      if (state.riftRun) {\n" +
    "        try { if (player.mhp) player.hp = player.mhp; if (player.mmp) player.mp = player.mmp; } catch (e) {}\n" +
    "        sealRiftRuntimeAfterCatchup();\n" +
    "        state.ff = prevFf0; state.inTick = prevInTick0;\n" +
    "        enterRiftMap();\n" +
    "      } else if (!mapState || mapState.current !== 'town_rift') {\n" +
    "        try { setMapSelectors('town_rift'); changeMap(true); } catch (e) {}\n" +
    "      }\n" +
    "    } else if (isClimb) {\n",
    OFFLINE_FILE,
    '裂痕離線結算落點'
  );

  src = replaceOne(
    src,
    "  function maybeCatchup(preMap, preTs, prePride, preObl) {",
    "  function maybeCatchup(preMap, preTs, prePride, preObl, preRift) {",
    OFFLINE_FILE,
    '裂痕 preload 參數'
  );
  src = replaceOne(
    src,
    "    var isObl = !!(preObl && preObl.phase && typeof enterOblivionMap === 'function');   // 🏝️ 上次在遺忘之島旅程中(島/途中):同攀登,還原旅程並接回島上續掛\n" +
    "    if (isObl && !savedMap)",
    "    var isObl = !!(preObl && preObl.phase && typeof enterOblivionMap === 'function');   // 🏝️ 上次在遺忘之島旅程中(島/途中):同攀登,還原旅程並接回島上續掛\n" +
    "    var isRift = savedMap === 'rift_battle' && !!preRift && typeof enterRiftMap === 'function';\n" +
    "    if (isObl && !savedMap)",
    OFFLINE_FILE,
    '裂痕 preload 判定'
  );
  src = replaceOne(
    src,
    "    if (savedMap === 'rift_battle') {\n" +
    "      // 🌀 時空裂痕:時間排名挑戰(停留越久排名/獎勵越高、每 5 分鐘強制頭目逐漸把你打死)。\n" +
    "      //   非選單地圖(enterRiftMap 進場、不走 changeMap)、state.riftRun 在暫態 state 上不存檔 → reload 一律已回村。\n" +
    "      //   離線自動續＝刷排名/刷獎勵 exploit;比照排名攀登,離線不續、不結算(等同原作「中途離開＝該次作廢」)。\n" +
    "      //   若不擋:savedMap='rift_battle' 非 town_/非攻城 → 會被當一般圖跑 gotoMap('rift_battle'),\n" +
    "      //   但它不是選單地圖 → setMapSelectors 設不上 → mapState.current 變空 → 空轉、收益歸零(同遺忘之島舊雷)。\n" +
    "      console.info('[AFK] 上次在時空裂痕(時間排名挑戰)中：依設計不自動續、不結算離線收益。');\n" +
    "      skipNote('上次在「時空裂痕」中：時間排名挑戰依設計不結算離線收益（該次挑戰已作廢）。');\n" +
    "      return;\n" +
    "    }\n",
    "    if (savedMap === 'rift_battle' && !isRift) {\n" +
    "      // 舊版關閉時沒有裂痕旅程快照，無法可靠還原已在線多久／下一隻強制頭目；只略過這一次，避免補發錯誤收益。\n" +
    "      console.info('[AFK] 上次在時空裂痕中，但沒有新版旅程快照：本次略過離線結算。');\n" +
    "      skipNote('上次在「時空裂痕」中，但關閉時仍是舊版狀態，這一次無法還原；更新後重新進入的裂痕即可離線續掛。');\n" +
    "      return;\n" +
    "    }\n",
    OFFLINE_FILE,
    '裂痕由禁用改為旅程恢復'
  );
  src = replaceOne(
    src,
    "      if (isClimb || isObl) runCatchup(0, false, savedMap, prePride, preObl);\n",
    "      if (isClimb || isObl || isRift) runCatchup(0, false, savedMap, prePride, preObl, null, preRift);\n",
    OFFLINE_FILE,
    '裂痕零時間恢復'
  );
  src = replaceOne(
    src,
    "    if (!isClimb && !isObl) {\n",
    "    if (!isClimb && !isObl && !isRift) {\n",
    OFFLINE_FILE,
    '裂痕略過一般地圖守衛'
  );
  src = replaceOne(
    src,
    "    if (ticks <= 0 && !isClimb && !isObl) return;",
    "    if (ticks <= 0 && !isClimb && !isObl && !isRift) return;",
    OFFLINE_FILE,
    '裂痕立即重整仍恢復'
  );
  src = replaceOne(
    src,
    "    runCatchup(Math.max(0, ticks), ticks > OVERLAY_MIN_TICK, savedMap, prePride, preObl, { closeTs: last, loginTs: now });",
    "    runCatchup(Math.max(0, ticks), ticks > OVERLAY_MIN_TICK, savedMap, prePride, preObl, { closeTs: last, loginTs: now }, preRift);",
    OFFLINE_FILE,
    '裂痕旅程交給補跑'
  );

  src = replaceOne(
    src,
    "    if (!migrationDone()) return { map: '', ts: 0, pride: null, obl: null, migration: true };",
    "    if (!migrationDone()) return { map: '', ts: 0, pride: null, obl: null, rift: null, migration: true };",
    OFFLINE_FILE,
    '裂痕遷移 preload'
  );
  src = replaceOne(
    src,
    "    return { map: map, ts: readTs(), pride: readPride(), obl: readObl() };",
    "    return { map: map, ts: readTs(), pride: readPride(), obl: readObl(), rift: readRift() };",
    OFFLINE_FILE,
    '讀取裂痕旅程'
  );
  src = replaceOne(
    src,
    "    try { maybeCatchup(pre.map, pre.ts, pre.pride, pre.obl); }",
    "    try { maybeCatchup(pre.map, pre.ts, pre.pride, pre.obl, pre.rift); }",
    OFFLINE_FILE,
    '裂痕旅程載入後結算'
  );
  const riftNote = "  // 裂痕入口由本外掛補上「離線戰鬥收益照算、排名與停留獎勵時間不算」提示；排名攀登仍不支援離線。";
  if (!src.includes(riftNote)) {
    const upstreamRiftNotes = [
      "  // 入口提示(時空裂痕/排名攀登不支援離線)已直接寫進核心 renderRiftEntrance(js/05)/renderPrideEntrance(js/11),不再包 wrapper 注入。",
      "  // 時空裂痕/排名攀登的入口**沒有**「不支援離線」提示:上游核心(renderRiftEntrance/renderPrideEntrance)自己不寫,\n" +
      "  //   我方也不包 wrapper 注入 → 玩家只在離線回來時看到 maybeCatchup 那兩段 skipNote。要補提示得另開外掛 wrapper。"
    ];
    const matches = upstreamRiftNotes.filter(note => src.includes(note));
    if (matches.length !== 1) {
      throw new Error(`[${OFFLINE_FILE}] 「裂痕入口提示說明」錨點數量錯誤：${matches.length}`);
    }
    src = replaceOne(src, matches[0], riftNote, OFFLINE_FILE, '裂痕入口提示說明');
  }
  src = replaceOne(
    src,
    "    version: '2.2.0-jesper-safety',",
    "    version: '2.3.0-jesper-rift-offline',",
    OFFLINE_FILE,
    '裂痕離線引擎版本'
  );
  src = replaceOne(
    src,
    "    readTs: readTs,\n" +
    "    isCatchingUp:",
    "    readTs: readTs,\n" +
    "    readRift: readRift,\n" +
    "    riftSnapshot: riftSnapshot,\n" +
    "    isCatchingUp:",
    OFFLINE_FILE,
    '裂痕除錯介面'
  );
  src = replaceOne(
    src,
    "    forceCatchup: function (mins, noFast) { _forceNoFast = !!noFast; runCatchup(Math.floor((mins || 60) * 60000 / TICK_MS), true, (typeof mapState !== 'undefined' && mapState && mapState.current) || ''); }",
    "    forceCatchup: function (mins, noFast) { _forceNoFast = !!noFast; var _map = (typeof mapState !== 'undefined' && mapState && mapState.current) || ''; runCatchup(Math.floor((mins || 60) * 60000 / TICK_MS), true, _map, null, null, null, _map === 'rift_battle' ? riftSnapshot() : null); }",
    OFFLINE_FILE,
    '裂痕 forceCatchup'
  );

  return src;
}

function convergeRiftOffline(src) {
  const driftingBossDue =
    "          state.__afkRiftBossDueElapsedMs = battleMs + Math.max(0, (Number(state.riftBossDue) || now) - Date.now());\n";
  if (src.includes(driftingBossDue)) {
    src = replaceOne(
      src,
      driftingBossDue,
      "          // 核心只有在強制頭目到期時才把 due 重設為「虛擬當下＋5 分鐘」。\n" +
      "          // 未到期時保留原虛擬 due，不能把每次 spawn 的真實執行毫秒逐次扣掉。\n" +
      "          var afterDue = Number(state.riftBossDue) || now;\n" +
      "          var beforeRemain = Math.max(0, dueElapsed - battleMs);\n" +
      "          state.__afkRiftBossDueElapsedMs = (afterDue - now > beforeRemain + 1000)\n" +
      "            ? battleMs + Math.max(0, afterDue - Date.now())\n" +
      "            : dueElapsed;\n",
      OFFLINE_FILE,
      '裂痕強制頭目虛擬期限不受結算耗時漂移'
    );
  }
  return src;
}

function convergeCheckpointCommit(src) {
  if (src.includes(CHECKPOINT_COMMIT_MARKER)) return src;

  src = replaceOne(
    src,
`    _ckptNow = function () {
      try {
        if (!timing || !timing.closeTs || done <= 0 || player.dead || !state.running) return;
        doCheckpoint();
      } catch (e) {}
    };
    function doCheckpoint() {
      // ⏱ 量自己花掉多少真實時間:存檔(壓縮)在慢裝置上可能很貴,而它是「每 CKPT_MS 一次」——
      //   單次成本一旦逼近 CKPT_MS,結算時間就會失控放大(越慢→存越多次→更慢)。
      //   把它跟結算總耗時並排記進離線紀錄,才分得出「真的在算」還是「卡在存檔」(2026-07-30 玩家回報結算 30 分鐘時加)。
      var _ck0 = performance.now();
      try {
        var _sq = _saveSquelch; _saveSquelch = false;   // ⚡ 檢查點是「該存的存檔」:暫時放行 saveGame 擋板
        wallHoldsRestore();   // 💾 存檔前先把被撐長的效期(追蹤／追殺)還原,結算中途關頁也不會把假到期時間留在存檔裡
        try { if (typeof saveGame === 'function') saveGame(); } finally { _saveSquelch = _sq; wallHoldsApply(); }   // ff 下 logSys 靜音,不會洗「進度已儲存」;saveGame 尾端的 offlineStamp 被 catchingUp 擋掉,不影響錨點
        stampCore(timing.closeTs + done * TICK_MS);       // 錨點=已結算到的時間點(絕不用 now,剩餘離線時間才不會被吃掉)
        _ckptN++; _ckptMs += performance.now() - _ck0;    // 先累計再寫紀錄,這一次的成本才會進到這筆紀錄裡
        recordHistory(buildHistRec());                    // 已結算部分先寫進離線紀錄(同 closeTs 覆寫,不會多筆)
      } catch (eCk) {}
      _ckptLastMs = performance.now();
    }`,
`    ${CHECKPOINT_COMMIT_MARKER}
    // visibilitychange/pagehide 常在同一輪連發；以已真正落盤的 done 做冪等鍵，避免大存檔連續複製／壓縮兩次。
    var _ckptCommittedDone = -1;
    _ckptNow = function () {
      try {
        if (!timing || !timing.closeTs || done <= 0 || player.dead || !state.running) return false;
        return doCheckpoint();
      } catch (e) { return false; }
    };
    function doCheckpoint() {
      var checkpointDone = done;
      if (checkpointDone <= _ckptCommittedDone) return true;
      // ⏱ 量自己花掉多少真實時間:存檔(壓縮)在慢裝置上可能很貴,而它是「每 CKPT_MS 一次」——
      //   單次成本一旦逼近 CKPT_MS,結算時間就會失控放大(越慢→存越多次→更慢)。
      //   把它跟結算總耗時並排記進離線紀錄,才分得出「真的在算」還是「卡在存檔」(2026-07-30 玩家回報結算 30 分鐘時加)。
      var _ck0 = performance.now();
      try {
        var _sq = _saveSquelch; _saveSquelch = false;   // ⚡ 檢查點是「該存的存檔」:暫時放行 saveGame 擋板
        wallHoldsRestore();   // 💾 存檔前先把被撐長的效期(追蹤／追殺)還原,結算中途關頁也不會把假到期時間留在存檔裡
        var saved = false;
        try { if (typeof saveGame === 'function') saved = saveGame() === true; } finally { _saveSquelch = _sq; wallHoldsApply(); }
        if (!saved) return false;                         // 主存檔／寵物桶沒完整落地時絕不可先推錨點，否則會吃掉收益
        stampCore(timing.closeTs + checkpointDone * TICK_MS);
        _ckptCommittedDone = checkpointDone;
        _ckptN++; _ckptMs += performance.now() - _ck0;
        recordHistory(buildHistRec());
        _ckptLastMs = performance.now();
        return true;
      } catch (eCk) { return false; }
    }`,
    OFFLINE_FILE,
    '離頁 checkpoint 落盤去重與失敗閘門'
  );

  src = replaceOne(
    src,
`      window.saveGame = function () {
        if (_saveSquelch) return;   // ⚡ 結算迴圈期間擋核心逐殺存檔(頭目擊殺後 saveGame 無 ff 守衛);檢查點/結算尾經 doCheckpoint 放行
        var r = _save.apply(this, arguments); try { stamp(); } catch (e) {} return r;
      };`,
`      window.saveGame = function () {
        if (_saveSquelch) {
          // js/13 的 close-flush 已有 250ms lifecycle 去重；委派同一個 checkpoint，讓它取得 true 並擋住後續事件。
          if (window.__fb5CloseFlush && typeof _ckptNow === 'function') return _ckptNow();
          return false;
        }
        var r = _save.apply(this, arguments); try { stamp(); } catch (e) {} return r;
      };`,
    OFFLINE_FILE,
    'close-flush 委派離線 checkpoint'
  );
  return src;
}

function convergeSaveUnwrapBudget(src) {
  if (src.includes('UW_CHAR_MAX = 2500000')) return src;
  return replaceOne(
    src,
`    //    純函式(同字串必同結果),用「最近 8 份字串」的小快取即可;回傳物件每次複製一份,避免呼叫端改到共用物件。
    if (typeof _saveUnwrap === 'function') {
      var _uw = _saveUnwrap, _uwKeys = [], _uwVals = Object.create(null), UW_MAX = 8;
      window._saveUnwrap = function (raw) {
        if (typeof raw !== 'string' || raw.length < 64) return _uw.apply(this, arguments);
        var hit = _uwVals[raw];
        if (!hit) {
          hit = _uw.call(this, raw);
          _uwVals[raw] = hit; _uwKeys.push(raw);
          while (_uwKeys.length > UW_MAX) delete _uwVals[_uwKeys.shift()];
        }
        return { payload: hit.payload, signed: hit.signed, ok: hit.ok };
      };
    }`,
`    //    純函式(同字串必同結果),但成熟角色單份可接近 1MB；同時限制筆數與總字數，避免 8 份大字串長駐手機。
    //    回傳物件每次複製一份,避免呼叫端改到共用物件。
    if (typeof _saveUnwrap === 'function') {
      var _uw = _saveUnwrap, _uwKeys = [], _uwVals = Object.create(null), _uwChars = 0;
      var UW_MAX = 3, UW_CHAR_MAX = 2500000;
      window._saveUnwrap = function (raw) {
        if (typeof raw !== 'string' || raw.length < 64) return _uw.apply(this, arguments);
        var hit = _uwVals[raw];
        if (!hit) {
          hit = _uw.call(this, raw);
          _uwVals[raw] = hit; _uwKeys.push(raw); _uwChars += raw.length;
          while (_uwKeys.length > 1 && (_uwKeys.length > UW_MAX || _uwChars > UW_CHAR_MAX)) {
            var oldRaw = _uwKeys.shift();
            _uwChars -= oldRaw.length;
            delete _uwVals[oldRaw];
          }
        }
        return { payload: hit.payload, signed: hit.signed, ok: hit.ok };
      };
    }`,
    OFFLINE_FILE,
    '大存檔驗簽快取字數上限'
  );
}

function patchOffline() {
  let src = readFileSync(OFFLINE_FILE, 'utf8').replace(/\r\n/g, '\n');
  const srcBefore = src;
  if (!src.includes(MARKER)) {
    const toggleLine =
      "  if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('offline')) return;   // 🎚️ 外掛開關:關掉→不掛任何鉤子,遊戲回原版(無離線結算)";
    const configAnchor =
      "  // ----- 可調參數 ---------------------------------------------------------\n" +
      "  var CAP_HOURS";
    const introAt = src.indexOf(toggleLine);
    const configAt = src.indexOf(configAnchor, introAt + toggleLine.length);
    if (introAt < 0 || configAt < 0 ||
        src.indexOf(toggleLine, introAt + toggleLine.length) >= 0 ||
        src.indexOf(configAnchor, configAt + configAnchor.length) >= 0) {
      throw new Error(`[${OFFLINE_FILE}] 「獨占握手與遷移版本」錨點不唯一或順序失效。`);
    }
    // PP 可能擴寫 offlinechase 的名稱／說明；完整保留 toggle 與可調參數之間的上游內容，
    // 只在 config 前插入本站獨占握手，不把說明文字當成脆弱錨點。
    const introFrom = src.slice(introAt, configAt + configAnchor.length);
    const introKeep = src.slice(introAt, configAt).trimEnd();
    src = replaceOne(
      src,
      introFrom,
      introKeep + "\n" +
      "  " + MARKER + "\n" +
      "  // 嚴格互斥：afk-offline-owner 必須先確認 PP／原版沒有另一套離線鉤子，舊引擎才可啟動。\n" +
      "  // 快取混搭或未來 PP 重啟另一套結算時 fail closed，寧可本次不發獎也不重複結算。\n" +
      "  if (window.__afkLegacyOfflineOwnsSettlement !== true) {\n" +
      "    console.warn('[AFK] 未取得離線引擎獨占標記，為避免重複結算，本次停用離線掛機。');\n" +
      "    return;\n" +
      "  }\n\n" +
      "  // ----- 可調參數 ---------------------------------------------------------\n" +
      "  var ENGINE_REV       = 3;                       // 遷移版本：沿用既有站台標記，不因本次 PP 升版重跑首次遷移\n" +
      "  var MIGRATION_PREFIX = 'afk_offline_legacy_migrated_v' + ENGINE_REV + '_';\n" +
      "  var CAP_HOURS",
      OFFLINE_FILE,
      '獨占握手與遷移版本'
    );

    src = replaceOne(
      src,
      "  function oblKey()     { return 'afk_obl_' + currentSlot; }\n  function readTs()",
      "  function oblKey()     { return 'afk_obl_' + currentSlot; }\n" +
      "  function migrationKey(slot) { return MIGRATION_PREFIX + (slot == null ? currentSlot : slot); }\n" +
      "  function migrationDone(slot) { try { return localStorage.getItem(migrationKey(slot)) === '1'; } catch (e) { return false; } }\n" +
      "  function markMigrationDone(slot) { try { localStorage.setItem(migrationKey(slot), '1'); return true; } catch (e) { return false; } }\n" +
      "  function blockedInstanceMap(map) {\n" +
      "    map = String(map || '');\n" +
      "    return /^antharas_(?:nest_[123]|lair)$/.test(map) || /^siege_v2_/.test(map);\n" +
      "  }\n" +
      "  function readTs()",
      OFFLINE_FILE,
      '遷移與特殊副本 helper'
    );

    const offStatsVersionAnchors = [
      "      return ['v2', mapState.current, player.lv, player.sherineWorld ? 1 : 0, player.sherineMad ? 1 : 0,",
      "      return ['v3', mapState.current, player.lv, player.sherineWorld ? 1 : 0, player.sherineMad ? 1 : 0,",
    ];
    const offStatsVersionMatches = offStatsVersionAnchors.filter(anchor => src.includes(anchor));
    if (offStatsVersionMatches.length !== 1) {
      throw new Error(`[${OFFLINE_FILE}] 「離線取樣快取版本」錨點數量錯誤：${offStatsVersionMatches.length}`);
    }
    src = replaceOne(
      src,
      offStatsVersionMatches[0],
      "      return ['v4', mapState.current, player.lv, player.sherineWorld ? 1 : 0, player.sherineMad ? 1 : 0,",
      OFFLINE_FILE,
      '離線取樣快取版本'
    );

    src = replaceOne(
      src,
      "    // 🌑 黑暗妖精聖地兩間純 BOSS 房（吉爾塔斯／冥皇丹特斯）：比照「離線＝線上照跑」，照常結算——",
      "    if (blockedInstanceMap(savedMap)) {\n" +
      "      // 安塔瑞斯／攻城 V2 的關卡狀態不是一般狩獵圖持久資料；離線視同離場，避免繞過副本流程刷收益。\n" +
      "      var blockedName = /^siege_v2_/.test(savedMap) ? '攻城戰 V2' : '侵蝕的安塔瑞斯巢穴';\n" +
      "      console.info('[AFK] 上次位於' + blockedName + '：特殊副本不支援離線結算。');\n" +
      "      skipNote('上次位於「' + blockedName + '」特殊副本：離線視同離場，期間不結算戰鬥收益。');\n" +
      "      return;\n" +
      "    }\n" +
      "    // 🌑 黑暗妖精聖地兩間純 BOSS 房（吉爾塔斯／冥皇丹特斯）：比照「離線＝線上照跑」，照常結算——",
      OFFLINE_FILE,
      '特殊副本禁用清單'
    );

    src = replaceOne(
      src,
      "  window.offlinePreLoad = function () {\n    var map = readMap();",
      "  window.offlinePreLoad = function () {\n" +
      "    // 從其他離線機制切回本引擎時，舊 afk_ts_/afk_map_ 可能已凍結很久；首次載入只建立安全起點。\n" +
      "    if (!migrationDone()) return { map: '', ts: 0, pride: null, obl: null, migration: true };\n" +
      "    var map = readMap();",
      OFFLINE_FILE,
      '首次遷移 preload'
    );

    src = replaceOne(
      src,
      "  window.offlineAfterLoad = function (pre) {\n    if (!pre) return;\n    try { maybeCatchup",
      "  window.offlineAfterLoad = function (pre) {\n" +
      "    if (!pre) return;\n" +
      "    if (pre.migration) {\n" +
      "      if (!validSlot() || !state || !state.running || !player || !player.cls) return;\n" +
      "      markMigrationDone();\n" +
      "      stamp();\n" +
      "      console.info('[AFK] 已完成存檔位 ' + currentSlot + ' 的離線引擎安全遷移；從本次登入重新計時。');\n" +
      "      try { if (typeof logSys === 'function') logSys('<span class=\"text-cyan-300\">離線掛機已建立新的安全起點，從本次登入重新計時。</span>'); } catch (e) {}\n" +
      "      return;\n" +
      "    }\n" +
      "    try { maybeCatchup",
      OFFLINE_FILE,
      '首次遷移 afterLoad'
    );

    src = replaceOne(
      src,
      "    version: '2.0.0',   // 2.x=核心版(js/offline.js);1.x=外掛版(afk-offline.js,已退役)\n    capHours: CAP_HOURS,\n    stamp: stamp,\n    readTs: readTs,",
      "    version: '2.2.0-jesper-safety',\n" +
      "    engineRev: ENGINE_REV,\n" +
      "    capHours: CAP_HOURS,\n" +
      "    stamp: stamp,\n" +
      "    readTs: readTs,\n" +
      "    isCatchingUp: function () { return catchingUp; },\n" +
      "    migrationKeyFor: migrationKey,\n" +
      "    migrationDoneFor: migrationDone,\n" +
      "    blockedInstanceMap: blockedInstanceMap,",
      OFFLINE_FILE,
      '除錯介面安全資訊'
    );
  }

  if (!src.includes(OFFSTATS_MARKER)) {
    src = replaceOne(
      src,
      "  async function runCatchup",
      "  " + OFFSTATS_MARKER + "\n" +
      "  // 快取必須隨真正影響戰力的資料失效。舊簽章只有地圖/等級/裝備 id+強化，會漏掉\n" +
      "  // 配點、自動技能、套裝詞綴、傭兵與寵物；內容更新後甚至可能沿用舊版殺速與 BOSS 結果。\n" +
      "  var OFFSTATS_SCHEMA = 2;\n" +
      "  var OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r2-bossring';\n" +
      "  function offStatsStable(v) {\n" +
      "    if (v == null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;\n" +
      "    if (Array.isArray(v)) return v.map(offStatsStable);\n" +
      "    if (typeof v !== 'object') return null;\n" +
      "    var out = {};\n" +
      "    Object.keys(v).sort().forEach(function (k) {\n" +
      "      var x = v[k];\n" +
      "      if (typeof x === 'function' || typeof x === 'undefined') return;\n" +
      "      out[k] = offStatsStable(x);\n" +
      "    });\n" +
      "    return out;\n" +
      "  }\n" +
      "  function offStatsItem(it) {\n" +
      "    if (!it || !it.id) return null;\n" +
      "    var skip = { uid:1, cnt:1, lock:1, junk:1, junkSince:1, _autoSellQty:1, _ruleJunk:1, _userKeep:1, src:1, source:1 };\n" +
      "    var out = {};\n" +
      "    Object.keys(it).sort().forEach(function (k) {\n" +
      "      if (skip[k] || typeof it[k] === 'function' || typeof it[k] === 'undefined') return;\n" +
      "      out[k] = offStatsStable(it[k]);\n" +
      "    });\n" +
      "    return out;\n" +
      "  }\n" +
      "  function offStatsEq(eq) {\n" +
      "    var out = {};\n" +
      "    Object.keys(eq || {}).sort().forEach(function (slot) {\n" +
      "      var sig = offStatsItem(eq[slot]); if (sig) out[slot] = sig;\n" +
      "    });\n" +
      "    return out;\n" +
      "  }\n" +
      "  function offStatsActor(a) {\n" +
      "    if (!a) return null;\n" +
      "    return offStatsStable({\n" +
      "      cls:a.cls || '', lv:a.lv || 1, base:a.base || {}, d:a.d || {}, skills:a.skills || [],\n" +
      "      grantedSkills:a.grantedSkills || [], config:a.config || {}, eq:offStatsEq(a.eq),\n" +
      "      atkSkill:a._atkSkill || '', healSkill:a._healSkill || '', convertSkill:a._convertSkill || '',\n" +
      "      summon:a.summon || null, slot:a._slot || ''\n" +
      "    });\n" +
      "  }\n" +
      "  function offStatsPet(p) {\n" +
      "    if (!p) return null;\n" +
      "    return offStatsStable({ form:p.form || '', lv:p.lv || 1, d:p.d || {}, eq:offStatsEq(p.eq), outSlot:p.outSlot || '' });\n" +
      "  }\n" +
      "  function offStatsHash(text) {\n" +
      "    var h = 2166136261;\n" +
      "    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }\n" +
      "    return (h >>> 0).toString(36);\n" +
      "  }\n" +
      "  function offStatsSig() {\n" +
      "    var pets = [];\n" +
      "    try { if (typeof petsOutList === 'function') pets = petsOutList().map(offStatsPet); } catch (e) {}\n" +
      "    var payload = {\n" +
      "      schema:OFFSTATS_SCHEMA, ruleset:OFFSTATS_RULESET,\n" +
      "      game:(typeof GAME_VERSION !== 'undefined' ? GAME_VERSION : ''), map:mapState.current,\n" +
      "      modes:[!!player.sherineWorld, !!player.sherineMad, !!player.classicMode, !!player.traditionalMode],\n" +
      "      player:offStatsActor(player), allies:(player.allies || []).map(offStatsActor), pets:pets\n" +
      "    };\n" +
      "    return 'v5|' + offStatsHash(JSON.stringify(offStatsStable(payload)));\n" +
      "  }\n" +
      "  async function runCatchup",
      OFFLINE_FILE,
      '離線取樣快取完整簽章 helper'
    );

    const oldSigStart = src.indexOf('    function offStatsSig() {');
    const oldSigEnd = src.indexOf('    function saveOffStats()', oldSigStart);
    if (oldSigStart < 0 || oldSigEnd < 0 ||
        src.indexOf('    function offStatsSig() {', oldSigStart + 1) >= 0 ||
        src.indexOf('    function saveOffStats()', oldSigEnd + 1) >= 0) {
      throw new Error(`[${OFFLINE_FILE}] 「離線取樣快取舊簽章移除」錨點不唯一或順序失效。`);
    }
    src = replaceOne(
      src,
      src.slice(oldSigStart, oldSigEnd),
      '',
      OFFLINE_FILE,
      '離線取樣快取舊簽章移除'
    );

    src = replaceOne(
      src,
      'player._offStats = { v: 1, sig: offStatsSig(),',
      'player._offStats = { v: OFFSTATS_SCHEMA, sig: offStatsSig(),',
      OFFLINE_FILE,
      '離線取樣快取 schema 寫入'
    );

    src = replaceOne(
      src,
      'player._offStats && player._offStats.v === 1 && player._offStats.svcE > 0',
      'player._offStats && player._offStats.v === OFFSTATS_SCHEMA && player._offStats.svcE > 0',
      OFFLINE_FILE,
      '離線取樣快取 schema 讀取'
    );

    src = replaceOne(
      src,
      '    blockedInstanceMap: blockedInstanceMap,\n    mapName: mapName,',
      '    blockedInstanceMap: blockedInstanceMap,\n' +
      '    offStatsSchema: OFFSTATS_SCHEMA,\n' +
      '    offStatsRuleset: OFFSTATS_RULESET,\n' +
      '    offStatsSignature: offStatsSig,\n' +
      '    mapName: mapName,',
      OFFLINE_FILE,
      '離線取樣快取除錯介面'
    );
  }

  if (!src.includes(OFFLINE_BOSSRING_MARKER)) {
    if (src.includes("OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r1'")) {
      src = replaceOne(
        src,
        "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r1'",
        "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r2-bossring'",
        OFFLINE_FILE,
        '離線快取規則版'
      );
    }

    src = replaceOne(
      src,
      "  function offStatsSig() {\n",
      "  " + OFFLINE_BOSSRING_MARKER + "\n" +
      "  function offlineBossHuntApi() {\n" +
      "    try { return window.AFK_BOSSRING || null; } catch (e) { return null; }\n" +
      "  }\n" +
      "  function offlineBossHuntActive() {\n" +
      "    var api = offlineBossHuntApi();\n" +
      "    try { return !!(api && typeof api.huntActive === 'function' && api.huntActive()); } catch (e) { return false; }\n" +
      "  }\n" +
      "  function offlineBossHuntStep(remainingTicks) {\n" +
      "    var api = offlineBossHuntApi();\n" +
      "    try { return (api && typeof api.offlineStep === 'function') ? api.offlineStep(remainingTicks) : 'unavailable'; }\n" +
      "    catch (e) { console.warn('[AFK] 離線自動找 BOSS 步驟失敗，本次略過：', e); return 'error'; }\n" +
      "  }\n" +
      "  function offlineBossHuntSignature() {\n" +
      "    var api = offlineBossHuntApi();\n" +
      "    try { return (api && typeof api.signature === 'function') ? api.signature() : { on:false, ring:false, unavailable:true }; }\n" +
      "    catch (e) { return { on:false, ring:false, error:true }; }\n" +
      "  }\n" +
      "  function offStatsSig() {\n",
      OFFLINE_FILE,
      '離線召王橋接 helper'
    );

    src = replaceOne(
      src,
      "      modes:[!!player.sherineWorld, !!player.sherineMad, !!player.classicMode, !!player.traditionalMode],\n" +
      "      player:offStatsActor(player), allies:(player.allies || []).map(offStatsActor), pets:pets",
      "      modes:[!!player.sherineWorld, !!player.sherineMad, !!player.classicMode, !!player.traditionalMode],\n" +
      "      bossring:offlineBossHuntSignature(),\n" +
      "      player:offStatsActor(player), allies:(player.allies || []).map(offStatsActor), pets:pets",
      OFFLINE_FILE,
      '離線快取納入召王設定與戒指'
    );

    src = replaceOne(
      src,
      "        if (!(d.type === 'pot' || d.type === 'scroll' || d.isArrow)) continue;\n" +
      "        var used =",
      "        if (!(d.type === 'pot' || d.type === 'scroll' || d.isArrow)) continue;\n" +
      "        // 自動找王每次都由 offlineStep 精確呼叫 useItem 扣 1 張；不可再按取樣耗率重複扣帳。\n" +
      "        if (k === 'scroll_teleport' && offlineBossHuntActive()) continue;\n" +
      "        var used =",
      OFFLINE_FILE,
      '召王卷軸避免雙重扣帳'
    );

    src = replaceOne(
      src,
      "    function fastTeleportAwayBoss(m) {   // 🌀 快速段模擬「遇 BOSS 自動瞬移逃離」:1:1 重放線上 autoActions 的瞬移分支;成功甩掉回 true\n" +
      "      try {\n" +
      "        var tChk",
      "    function fastTeleportAwayBoss(m) {   // 🌀 快速段模擬「遇 BOSS 自動瞬移逃離」:1:1 重放線上 autoActions 的瞬移分支;成功甩掉回 true\n" +
      "      try {\n" +
      "        if (offlineBossHuntActive()) return false;   // 自動找王啟用時王是目標，不可召來後又自動逃離\n" +
      "        var tChk",
      OFFLINE_FILE,
      '快速段召王與避王互斥'
    );

    src = replaceOne(
      src,
      "    function fastEventStep() {   // ⚡ 事件驅動快速段的一步:原作排程出怪 → 殺「最早出生」那隻(或推進到下一個出怪時點);回 false = 退回全模擬\n" +
      "      try {\n" +
      "        maybeSpawnMobs();",
      "    function fastEventStep() {   // ⚡ 事件驅動快速段的一步:原作排程出怪 → 殺「最早出生」那隻(或推進到下一個出怪時點);回 false = 退回全模擬\n" +
      "      try {\n" +
      "        offlineBossHuntStep(totalTicks - done);   // 快速段不跑 autoActions／真實 timer，依虛擬事件主動召王\n" +
      "        maybeSpawnMobs();",
      OFFLINE_FILE,
      '快速段驅動離線召王'
    );

    src = replaceOne(
      src,
      "              tick();\n" +
      "              settleDeadMobs();\n" +
      "              done++; _realSimTicks++;\n" +
      "              var _hpB",
      "              tick();\n" +
      "              settleDeadMobs();\n" +
      "              done++; _realSimTicks++;\n" +
      "              if (state.ticks % 10 === 0) offlineBossHuntStep(totalTicks - done);\n" +
      "              var _hpB",
      OFFLINE_FILE,
      'BOSS 真打段驅動離線召王'
    );

    src = replaceOne(
      src,
      "          tick();\n" +
      "          settleDeadMobs();\n" +
      "          done++; _realSimTicks++;\n" +
      "          if (fastEligible",
      "          tick();\n" +
      "          settleDeadMobs();\n" +
      "          done++; _realSimTicks++;\n" +
      "          if (state.ticks % 10 === 0) offlineBossHuntStep(totalTicks - done);\n" +
      "          if (fastEligible",
      OFFLINE_FILE,
      '全模擬與取樣段驅動離線召王'
    );
  }

  src = patchRiftOffline(src);
  src = convergeRiftOffline(src);
  src = convergeCheckpointCommit(src);
  src = convergeSaveUnwrapBudget(src);

  // v1/r3 是 2026-07-31 的保守止血版（瘋狂席琳每隻王都逐拍）。先精確還原成
  // r2 共同基線，再套 v2；如此本腳本同時支援「目前工作樹」與「下次從乾淨 PP 同步」。
  if (src.includes(OLD_CRAZY_BOSS_CACHE_MARKER) && !src.includes(CRAZY_BOSS_CACHE_MARKER)) {
    src = replaceOne(src,
      "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r3-grace-boss'",
      "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r2-bossring'",
      OFFLINE_FILE, '舊瘋狂席琳規則版還原');
    src = replaceOne(src,
      "    " + OLD_CRAZY_BOSS_CACHE_MARKER + "\n" +
      "    // 瘋狂席琳的 BOSS 可能在對打途中才被恩賜並回滿、HP×10；名稱快取無法表示轉變時點。\n" +
      "    // 因此只讓 BOSS 逐拍真打，小怪與其他快速統計仍照常使用快取。\n" +
      "    var bossCacheEnabled = !player.sherineMad;\n",
      "",
      OFFLINE_FILE, '舊瘋狂席琳總閘還原');
    src = replaceOne(src,
      "boss: bossCacheEnabled ? bossStats : {}",
      "boss: bossStats",
      OFFLINE_FILE, '舊瘋狂席琳儲存閘還原');
    src = replaceOne(src,
      "      if (bossCacheEnabled) bossStats = player._offStats.boss || {};\n" +
      "      else { bossStats = {}; player._offStats.boss = {}; }   // 清掉同規則版中任何意外殘留的污染值\n",
      "      bossStats = player._offStats.boss || {};\n",
      OFFLINE_FILE, '舊瘋狂席琳載入閘還原');
    src = replaceOne(src,
      "          var _bs = bossCacheEnabled ? bossStats[_m0.n] : null;",
      "          var _bs = bossStats[_m0.n];",
      OFFLINE_FILE, '舊瘋狂席琳讀取閘還原');
    src = replaceOne(src,
      "          console.info('[AFK] ⚔ 快速結算遇到 BOSS「' + fastBossName + '」(' + (!bossCacheEnabled ? '瘋狂席琳,每隻皆實測' : (_bs && _bs.safe ? '抽驗' : '首次')) + ')→ 切回真模擬對打' + (!bossCacheEnabled ? ',本模式不寫入 BOSS 快取。' : ',倒下後同名 BOSS 才可快轉。'));",
      "          console.info('[AFK] ⚔ 快速結算遇到 BOSS「' + fastBossName + '」(' + (_bs && _bs.safe ? '抽驗' : '首次') + ')→ 切回真模擬對打,倒下後同名 BOSS 才可快轉。');",
      OFFLINE_FILE, '舊瘋狂席琳日誌還原');
    src = replaceOne(src,
      "                if (bossCacheEnabled) {\n" +
      "                  var _prevB = bossStats[fastBossName];\n" +
      "                  // 🐲 移動平均:抽驗(已有安全實測)→ 與舊值各半混合;首次/上次不安全 → 直接採用本次。\n" +
      "                  //   單一樣本的對打耗時變異極大,平均化避免一次幸運/倒楣樣本外推整晚。\n" +
      "                  bossStats[fastBossName] = (_prevB && _prevB.safe && _safeB)\n" +
      "                    ? { ticks: (_prevB.ticks + _durB) / 2, safe: true, minor: Math.round(((_prevB.minor || 0) + _minorB) / 2) }\n" +
      "                    : { ticks: _durB, safe: _safeB, minor: _minorB };\n" +
      "                  saveOffStats();   // 💾 新量到的 BOSS 實測 → 更新統計快取(下次同簽章連首打都免)\n" +
      "                }\n" +
      "                console.info('[AFK] ⚔ BOSS「' + fastBossName + '」倒下:實測 ' + Math.round(_durB) + ' 拍、同場小怪 ' + _minorB + ' 隻' + (!bossCacheEnabled ? ',瘋狂席琳模式不快取 BOSS,下一隻仍逐拍真打。' : (_safeB ? ',之後同名 BOSS 即殺、時間按實測(移動平均)推進並補回小怪。' : ',對打時血量偏低(' + Math.round(fastBossMinHp * 100) + '%) → 之後每次都真打。')));",
      "                var _prevB = bossStats[fastBossName];\n" +
      "                // 🐲 移動平均:抽驗(已有安全實測)→ 與舊值各半混合;首次/上次不安全 → 直接採用本次。\n" +
      "                //   單一樣本的對打耗時變異極大,平均化避免一次幸運/倒楣樣本外推整晚。\n" +
      "                bossStats[fastBossName] = (_prevB && _prevB.safe && _safeB)\n" +
      "                  ? { ticks: (_prevB.ticks + _durB) / 2, safe: true, minor: Math.round(((_prevB.minor || 0) + _minorB) / 2) }\n" +
      "                  : { ticks: _durB, safe: _safeB, minor: _minorB };\n" +
      "                saveOffStats();   // 💾 新量到的 BOSS 實測 → 更新統計快取(下次同簽章連首打都免)\n" +
      "                console.info('[AFK] ⚔ BOSS「' + fastBossName + '」倒下:實測 ' + Math.round(_durB) + ' 拍、同場小怪 ' + _minorB + ' 隻' + (_safeB ? ',之後同名 BOSS 即殺、時間按實測(移動平均)推進並補回小怪。' : ',對打時血量偏低(' + Math.round(fastBossMinHp * 100) + '%) → 之後每次都真打。'));",
      OFFLINE_FILE, '舊瘋狂席琳寫入閘還原');
  }

  if (!src.includes(CRAZY_BOSS_CACHE_MARKER)) {
    const ppR2VarianceComment = '                //   單一樣本的對打耗時變異極大(同 BOSS 27 vs 316 拍),平均化避免一次幸運/倒楣樣本外推整晚。';
    const normalizedVarianceComment = '                //   單一樣本的對打耗時變異極大,平均化避免一次幸運/倒楣樣本外推整晚。';
    if (src.includes(ppR2VarianceComment)) {
      src = replaceOne(src, ppR2VarianceComment, normalizedVarianceComment, OFFLINE_FILE, 'PP r2 BOSS 樣本註解相容');
    }
    const bossEventHelpers = `    ${CRAZY_BOSS_CACHE_MARKER}
    // 瘋狂席琳：普通／恩賜各存一份完整樣本。重播只跳「小怪死亡／核心出怪／階段結束」
    // 三種事件；spawn 仍唯一走 maybeSpawnMobs→spawnMob→applySherineGrace，不自行擲 1%。
    var fastBossVariant = 'normal', fastBossPhaseTick = 0, fastBossEvents = [], fastBossActualKill = false, fastBossReplay = null;
    function bossFind(uid) {
      for (var i = 0; i < mapState.mobs.length; i++) { var m = mapState.mobs[i]; if (m && m.uid === uid) return m; }
      return null;
    }
    function bossCacheEntry(name) {
      var row = bossStats[name];
      if (!row || typeof row !== 'object' || !Object.prototype.hasOwnProperty.call(row, 'normal') || !Object.prototype.hasOwnProperty.call(row, 'grace')) {
        row = bossStats[name] = { normal: null, grace: null };
      }
      return row;
    }
    function bossProfileEvents(events) {
      var rows = [], i;
      for (i = 0; i < (events || []).length; i++) {
        var e = events[i], p = Math.max(1, Math.min(1000, Math.round(Number(e && e[0]) || 0))), c = Math.max(0, Math.round(Number(e && e[1]) || 0));
        if (c > 0) rows.push([p, c]);
      }
      rows.sort(function (a, b) { return a[0] - b[0]; });
      var out = [];
      for (i = 0; i < rows.length; i++) {
        var last = out[out.length - 1];
        if (last && last[0] === rows[i][0]) last[1] += rows[i][1]; else out.push(rows[i]);
      }
      return out;
    }
    function bossEventMinorCount(events) {
      var n = 0; for (var i = 0; i < (events || []).length; i++) n += Math.max(0, Number(events[i] && events[i][1]) || 0); return Math.round(n);
    }
    function bossMergeProfile(prev, ticks, safe, events) {
      var ev = bossProfileEvents(events), dur = Math.max(1, Number(ticks) || 1);
      if (prev && prev.safe && safe && Number(prev.ticks) > 0) dur = (Number(prev.ticks) + dur) / 2;
      return { ticks: dur, safe: !!safe, minor: bossEventMinorCount(ev), events: ev };
    }
    function bossNormalizeEvents(raw, ticks) {
      var dur = Math.max(1, Number(ticks) || 1), out = [];
      for (var i = 0; i < (raw || []).length; i++) {
        var e = raw[i], at = Math.max(1, Number(e && e[0]) || 1), count = Math.max(0, Math.round(Number(e && e[1]) || 0));
        if (count > 0) out.push([Math.max(1, Math.min(1000, Math.round(at * 1000 / dur))), count]);
      }
      return bossProfileEvents(out);
    }
    function bossProfileUsable(profile) {
      if (!profile || !profile.safe || !(Number(profile.ticks) > 0) || !isFinite(Number(profile.ticks))) return false;
      var ev = bossProfileEvents(profile.events);
      return bossEventMinorCount(ev) === Math.max(0, Math.round(Number(profile.minor) || 0));
    }
    function bossRecordMinorKill(mob) {
      if (fastBossUid == null || !mob || mob.boss || !mob._dead) return;
      var at = Math.max(1, (Number(state.ticks) || 0) - fastBossPhaseTick), last = fastBossEvents[fastBossEvents.length - 1];
      if (last && last[0] === at) last[1]++; else fastBossEvents.push([at, 1]);
    }
    function bossMarkGraceTransition() {
      if (fastBossUid == null || fastBossVariant !== 'normal') return false;
      var boss = bossFind(fastBossUid);
      if (!boss || !boss._grace) return false;
      fastBossVariant = 'grace';
      fastBossStart = done;                         // spawn 發生於本拍攻擊前；本拍完整算進 grace
      fastBossPhaseTick = Math.max(0, (Number(state.ticks) || 0) - 1);
      fastBossMinHp = (player.mhp > 0) ? (player.hp / player.mhp) : 1;
      fastBossKills0 = tallySum(killTally);
      fastBossEvents = [];                          // normal 是截尾樣本，整段丟棄
      console.info('[AFK] ⚔ BOSS「' + fastBossName + '」對打途中取得席琳恩賜；普通樣本作廢，改從回滿當刻量 grace。');
      return true;
    }
    function beginBossTrue(mob, variant, reason) {
      fastBossReplay = null;
      fastBossUid = mob.uid; fastBossName = mob.n || '?'; fastBossVariant = variant || (mob._grace ? 'grace' : 'normal');
      fastBossStart = done; fastBossPhaseTick = Number(state.ticks) || 0; fastBossMinHp = (player.mhp > 0) ? (player.hp / player.mhp) : 1;
      fastBossKills0 = tallySum(killTally); fastBossEvents = []; fastBossActualKill = false;
      console.info('[AFK] ⚔ 快速結算遇到 BOSS「' + fastBossName + '」(' + fastBossVariant + ' ' + (reason || '首次') + ')→ 切回真模擬對打。');
    }
    function beginBossReplay(mob, variant, profile, reason) {
      fastBossUid = null;
      fastBossReplay = {
        uid: mob.uid, name: mob.n || '?', variant: variant, profile: profile,
        startDone: done, deadline: done + Math.max(1, Number(profile.ticks) || 1),
        events: bossProfileEvents(profile.events), eventIndex: 0, pumpedTick: null
      };
      console.info('[AFK] ⚡ BOSS「' + fastBossReplay.name + '」使用 ' + variant + ' 事件快取' + (reason ? '(' + reason + ')' : '') + '。');
      return fastBossReplay;
    }
    function bossReplayEventDone(replay) {
      var e = replay.events[replay.eventIndex];
      return e ? replay.startDone + Math.max(1, Math.round(Number(replay.profile.ticks) * e[0] / 1000)) : Infinity;
    }
    function bossReplayNextSpawnDone() {
      var next = Infinity, hasEmptyUnscheduled = false;
      var pureBoss = PURE_BOSS_MAPS.includes(mapState.current) && !KING_ROOMS[mapState.current];
      var slotCount = (typeof backSlotsActive === 'function' && backSlotsActive()) ? 5 : 3;
      for (var i = 0; i < slotCount; i++) {
        if (pureBoss && i !== 1) continue;           // 核心純 Boss 圖只會排中央格；其餘永久空格不是待出怪事件
        if (!mapState.mobs[i] && (!mapState.spawnAt || mapState.spawnAt[i] == null)) hasEmptyUnscheduled = true;
        var at = mapState.spawnAt && mapState.spawnAt[i];
        if (at != null && Number(at) < next) next = Number(at);
      }
      if (hasEmptyUnscheduled) return done + 1;       // 對齊 tick：死亡後下一拍才由核心排重生
      return isFinite(next) ? done + Math.max(0, next - (Number(state.ticks) || 0)) : Infinity;
    }
    function bossReplaySwitchGrace(replay, boss) {
      fastBossReplay = null;
      var grace = bossCacheEntry(replay.name).grace;
      if (bossProfileUsable(grace) && Math.random() >= BOSS_REVERIFY_P) {
        var graceReplay = beginBossReplay(boss, 'grace', grace, '途中恩賜');
        // spawn 發生於本拍攻擊前；真打樣本把這一拍完整算進 grace。
        // normal 重播已跳到本拍，故 grace 起點回推一拍，並標記本拍已 pump，避免重複出怪。
        graceReplay.startDone = Math.max(replay.startDone, done - 1);
        graceReplay.deadline = graceReplay.startDone + Math.max(1, Number(grace.ticks) || 1);
        graceReplay.pumpedTick = state.ticks;
      } else beginBossTrue(boss, 'grace', bossProfileUsable(grace) ? '獨立抽驗' : '首次');
    }
    function bossReplayStep() {
      var replay = fastBossReplay, guard = 0;
      if (!replay) return true;
      while (fastBossReplay === replay && done <= totalTicks && guard++ < 20000) {
        var boss = bossFind(replay.uid);
        if (!boss || boss._dead) { fastBossReplay = null; console.warn('[AFK] BOSS 事件重播目標消失，未補擊殺、未寫快取。'); return true; }
        if (replay.variant === 'normal' && boss._grace) { bossReplaySwitchGrace(replay, boss); return true; }

        if (replay.pumpedTick !== state.ticks) {
          offlineBossHuntStep(totalTicks - done);
          maybeSpawnMobs();                            // 唯一出怪／唯一恩賜 RNG 路徑
          replay.pumpedTick = state.ticks;
          boss = bossFind(replay.uid);
          if (!boss || boss._dead) { fastBossReplay = null; return true; }
          if (replay.variant === 'normal' && boss._grace) { bossReplaySwitchGrace(replay, boss); return true; }
        }

        var eventDone = bossReplayEventDone(replay);
        if (eventDone <= done + 0.0001) {
          var event = replay.events[replay.eventIndex++], count = event[1];
          for (var k = 0; k < count; k++) {
            var idx = -1, born = Infinity;
            for (var i = 0; i < mapState.mobs.length; i++) {
              var minor = mapState.mobs[i];
              if (minor && !minor._dead && !minor.boss && (minor._born || 0) < born) { idx = i; born = minor._born || 0; }
            }
            if (idx < 0) { fastBossReplay = null; beginBossTrue(boss, replay.variant, '事件場面偏移'); return true; }
            killMob(idx); settleDeadMobs();            // 小怪獎勵照正式管線；空格下一虛擬拍再排程
          }
          continue;
        }

        if (done + 0.0001 >= replay.deadline) {
          var bossIdx = -1;
          for (var bi = 0; bi < mapState.mobs.length; bi++) if (mapState.mobs[bi] && mapState.mobs[bi].uid === replay.uid) { bossIdx = bi; break; }
          if (bossIdx < 0) { fastBossReplay = null; return true; }
          if (replay.variant === 'normal' && mapState.mobs[bossIdx]._grace) { bossReplaySwitchGrace(replay, mapState.mobs[bossIdx]); return true; }
          killMob(bossIdx); settleDeadMobs(); maybeSpawnMobs();   // 最終擊殺仍走真實掉落／任務／tally
          fastBossReplay = null;
          return true;
        }

        var nextDone = Math.min(replay.deadline, eventDone, bossReplayNextSpawnDone());
        if (nextDone > totalTicks || (nextDone >= totalTicks && replay.deadline > totalTicks)) { beginBossTrue(boss, replay.variant, '離線尾段'); return true; }
        var adv = nextDone - done;
        if (!(adv > 0)) adv = Math.min(1, replay.deadline - done);
        if (!(adv > 0)) continue;
        if (!fastAdvance(adv)) { fastBossReplay = null; return false; }
      }
      if (guard >= 20000) { fastBossReplay = null; console.warn('[AFK] BOSS 事件重播超過安全步數，退回真模擬。'); return false; }
      return true;
    }
    _bossTraceKillHook = function (mob) { bossRecordMinorKill(mob); if (fastBossUid != null && mob && mob.uid === fastBossUid && mob._dead) fastBossActualKill = true; };
    _bossTraceSpawnHook = function () { bossMarkGraceTransition(); };`;

    src = replaceOne(src,
      "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r2-bossring'",
      "OFFSTATS_RULESET = 'pp-v3.8.34+shines-v3.8.27-content-r4-grace-events'",
      OFFLINE_FILE, '瘋狂席琳事件快取規則版');
    src = replaceOne(src,
      "  var _saveSquelch = false;\n",
      "  var _saveSquelch = false;\n" +
      "  var _bossTraceKillHook = null, _bossTraceSpawnHook = null;   // 瘋狂席琳 BOSS 真打樣本；線上時皆為 null\n",
      OFFLINE_FILE, 'BOSS 事件追蹤掛點');
    const bossStateLines = [
      "    var fastBossUid = null, fastBossName = '', fastBossStart = 0, fastBossMinHp = 1, fastBossKills0 = 0;\n",
      "    var fastBossUid = null, fastBossName = '', fastBossStart = 0, fastBossMinHp = 1, fastBossKills0 = 0, fastBossOwnKills0 = 0;\n"
    ];
    const bossStateMatches = bossStateLines.filter(line => src.includes(line + "    var BOSS_REVERIFY_P = 0.05;"));
    if (bossStateMatches.length !== 1) {
      throw new Error(`[${OFFLINE_FILE}] 「瘋狂席琳 BOSS 雙快取與事件重播 helper」錨點數量錯誤：${bossStateMatches.length}`);
    }
    src = replaceOne(src,
      bossStateMatches[0] + "    var BOSS_REVERIFY_P = 0.05;",
      bossStateMatches[0] + bossEventHelpers + "\n    var BOSS_REVERIFY_P = 0.05;",
      OFFLINE_FILE, '瘋狂席琳 BOSS 雙快取與事件重播 helper');

    src = replaceOne(src,
      "          var _bs = bossStats[_m0.n];\n" +
      "          if (_bs && _bs.safe && Math.random() >= BOSS_REVERIFY_P) {",
      "          var _bossVariant = (_m0._grace ? 'grace' : 'normal');\n" +
      "          var _bossEntry = player.sherineMad ? bossCacheEntry(_m0.n) : null;\n" +
      "          var _bs = player.sherineMad ? _bossEntry[_bossVariant] : bossStats[_m0.n];\n" +
      "          if (player.sherineMad && bossProfileUsable(_bs) && Math.random() >= BOSS_REVERIFY_P) {\n" +
      "            beginBossReplay(_m0, _bossVariant, _bs, '安全樣本');\n" +
      "            return true;\n" +
      "          }\n" +
      "          if (!player.sherineMad && _bs && _bs.safe && Math.random() >= BOSS_REVERIFY_P) {",
      OFFLINE_FILE, '瘋狂席琳 BOSS variant 快取選擇');
    const bossTrueStarts = [
      "          fastBossUid = _m0.uid; fastBossName = _m0.n || '?'; fastBossStart = done; fastBossMinHp = 1; fastBossKills0 = tallySum(killTally);   // 記真打起始殺數 → 倒下時算對戰期間清掉的小怪數\n" +
      "          console.info('[AFK] ⚔ 快速結算遇到 BOSS「' + fastBossName + '」(' + (_bs && _bs.safe ? '抽驗' : '首次') + ')→ 切回真模擬對打,倒下後同名 BOSS 才可快轉。');",
      "          fastBossUid = _m0.uid; fastBossName = _m0.n || '?'; fastBossStart = done; fastBossMinHp = 1; fastBossKills0 = tallySum(killTally);   // 記真打起始殺數 → 倒下時算對戰期間清掉的小怪數\n" +
      "          fastBossOwnKills0 = killTally[fastBossName] || 0;   // 這「種」BOSS 的起始擊殺數 → 收尾要靠它分辨「真的打死」與「只是不在場上」\n" +
      "          console.info('[AFK] ⚔ 快速結算遇到 BOSS「' + fastBossName + '」(' + (_bs && _bs.safe ? '抽驗' : '首次') + ')→ 切回真模擬對打,倒下後同名 BOSS 才可快轉。');"
    ];
    const bossTrueMatches = bossTrueStarts.filter(block => src.includes(block));
    if (bossTrueMatches.length !== 1) {
      throw new Error(`[${OFFLINE_FILE}] 「BOSS 真打 phase 初始化」錨點數量錯誤：${bossTrueMatches.length}`);
    }
    src = replaceOne(src, bossTrueMatches[0],
      "          beginBossTrue(_m0, _bossVariant, (_bs && _bs.safe ? '抽驗' : '首次'));",
      OFFLINE_FILE, 'BOSS 真打 phase 初始化');

    src = replaceOne(src,
      "            if (fastBossUid != null) {   // 🐲 BOSS 對打中:逐拍真模擬(死亡由外層撞死即停接手;打不動就照實耗完時間)\n" +
      "              tick();\n" +
      "              settleDeadMobs();\n" +
      "              done++; _realSimTicks++;",
      "            if (fastBossReplay) {   // 🔮 瘋狂席琳 BOSS：只跑出怪／小怪死亡事件，不逐拍攻防\n" +
      "              _fastEvents++;\n" +
      "              if (!bossReplayStep()) {\n" +
      "                if (_dryHit) { _dryHit = false; fastMode = false; sampleGrew = false; hpFloorFixed = true; sampleEnd = done + FAST_SAMPLE_TICKS; beginSample(done); }\n" +
      "                else { fastMode = false; fastOff = true; }\n" +
      "              }\n" +
      "              continue;\n" +
      "            }\n" +
      "            if (fastBossUid != null) {   // 🐲 BOSS 對打中:逐拍真模擬(死亡由外層撞死即停接手;打不動就照實耗完時間)\n" +
      "              tick();\n" +
      "              settleDeadMobs();\n" +
      "              done++; _realSimTicks++;",
      OFFLINE_FILE, 'BOSS 事件重播主迴圈');

    const bossSettlementSources = [
      "              if (!_bAlive) {   // BOSS 倒下(或場面被重置)→ 記錄實測耗時/安全度,回快速段\n" +
      "                fastBossUid = null;\n" +
      "                var _durB = Math.max(1, done - fastBossStart);\n" +
      "                var _safeB = fastBossMinHp >= hpFloorNow();   // 安全線跟取樣共用同一條門檻(隨存活時間降到 0):撐滿 20 分鐘後 BOSS 首遇打得贏就 safe → 秒殺\n" +
      "                var _minorB = Math.max(0, (tallySum(killTally) - fastBossKills0) - 1);   // 對戰期間總殺數 − BOSS 本身 1 = 同場被 AOE/傭兵/寵物清掉的小怪數\n" +
      "                var _prevB = bossStats[fastBossName];\n" +
      "                // 🐲 移動平均:抽驗(已有安全實測)→ 與舊值各半混合;首次/上次不安全 → 直接採用本次。\n" +
      "                //   單一樣本的對打耗時變異極大,平均化避免一次幸運/倒楣樣本外推整晚。\n" +
      "                bossStats[fastBossName] = (_prevB && _prevB.safe && _safeB)\n" +
      "                  ? { ticks: (_prevB.ticks + _durB) / 2, safe: true, minor: Math.round(((_prevB.minor || 0) + _minorB) / 2) }\n" +
      "                  : { ticks: _durB, safe: _safeB, minor: _minorB };\n" +
      "                saveOffStats();   // 💾 新量到的 BOSS 實測 → 更新統計快取(下次同簽章連首打都免)\n" +
      "                console.info('[AFK] ⚔ BOSS「' + fastBossName + '」倒下:實測 ' + Math.round(_durB) + ' 拍、同場小怪 ' + _minorB + ' 隻' + (_safeB ? ',之後同名 BOSS 即殺、時間按實測(移動平均)推進並補回小怪。' : ',對打時血量偏低(' + Math.round(fastBossMinHp * 100) + '%) → 之後每次都真打。'));\n" +
      "              }",
`              if (!_bAlive) {   // BOSS 離開場上 → 先分辨「真的被打死」還是「只是不在場上」,再決定要不要記統計
                fastBossUid = null;
                // 🌀 沒有經 killMob 死掉卻不在場上 = 被瞬移走(tick() 裡的 autoActions 迴避頭目)或場面被重置。
                //   不可當成「打贏了、而且只花這幾拍、血量沒掉=safe」記進 bossStats —— 那會讓之後同名 BOSS 全部走
                //   「即殺」路徑,玩家勾的迴避頭目變成「每隻都打死拿掉落」(踩過:3h 離線秒殺 188 隻死亡騎士,
                //   而且 safe 統計還會存進存檔,隔天連首打都省、整晚照殺)。這種情況不留任何統計,下次照樣先試瞬移。
                if ((killTally[fastBossName] || 0) <= fastBossOwnKills0) {
                  console.info('[AFK] ⚔ BOSS「' + fastBossName + '」未被擊殺就離開場上(瞬移逃離/場面重置)→ 不記錄對打統計,下次仍照迴避設定處理。');
                } else {
                  var _durB = Math.max(1, done - fastBossStart);
                  var _safeB = fastBossMinHp >= hpFloorNow();   // 安全線跟取樣共用同一條門檻(隨存活時間降到 0):撐滿 20 分鐘後 BOSS 首遇打得贏就 safe → 秒殺
                  var _minorB = Math.max(0, (tallySum(killTally) - fastBossKills0) - 1);   // 對戰期間總殺數 − BOSS 本身 1 = 同場被 AOE/傭兵/寵物清掉的小怪數
                  var _prevB = bossStats[fastBossName];
                  // 🐲 移動平均:抽驗(已有安全實測)→ 與舊值各半混合;首次/上次不安全 → 直接採用本次。
                  //   單一樣本的對打耗時變異極大,平均化避免一次幸運/倒楣樣本外推整晚。
                  bossStats[fastBossName] = (_prevB && _prevB.safe && _safeB)
                    ? { ticks: (_prevB.ticks + _durB) / 2, safe: true, minor: Math.round(((_prevB.minor || 0) + _minorB) / 2) }
                    : { ticks: _durB, safe: _safeB, minor: _minorB };
                  saveOffStats();   // 💾 新量到的 BOSS 實測 → 更新統計快取(下次同簽章連首打都免)
                  console.info('[AFK] ⚔ BOSS「' + fastBossName + '」倒下:實測 ' + Math.round(_durB) + ' 拍、同場小怪 ' + _minorB + ' 隻' + (_safeB ? ',之後同名 BOSS 即殺、時間按實測(移動平均)推進並補回小怪。' : ',對打時血量偏低(' + Math.round(fastBossMinHp * 100) + '%) → 之後每次都真打。'));
                }
              }`
    ];
    const bossSettlementMatches = bossSettlementSources.filter(block => src.includes(block));
    if (bossSettlementMatches.length !== 1) {
      throw new Error(`[${OFFLINE_FILE}] 「BOSS normal/grace 分槽寫回與擊殺證明」錨點數量錯誤：${bossSettlementMatches.length}`);
    }
    src = replaceOne(src, bossSettlementMatches[0],
      "              if (!_bAlive) {   // UID 消失不等於擊殺：只有 killMob hook 證明 _dead 才可寫完整樣本\n" +
      "                var _doneBossName = fastBossName, _doneBossVariant = fastBossVariant;\n" +
      "                var _durB = Math.max(1, done - fastBossStart);\n" +
      "                var _safeB = fastBossMinHp >= hpFloorNow();\n" +
      "                var _minorB = player.sherineMad ? bossEventMinorCount(fastBossEvents) : Math.max(0, (tallySum(killTally) - fastBossKills0) - 1);\n" +
      "                var _provedB = !!fastBossActualKill;\n" +
      "                fastBossUid = null;\n" +
      "                if (_provedB && player.sherineMad) {\n" +
      "                  var _entryB = bossCacheEntry(_doneBossName), _eventsB = bossNormalizeEvents(fastBossEvents, _durB);\n" +
      "                  _entryB[_doneBossVariant] = bossMergeProfile(_entryB[_doneBossVariant], _durB, _safeB, _eventsB);\n" +
      "                  saveOffStats();\n" +
      "                } else if (_provedB) {\n" +
      "                  var _prevB = bossStats[_doneBossName];\n" +
      "                  bossStats[_doneBossName] = (_prevB && _prevB.safe && _safeB)\n" +
      "                    ? { ticks: (_prevB.ticks + _durB) / 2, safe: true, minor: Math.round(((_prevB.minor || 0) + _minorB) / 2) }\n" +
      "                    : { ticks: _durB, safe: _safeB, minor: _minorB };\n" +
      "                  saveOffStats();\n" +
      "                }\n" +
      "                console.info('[AFK] ⚔ BOSS「' + _doneBossName + '」' + (_provedB ? ('倒下:' + _doneBossVariant + ' 實測 ' + Math.round(_durB) + ' 拍、同場小怪 ' + _minorB + ' 隻。') : '未經正式擊殺即離場，本次不寫快取。'));\n" +
      "              }",
      OFFLINE_FILE, 'BOSS normal/grace 分槽寫回與擊殺證明');

    src = replaceOne(src,
      "      _saveSquelch = false;                                // 保險:例外路徑也不可讓 saveGame 擋板卡住(否則之後線上全部存不了檔)\n",
      "      _saveSquelch = false;                                // 保險:例外路徑也不可讓 saveGame 擋板卡住(否則之後線上全部存不了檔)\n" +
      "      _bossTraceKillHook = null; _bossTraceSpawnHook = null; // BOSS 樣本 hook 絕不可洩漏到線上\n",
      OFFLINE_FILE, 'BOSS 事件追蹤 finally 還原');

    src = replaceOne(src,
      "      window.killMob = function (idx) {\n" +
      "        if (window.__afkKillTally) { try { var m = mapState.mobs[idx]; if (m && !m._dead && m.n) window.__afkKillTally[m.n] = (window.__afkKillTally[m.n] || 0) + 1; } catch (e) {} }\n" +
      "        return _km.apply(this, arguments);\n" +
      "      };",
      "      window.killMob = function (idx) {\n" +
      "        var _traceMob = null;\n" +
      "        try { _traceMob = mapState.mobs[idx] || null; } catch (e0) {}\n" +
      "        if (window.__afkKillTally) { try { var m = _traceMob; if (m && !m._dead && m.n) window.__afkKillTally[m.n] = (window.__afkKillTally[m.n] || 0) + 1; } catch (e) {} }\n" +
      "        var _kr = _km.apply(this, arguments);\n" +
      "        if (_bossTraceKillHook && _traceMob && _traceMob._dead) { try { _bossTraceKillHook(_traceMob); } catch (e1) {} }\n" +
      "        return _kr;\n" +
      "      };",
      OFFLINE_FILE, 'BOSS 真實死亡觀測 hook');
    src = replaceOne(src,
      "    if (typeof gainItem === 'function') {",
      "    if (typeof spawnMob === 'function') {\n" +
      "      var _smTrace = spawnMob;\n" +
      "      window.spawnMob = function () { var _sr = _smTrace.apply(this, arguments); if (_bossTraceSpawnHook) { try { _bossTraceSpawnHook(); } catch (e) {} } return _sr; };\n" +
      "    }\n" +
      "    if (typeof gainItem === 'function') {",
      OFFLINE_FILE, 'BOSS 中途恩賜觀測 hook');
  }

  // v2 開發期／既有工作樹的冪等收斂：離線尾段不得用快取空推到結束，
  // 必須從當下切回真打，否則會留下滿血 Boss 且少算尾段攻防。
  if (src.includes("        if (nextDone > totalTicks) { beginBossTrue(boss, replay.variant, '離線尾段'); return true; }\n")) {
    src = replaceOne(
      src,
      "        if (nextDone > totalTicks) { beginBossTrue(boss, replay.variant, '離線尾段'); return true; }\n",
      "        if (nextDone > totalTicks || (nextDone >= totalTicks && replay.deadline > totalTicks)) { beginBossTrue(boss, replay.variant, '離線尾段'); return true; }\n",
      OFFLINE_FILE,
      'BOSS 快取離線尾段真打收斂'
    );
  }

  // v2 審查收斂：純 Boss 圖只看中央有效格；exact deadline 要重入一次完成正式
  // killMob；途中恩賜的快取相位包含取得恩賜的當拍，與真打樣本一致。
  if (src.includes("      for (var i = 0; i < mapState.mobs.length; i++) {\n" +
                   "        if (!mapState.mobs[i] && (!mapState.spawnAt || mapState.spawnAt[i] == null)) hasEmptyUnscheduled = true;\n")) {
    src = replaceOne(
      src,
      "      for (var i = 0; i < mapState.mobs.length; i++) {\n" +
      "        if (!mapState.mobs[i] && (!mapState.spawnAt || mapState.spawnAt[i] == null)) hasEmptyUnscheduled = true;\n",
      "      var pureBoss = PURE_BOSS_MAPS.includes(mapState.current) && !KING_ROOMS[mapState.current];\n" +
      "      var slotCount = (typeof backSlotsActive === 'function' && backSlotsActive()) ? 5 : 3;\n" +
      "      for (var i = 0; i < slotCount; i++) {\n" +
      "        if (pureBoss && i !== 1) continue;           // 核心純 Boss 圖只會排中央格；其餘永久空格不是待出怪事件\n" +
      "        if (!mapState.mobs[i] && (!mapState.spawnAt || mapState.spawnAt[i] == null)) hasEmptyUnscheduled = true;\n",
      OFFLINE_FILE,
      '純 Boss 圖有效出怪格收斂'
    );
  }
  if (src.includes("      if (bossProfileUsable(grace) && Math.random() >= BOSS_REVERIFY_P) beginBossReplay(boss, 'grace', grace, '途中恩賜');\n" +
                   "      else beginBossTrue(boss, 'grace', bossProfileUsable(grace) ? '獨立抽驗' : '首次');\n")) {
    src = replaceOne(
      src,
      "      if (bossProfileUsable(grace) && Math.random() >= BOSS_REVERIFY_P) beginBossReplay(boss, 'grace', grace, '途中恩賜');\n" +
      "      else beginBossTrue(boss, 'grace', bossProfileUsable(grace) ? '獨立抽驗' : '首次');\n",
      "      if (bossProfileUsable(grace) && Math.random() >= BOSS_REVERIFY_P) {\n" +
      "        var graceReplay = beginBossReplay(boss, 'grace', grace, '途中恩賜');\n" +
      "        // spawn 發生於本拍攻擊前；真打樣本把這一拍完整算進 grace。\n" +
      "        // normal 重播已跳到本拍，故 grace 起點回推一拍，並標記本拍已 pump，避免重複出怪。\n" +
      "        graceReplay.startDone = Math.max(replay.startDone, done - 1);\n" +
      "        graceReplay.deadline = graceReplay.startDone + Math.max(1, Number(grace.ticks) || 1);\n" +
      "        graceReplay.pumpedTick = state.ticks;\n" +
      "      } else beginBossTrue(boss, 'grace', bossProfileUsable(grace) ? '獨立抽驗' : '首次');\n",
      OFFLINE_FILE,
      'BOSS 中途恩賜相位收斂'
    );
  }
  if (src.includes("      while (fastBossReplay === replay && done < totalTicks && guard++ < 20000) {\n")) {
    src = replaceOne(
      src,
      "      while (fastBossReplay === replay && done < totalTicks && guard++ < 20000) {\n",
      "      while (fastBossReplay === replay && done <= totalTicks && guard++ < 20000) {\n",
      OFFLINE_FILE,
      'BOSS exact deadline 正式擊殺收斂'
    );
  }

  const hasOfflineAutoSellThrottle = src.includes('var AUTOSELL_CKPT_TICKS = 3000;');
  if (hasOfflineAutoSellThrottle && !src.includes(AUTOSELL_POLICY_CHAIN_MARKER)) {
    src = replaceOne(
      src,
      "      };\n" +
      "      // 收尾用:重設節流後跑一次「正常」自動賣(仍會先套規則、仍吃規則的延遲秒數;不是玩家的一鍵賣)",
      "      };\n" +
      "      " + AUTOSELL_POLICY_CHAIN_MARKER + "\n" +
      "      // PP 的五分鐘離線節流包在本站政策外層；把契約標記傳到最外層，供啟動檢查確認整條 wrapper chain 仍在。\n" +
      "      window.autoSellJunk.__afkJunkAutosellPolicy = !!(_asj && _asj.__afkJunkAutosellPolicy);\n" +
      "      // 收尾用:重設節流後跑一次「正常」自動賣(仍會先套規則、仍吃規則的延遲秒數;不是玩家的一鍵賣)",
      OFFLINE_FILE,
      '離線自動販賣政策 wrapper chain'
    );
  }

  // 已套過舊核心的工作樹只需提升快取規則版；完整簽章另含 GAME_VERSION，
  // 這裡仍明確換版，避免除錯介面誤報並強制丟棄 v3.8.5 的取樣結果。
  if (src.includes("OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r4-grace-events'")) {
    src = replaceOne(
      src,
      "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r4-grace-events'",
      "OFFSTATS_RULESET = 'pp-v3.8.34+shines-v3.8.27-content-r4-grace-events'",
      OFFLINE_FILE,
      'PP v3.8.34 離線快取規則版'
    );
  }

  const required = [
    MARKER,
    RIFT_OFFLINE_MARKER,
    CHECKPOINT_COMMIT_MARKER,
    "MIGRATION_PREFIX = 'afk_offline_legacy_migrated_v'",
    OFFSTATS_MARKER,
    OFFLINE_BOSSRING_MARKER,
    CRAZY_BOSS_CACHE_MARKER,
    "OFFSTATS_SCHEMA = 2",
    "OFFSTATS_RULESET = 'pp-v3.8.34+shines-v3.8.27-content-r4-grace-events'",
    "return 'v5|' + offStatsHash",
    'bossring:offlineBossHuntSignature()',
    "if (k === 'scroll_teleport' && offlineBossHuntActive()) continue",
    'if (offlineBossHuntActive()) return false',
    'offlineBossHuntStep(totalTicks - done)',
    'function bossCacheEntry(name)',
    'function bossMergeProfile(prev, ticks, safe, events)',
    'function beginBossTrue(mob, variant, reason)',
    'function beginBossReplay(mob, variant, profile, reason)',
    'function bossReplayStep()',
    'if (pureBoss && i !== 1) continue',
    'graceReplay.startDone = Math.max(replay.startDone, done - 1)',
    'done <= totalTicks && guard++ < 20000',
    "var _bossVariant = (_m0._grace ? 'grace' : 'normal')",
    "beginBossReplay(_m0, _bossVariant, _bs, '安全樣本')",
    'maybeSpawnMobs();                            // 唯一出怪／唯一恩賜 RNG 路徑',
    '_entryB[_doneBossVariant] = bossMergeProfile',
    '_bossTraceKillHook = null; _bossTraceSpawnHook = null',
    'if (_bossTraceKillHook && _traceMob && _traceMob._dead)',
    'player._offStats = { v: OFFSTATS_SCHEMA',
    'player._offStats.v === OFFSTATS_SCHEMA',
    'function blockedInstanceMap(map)',
    "if (!migrationDone()) return { map: '', ts: 0",
    "version: '2.3.0-jesper-rift-offline'",
    'migrationDoneFor: migrationDone',
    'blockedInstanceMap: blockedInstanceMap',
    'offStatsSignature: offStatsSig',
    'function riftSnapshot()',
    'var beforeRemain = Math.max(0, dueElapsed - battleMs)',
    "var isRift = savedMap === 'rift_battle'",
    "!isKing && !isRift",
    "hKind = 'rift'",
    "riftSnapshot: riftSnapshot"
    , 'checkpointDone <= _ckptCommittedDone'
    , "saved = saveGame() === true"
    , "window.__fb5CloseFlush && typeof _ckptNow === 'function'"
    , 'UW_CHAR_MAX = 2500000'
    , '_uwChars -= oldRaw.length'
  ];
  if (hasOfflineAutoSellThrottle) required.push(AUTOSELL_POLICY_CHAIN_MARKER);
  const missing = required.filter(x => !src.includes(x));
  if (missing.length) throw new Error(`[${OFFLINE_FILE}] 安全補丁驗證失敗：${missing.join(' | ')}`);
  const forbidden = [
    OLD_CRAZY_BOSS_CACHE_MARKER,
    'bossCacheEnabled',
    '每隻皆實測',
    "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r3-grace-boss'",
    'boss: bossCacheEnabled ? bossStats : {}'
  ];
  const leaked = forbidden.filter(x => src.includes(x));
  if (leaked.length) throw new Error(`[${OFFLINE_FILE}] 瘋狂席琳 Boss 事件快取升級不完整：${leaked.join(' | ')}`);
  finishFile(OFFLINE_FILE, srcBefore, src);
}

function patchSlotInfo() {
  let src = readFileSync(SLOTINFO_FILE, 'utf8').replace(/\r\n/g, '\n');
  const srcBefore = src;
  if (!src.includes(SLOTINFO_MARKER)) {
    src = replaceOne(
      src,
      "    var mapId = '';\n    try { mapId = localStorage.getItem('afk_map_' + slot) || ''; } catch (e) {}\n    if (!mapId && save && save.ms) mapId = save.ms.current || '';",
      "    " + SLOTINFO_MARKER + "\n" +
      "    // 遷移完成前不讀凍結的 afk_ts_/afk_map_，避免選角頁先顯示假掛機時間。\n" +
      "    var legacyReady = !!(window.__afk && typeof window.__afk.migrationDoneFor === 'function' && window.__afk.migrationDoneFor(slot));\n" +
      "    var mapId = '';\n" +
      "    if (legacyReady) {\n" +
      "      try { mapId = localStorage.getItem('afk_map_' + slot) || ''; } catch (e) {}\n" +
      "      if (!mapId && save && save.ms) mapId = save.ms.current || '';\n" +
      "    }",
      SLOTINFO_FILE,
      '掛機地圖遷移守衛'
    );

    src = replaceOne(
      src,
      "    var ts = 0; try { ts = +localStorage.getItem('afk_ts_' + slot) || 0; } catch (e) {}\n    var idleText = '';",
      "    var ts = 0;\n" +
      "    if (legacyReady) { try { ts = +localStorage.getItem('afk_ts_' + slot) || 0; } catch (e) {} }\n" +
      "    var idleText = '';",
      SLOTINFO_FILE,
      '掛機時間遷移守衛'
    );

    src = replaceOne(
      src,
      "      var old = card.querySelector('.afk-card-slotinfo'); if (old) old.remove();   // 每次重繪清舊的\n      var slot = parseInt",
      "      var old = card.querySelector('.afk-card-slotinfo'); if (old) old.remove();   // 每次重繪清舊的\n" +
      "      var staleNative = card.querySelector('.load-offline-status'); if (staleNative) staleNative.remove();   // 快取混搭後援：另一套離線狀態不顯示\n" +
      "      var slot = parseInt",
      SLOTINFO_FILE,
      '原生離線徽章清理'
    );
  }

  const required = [SLOTINFO_MARKER, 'var legacyReady =', 'if (legacyReady) {', "querySelector('.load-offline-status')"];
  const missing = required.filter(x => !src.includes(x));
  if (missing.length) throw new Error(`[${SLOTINFO_FILE}] 遷移顯示補丁驗證失敗：${missing.join(' | ')}`);
  finishFile(SLOTINFO_FILE, srcBefore, src);
}

try {
  patchBossring();
  patchOffline();
  patchSlotInfo();
  console.log(CHECK ? '✅ --check：離線安全政策均已就位。' : '✅ 已套用 Jesper 離線安全政策。');
} catch (e) {
  console.error('❌ apply-offline-safety-patches 失敗：' + e.message);
  process.exit(1);
}
