/**
 * apply-offline-safety-patches.mjs
 *
 * PP 最新版已恢復 afk-offline 實戰補跑；本腳本只補回 Jesper 版的安全政策：
 *   - 新舊離線引擎嚴格互斥
 *   - 每存檔位首次切換只建立新錨點，不補算凍結區間
 *   - 安塔瑞斯／攻城 V2 特殊副本禁止離線模擬
 *   - 遷移完成前，選角頁不顯示歷史殘留的掛機地圖／時間
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

function patchOffline() {
  let src = readFileSync(OFFLINE_FILE, 'utf8').replace(/\r\n/g, '\n');
  const srcBefore = src;
  if (!src.includes(MARKER)) {
    const toggleLine =
      "  if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('offline')) return;   // 🎚️ 外掛開關:關掉→不掛任何鉤子,遊戲回原版(無離線結算)";
    const chaseBlock =
      "  // 子選項:掛機期間持續遭到追殺(預設關)。核心用牆鐘比對追殺到期時間,補跑時牆鐘幾乎凍結 → 不處理就等於離線自動豁免追殺。\n" +
      "  if (window.AFK_TOGGLES) AFK_TOGGLES.register({ id: 'offlinechase', name: '掛機期間持續遭到追殺', group: '遊戲玩法', parent: 'offline', def: false });\n" +
      "  function chaseOn() { return !!(window.AFK_TOGGLES && AFK_TOGGLES.enabled('offlinechase')); }";
    const configAnchor =
      "  // ----- 可調參數 ---------------------------------------------------------\n" +
      "  var CAP_HOURS";
    const introVariants = [
      { from: toggleLine + '\n\n' + configAnchor, keep: toggleLine },
      { from: toggleLine + '\n' + chaseBlock + '\n\n' + configAnchor, keep: toggleLine + '\n' + chaseBlock },
    ];
    const introMatches = introVariants.filter(variant => src.includes(variant.from));
    if (introMatches.length !== 1) {
      throw new Error(`[${OFFLINE_FILE}] 「獨占握手與遷移版本」錨點數量錯誤：${introMatches.length}`);
    }
    const intro = introMatches[0];
    src = replaceOne(
      src,
      intro.from,
      intro.keep + "\n" +
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

    src = replaceOne(
      src,
      "      return ['v2', mapState.current, player.lv, player.sherineWorld ? 1 : 0, player.sherineMad ? 1 : 0,",
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
      "  var _saveSquelch = false;\n  async function runCatchup",
      "  var _saveSquelch = false;\n" +
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

    src = replaceOne(
      src,
      "    var OFFSTATS_MAX_AGE_MS = 72 * 3600 * 1000;\n" +
      "    function offStatsSig() {\n" +
      "      var eq = [];\n" +
      "      try { for (var k in player.eq) { var e = player.eq[k]; if (e && e.id) eq.push(k + ':' + e.id + ':' + (e.en || 0)); } } catch (e) {}\n" +
      "      eq.sort();\n" +
      "      return ['v4', mapState.current, player.lv, player.sherineWorld ? 1 : 0, player.sherineMad ? 1 : 0,\n" +
      "        player.classicMode ? 1 : 0, player.traditionalMode ? 1 : 0, eq.join(',')].join('|');   // v2:2026-07-11 上游大移植(遺物效果/傭兵攻速/能力上限100/藥水隨機)殺速普遍改變,讓全體舊統計失效重取樣\n" +
      "    }",
      "    var OFFSTATS_MAX_AGE_MS = 72 * 3600 * 1000;\n",
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
      "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r4-grace-events'",
      OFFLINE_FILE, '瘋狂席琳事件快取規則版');
    src = replaceOne(src,
      "  var _saveSquelch = false;\n",
      "  var _saveSquelch = false;\n" +
      "  var _bossTraceKillHook = null, _bossTraceSpawnHook = null;   // 瘋狂席琳 BOSS 真打樣本；線上時皆為 null\n",
      OFFLINE_FILE, 'BOSS 事件追蹤掛點');
    src = replaceOne(src,
      "    var fastBossUid = null, fastBossName = '', fastBossStart = 0, fastBossMinHp = 1, fastBossKills0 = 0;\n" +
      "    var BOSS_REVERIFY_P = 0.05;",
      "    var fastBossUid = null, fastBossName = '', fastBossStart = 0, fastBossMinHp = 1, fastBossKills0 = 0;\n" +
      bossEventHelpers + "\n" +
      "    var BOSS_REVERIFY_P = 0.05;",
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
    src = replaceOne(src,
      "          fastBossUid = _m0.uid; fastBossName = _m0.n || '?'; fastBossStart = done; fastBossMinHp = 1; fastBossKills0 = tallySum(killTally);   // 記真打起始殺數 → 倒下時算對戰期間清掉的小怪數\n" +
      "          console.info('[AFK] ⚔ 快速結算遇到 BOSS「' + fastBossName + '」(' + (_bs && _bs.safe ? '抽驗' : '首次') + ')→ 切回真模擬對打,倒下後同名 BOSS 才可快轉。');",
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

    src = replaceOne(src,
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

  const required = [
    MARKER,
    "MIGRATION_PREFIX = 'afk_offline_legacy_migrated_v'",
    OFFSTATS_MARKER,
    OFFLINE_BOSSRING_MARKER,
    CRAZY_BOSS_CACHE_MARKER,
    "OFFSTATS_SCHEMA = 2",
    "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r4-grace-events'",
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
    "version: '2.2.0-jesper-safety'",
    'migrationDoneFor: migrationDone',
    'blockedInstanceMap: blockedInstanceMap',
    'offStatsSignature: offStatsSig'
  ];
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
