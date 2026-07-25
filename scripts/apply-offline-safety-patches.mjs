/**
 * apply-offline-safety-patches.mjs
 *
 * PP 最新版已恢復 afk-offline 實戰補跑；本腳本只補回 Jesper 版的安全政策：
 *   - 新舊離線引擎嚴格互斥
 *   - 每存檔位首次切換只建立新錨點，不補算凍結區間
 *   - 安塔瑞斯／攻城 V2 特殊副本禁止離線模擬
 *   - 遷移完成前，選角頁不顯示歷史殘留的掛機地圖／時間
 *
 * 所有替換皆以 PP 完成品的明確錨點定位；錨點改寫時直接失敗，不靜默降級。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const OFFLINE_FILE = 'afk-offline.js';
const SLOTINFO_FILE = 'afk-slotinfo.js';
const MARKER = '// 🔒 Jesper offline safety policy v4';
const SLOTINFO_MARKER = '// 🔒 Jesper offline migration visibility guard';
const OFFSTATS_MARKER = '// 🔒 Jesper offline cache contract v5';

function replaceOne(src, from, to, file, label) {
  const at = src.indexOf(from);
  if (at < 0) throw new Error(`[${file}] 找不到「${label}」錨點；PP 可能改寫了離線流程，拒絕不確定替換。`);
  if (src.indexOf(from, at + from.length) >= 0) throw new Error(`[${file}] 「${label}」錨點出現不只一次，拒絕不確定替換。`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

function patchOffline() {
  let src = readFileSync(OFFLINE_FILE, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(MARKER)) {
    src = replaceOne(
      src,
      "  if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('offline')) return;   // 🎚️ 外掛開關:關掉→不掛任何鉤子,遊戲回原版(無離線結算)\n\n  // ----- 可調參數 ---------------------------------------------------------\n  var CAP_HOURS",
      "  if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('offline')) return;   // 🎚️ 外掛開關:關掉→不掛任何鉤子,遊戲回原版(無離線結算)\n" +
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
      "  var OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r1';\n" +
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

  const required = [
    MARKER,
    "MIGRATION_PREFIX = 'afk_offline_legacy_migrated_v'",
    OFFSTATS_MARKER,
    "OFFSTATS_SCHEMA = 2",
    "OFFSTATS_RULESET = 'pp-v3.8.5+shines-v3.8.27-content-r1'",
    "return 'v5|' + offStatsHash",
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
  if (!CHECK) writeFileSync(OFFLINE_FILE, src);
}

function patchSlotInfo() {
  let src = readFileSync(SLOTINFO_FILE, 'utf8').replace(/\r\n/g, '\n');
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
  if (!CHECK) writeFileSync(SLOTINFO_FILE, src);
}

try {
  patchOffline();
  patchSlotInfo();
  console.log(CHECK ? '✅ --check：離線安全政策均已就位。' : '✅ 已套用 Jesper 離線安全政策。');
} catch (e) {
  console.error('❌ apply-offline-safety-patches 失敗：' + e.message);
  process.exit(1);
}
