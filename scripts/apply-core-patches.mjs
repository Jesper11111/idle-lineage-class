/**
 * apply-core-patches.mjs — 在「拉進上游原版核心」之後，自動把加掛版必要的核心鉤子補回去。
 *
 * 設計原則（給自動更新流程用，取代舊的整檔合併）：
 *   - 冪等：已補過就跳過（可重複跑）。
 *   - 錨點式：靠「函式/註解特徵字串」定位，不寫死行號 → 上游小改版大多仍插得進去。
 *   - 失敗大聲：錨點找不到就 throw（exit 1）→ CI 紅，讓人知道要修錨點，而不是默默讓離線壞掉。
 *
 * 目前的核心補丁（越少越好）：
 *   1. maybeSpawnMobs — 把 js/03 tick() 內「出怪排程」那一塊 { } 抽成具名函式，讓離線快速結算
 *      能用「與線上同一份」的出怪排程（出怪延遲/BOSS 節流/後排格/席琳日光加速全照原作）。
 *      其餘離線鉤子（saveGame/loadGame/changeMap/killMob/gainItem 包裝、結算期間靜音渲染）
 *      一律由 afk-offline.js 外掛自己 monkey-patch，不動核心。
 *   8. 舊版離線引擎獨占 — 若上游仍載入 js/27，就在第一個全域掛鉤前退出；若像 v3.8.1
 *      已不載入新版離線模組，則驗證載入中的核心沒有偷偷安裝原生離線鉤子。實際獨占標記
 *      由 afk-offline-owner.js 在執行期確認後授權，避免同步／快取混搭時兩套引擎同時結算。
 *   9. PWA 圖片快取分片版本化 — 禁止每次啟動逐筆掃圖桶或 cache.keys()；由 manifest 內容
 *      產生類別／動畫分片快取名，上游更新只淘汰真的變動的分片。
 *  10. 手機雙省電角色預覽閘門 — 選角／創角逐幀動畫與預載讀本地圖片記憶體政策掛點，
 *      防止玩家已關動畫後，登入畫面仍解碼完整職業序列。
 *
 * 用法：node scripts/apply-core-patches.mjs        （--check 只驗證是否已全部補上、不寫檔）
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
let changed = 0, already = 0;

// ── 小工具：從指定 index 的 '{' 找到配對的 '}'（略過字串/註解外的括號；此處程式碼夠單純故用簡易配對）──
function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('matchBrace: 找不到配對的 }（自 index ' + openIdx + '）');
}

// ── 補丁 1：抽出 maybeSpawnMobs ────────────────────────────────
function patchMaybeSpawnMobs() {
  const FILE = 'js/03-combat-core.js';
  let s = readFileSync(FILE, 'utf8');

  if (/function\s+maybeSpawnMobs\s*\(/.test(s)) { already++; return; }   // 冪等

  // 錨點：出怪判定那段的開頭註解（上游原文，穩定）
  const ANCHOR = '// === 出怪判定：以邏輯 tick';
  const aIdx = s.indexOf(ANCHOR);
  if (aIdx < 0) throw new Error(`[${FILE}] 找不到出怪判定錨點「${ANCHOR}」——上游可能改寫了 tick 出怪段，請人工檢查後更新錨點。`);

  // 錨點之後第一個 '{' 就是那塊的開頭；找它的配對 '}'
  const openIdx = s.indexOf('{', aIdx);
  if (openIdx < 0) throw new Error(`[${FILE}] 錨點後找不到出怪塊的 '{'。`);
  const closeIdx = matchBrace(s, openIdx);
  const body = s.slice(openIdx + 1, closeIdx);   // 塊內程式碼（不含外層大括號）

  // 在 function tick() 之前插入具名函式；把原塊替換成呼叫
  const TICK_ANCHOR = 'function tick() {';
  const tIdx = s.indexOf(TICK_ANCHOR);
  if (tIdx < 0) throw new Error(`[${FILE}] 找不到「${TICK_ANCHOR}」錨點。`);

  const fnDef =
    '// 🔌 加掛版補丁(apply-core-patches)：出怪排程抽成具名函式，供 afk-offline 離線快速結算與 tick() 共用同一份排程。\n' +
    'function maybeSpawnMobs() {' + body + '}\n';

  // 先替換塊（用 index 由後往前處理避免位移）
  s = s.slice(0, openIdx) + '{ maybeSpawnMobs(); }' + s.slice(closeIdx + 1);
  // 重新定位 tick 錨點（前面替換過，位置變了，但 tick 在 aIdx 之前，未受影響——保險起見重找）
  const tIdx2 = s.indexOf(TICK_ANCHOR);
  s = s.slice(0, tIdx2) + fnDef + s.slice(tIdx2);

  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] maybeSpawnMobs 抽取完成（${FILE}）`);
}

// ── 補丁 2：gainItem 自帶強化值鉤子（偽傳統／自動衝裝）────────────
//   上游把傳統模式挖掉後 `let _tEn = 0;` 寫死。改成呼叫外掛鉤子 window.__afkTradRollEn(d, forceNormal, _noAffixCtx)：
//   afk-traditional.js 提供它 → 對「該角色有開偽傳統 + 非商店(forceNormal 假) + 裝備」回傳隨機強化值，其餘回 0。
//   未載外掛/未開 → 恆 0，與原版完全一致。詞綴/疊加/簽章全走上游原路（en 在簽章之前就定好，堆疊正確）。
function patchTradEnHook() {
  const FILE = 'js/08-items-equip.js';
  let s = readFileSync(FILE, 'utf8');
  if (s.includes('__afkTradRollEn')) { already++; return; }

  const ANCHOR = 'let _tEn = 0;   // 🏛️ v3.0.83 傳統模式已取消：掉落自帶強化值停用（任何來源恆 +0·手動強化照常）';
  if (s.indexOf(ANCHOR) < 0) throw new Error(`[${FILE}] 找不到 gainItem 的 _tEn 錨點——上游可能改寫了掉落強化段，請人工檢查後更新錨點。`);

  const REPLACE = "let _tEn = (typeof window.__afkTradRollEn === 'function') ? (window.__afkTradRollEn(d, forceNormal, _noAffixCtx) || 0) : 0;   // 🔌 加掛版補丁：偽傳統(自動衝裝)自帶強化值鉤子（外掛 afk-traditional 提供；未載/未開→0）";
  s = s.replace(ANCHOR, REPLACE);

  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] gainItem _tEn 偽傳統鉤子（${FILE}）`);
}

// ── 補丁 3：存檔位 8 → 16（加掛版原有功能，上游只有 8 格）──────────
//   上游把格數硬寫死在 4 處：js/13 匯入時的「同角色重複」掃描、js/06 allySlotList（招募）、
//   js/25 clanScanRoles（血盟成員/盟主判定）、js/28 PVP 挑戰自己其他角色的清單。
//   改成用 SAVE_SLOT_MAX=16（定義於 js/13，執行期全域，afk-loadslots/afk-wiki/afk-diag 的選角面板也讀它）。
//   選角畫面本身不必改核心：上游是分頁式卡片（每頁 4 格），afk-loadslots 自行擴充頁數。
function patch16Slots() {
  // js/13：定義 SAVE_SLOT_MAX + 匯入重複掃描涵蓋全部格
  const F13 = 'js/13-shop-save.js';
  let s13 = readFileSync(F13, 'utf8');
  if (!s13.includes('SAVE_SLOT_MAX')) {
    const A1 = "function slotSummary(n){ return _summaryFromRaw(_lzGet('lineage_idle_save_' + n)); }";
    if (s13.indexOf(A1) < 0) throw new Error(`[${F13}] 找不到 slotSummary 錨點——上游可能改了存檔位邏輯。`);
    s13 = s13.replace(A1,
      "const SAVE_SLOT_MAX = 16;   // 🔌 加掛版補丁：存檔位 8 → 16（匯入重複掃描/傭兵招募/選角面板共用）\n" + A1);
    // 匯入存檔時掃「同一角色是否已存在別格」——沒放大就掃不到第 9~16 格，會讓同角色重複進來
    const A2 = "for(let slotN = 1; slotN <= 8; slotN++){";
    if (s13.indexOf(A2) < 0) throw new Error(`[${F13}] 找不到匯入重複掃描 8 格迴圈錨點。`);
    s13 = s13.replace(A2, "for(let slotN = 1; slotN <= SAVE_SLOT_MAX; slotN++){");
    if (!CHECK) writeFileSync(F13, s13);
    changed++;
    console.log(`[patch] 存檔位 16 格（${F13}）`);
  } else { already++; }

  // js/06：傭兵招募可選存檔位
  const F06 = 'js/06-status-allies.js';
  let s06 = readFileSync(F06, 'utf8');
  const A3 = "['1','2','3','4','5','6','7','8'].filter(n => n !== String(currentSlot))";
  if (s06.indexOf(A3) >= 0) {
    s06 = s06.replace(A3, "(function(){ let a=[]; for(let n=1;n<=SAVE_SLOT_MAX;n++){ if(String(n)!==String(currentSlot)) a.push(String(n)); } return a; })()");
    if (!CHECK) writeFileSync(F06, s06);
    changed++;
    console.log(`[patch] 傭兵招募 16 格（${F06}）`);
  } else if (!s06.includes('SAVE_SLOT_MAX')) {
    throw new Error(`[${F06}] 找不到 allySlotList 8 格錨點——上游可能改了招募邏輯。`);
  } else { already++; }

  // js/25：血盟成員掃描（成員清單＋貢獻度、clanLeaderRole 找盟主、城鎮 NPC 的「有無君主」判斷都經這裡）
  const F25 = 'js/25-clan-system.js';
  let s25 = readFileSync(F25, 'utf8');
  const A4 = "for (let slot = 1; slot <= 8; slot++) {";
  if (s25.indexOf(A4) >= 0) {
    s25 = s25.replace(A4, "for (let slot = 1; slot <= SAVE_SLOT_MAX; slot++) {");
    if (!CHECK) writeFileSync(F25, s25);
    changed++;
    console.log(`[patch] 血盟成員掃描 16 格（${F25}）`);
  } else if (!s25.includes('SAVE_SLOT_MAX')) {
    throw new Error(`[${F25}] 找不到 clanScanRoles 8 格迴圈錨點——上游可能改了血盟成員掃描。`);
  } else { already++; }

  // js/28：PVP 面板「挑戰自己其他角色」的候選清單
  const F28 = 'js/28-pvp-arena.js';
  let s28 = readFileSync(F28, 'utf8');
  const A5 = "for (let n = 1; n <= 8; n++) {";
  if (s28.indexOf(A5) >= 0) {
    s28 = s28.replace(A5, "for (let n = 1; n <= SAVE_SLOT_MAX; n++) {");
    if (!CHECK) writeFileSync(F28, s28);
    changed++;
    console.log(`[patch] PVP 對手清單 16 格（${F28}）`);
  } else if (!s28.includes('SAVE_SLOT_MAX')) {
    throw new Error(`[${F28}] 找不到 PVP 對手清單 8 格迴圈錨點——上游可能改了 PVP 面板。`);
  } else { already++; }
}

// ── 補丁 4：js/22 寵/召 sprite ticker 改「間接呼叫」──────────────
//   上游 setInterval(_petAnimApply, …) 直接捕捉原函式參照 → afk-powersave 的 wrapper 攔不到
//   (關戰鬥動畫後寵物/召喚照樣動)。改箭頭間接呼叫=每次經全域解析,外掛包得住。
function patchPetAnimTicker() {
  const FILE = 'js/22-pets.js';
  let s = readFileSync(FILE, 'utf8');
  if (s.includes('setInterval(() => { _petAnimApply(); }')) { already++; return; }
  const ANCHOR = 'setInterval(_petAnimApply, 1000 / PET_ANIM_FPS);';
  if (s.indexOf(ANCHOR) < 0) throw new Error(`[${FILE}] 找不到 _petAnimApply ticker 錨點——上游可能改寫了寵物動畫排程。`);
  s = s.replace(ANCHOR, 'setInterval(() => { _petAnimApply(); }, 1000 / PET_ANIM_FPS);   // 🔌 加掛版補丁:間接呼叫讓外掛(省電模式)wrapper 攔得住;直接傳參照會被捕死原函式');
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 寵/召 sprite ticker 間接呼叫（${FILE}）`);
}

// ── 補丁 5：js/07 迴避頭目 與 外掛「自動找BOSS」互斥 ─────────────
//   afk-bossring 召來的王若被「迴避頭目(瞬移卷軸)」自動逃離立刻瞬移走=功能互咬。
//   逃離條件加 !_huntBoss(讀外掛暴露的 AFK_BOSSRING.huntActive();外掛未載=false 照常)。
function patchBossHuntEscape() {
  const FILE = 'js/07-skills-cast.js';
  let s = readFileSync(FILE, 'utf8');
  if (s.includes('AFK_BOSSRING')) { already++; return; }
  const A1 = "let tChk = document.getElementById('set-teleport');";
  const A2 = 'if (tChk && tChk.checked && mapState.mobs.some(m => m && m.boss && !m.noAutoTeleport)';
  if (s.indexOf(A1) < 0 || s.indexOf(A2) < 0) throw new Error(`[${FILE}] 找不到迴避頭目錨點——上游可能改寫了自動瞬移段。`);
  s = s.replace(A1, A1 + "\n        let _huntBoss = !!(window.AFK_BOSSRING && window.AFK_BOSSRING.huntActive && window.AFK_BOSSRING.huntActive());   // 🔌 加掛版補丁:外掛「自動找BOSS」進行中→抑制逃離(否則剛召來的王立刻被瞬移走);外掛未載入=false 照常");
  s = s.replace(A2, 'if (tChk && tChk.checked && !_huntBoss && mapState.mobs.some(m => m && m.boss && !m.noAutoTeleport)');
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 迴避頭目×自動找BOSS互斥（${FILE}）`);
}

// ── 補丁 6：js/08 useItem 加 keepModal 參數 ─────────────────────
//   外掛自動瞬移(afk-bossring)非 silent 使用卷軸時,上游會 closeModal() 把玩家開著的物品視窗關掉。
//   加第三參數 keepModal 讓自動路徑保留視窗(未傳=false,原行為不變)。
function patchUseItemKeepModal() {
  const FILE = 'js/08-items-equip.js';
  let s = readFileSync(FILE, 'utf8');
  if (s.includes('keepModal')) { already++; return; }
  const A1 = 'function useItem(u, silent = false) {';
  const A2 = "if(!silent && document.getElementById('item-modal').classList.contains('hidden') === false";
  if (s.indexOf(A1) < 0 || s.indexOf(A2) < 0) throw new Error(`[${FILE}] 找不到 useItem 錨點——上游可能改寫了簽名或關窗段。`);
  s = s.replace(A1, 'function useItem(u, silent = false, keepModal = false) {   // 🔌 加掛版補丁 keepModal:自動觸發(如外掛自動瞬移)非 silent 使用時,不關玩家開著的物品視窗');
  s = s.replace(A2, "if(!silent && !keepModal && document.getElementById('item-modal').classList.contains('hidden') === false");
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] useItem keepModal（${FILE}）`);
}

// ── 補丁 7：js/10 「立即賣出」不再無條件強制套規則 ─────────────────
//   上游 sellAutoSellItemsNow 無條件 applyAutoSellRules(true)(force)→玩家把自動販賣總開關關掉後
//   按「立即賣出」,仍當場依規則把沒標過的裝備標成廢品賣掉(玩家回報:武官護鎧被莫名賣掉;舊 main ab230707dc)。
//   改為只有總開關開著才 force;關閉時只賣玩家已手動標記的廢品(applyAutoSellRules(false) 會清規則舊標記)。
function patchSellNowNoForce() {
  const FILE = 'js/10-ui-tabs.js';
  let s = readFileSync(FILE, 'utf8');
  if (s.includes('applyAutoSellRules(player.autoSellOn!==false)')) { already++; return; }
  const ANCHOR = 'function sellAutoSellItemsNow(){_readAutoSellForm();_asBackup=null;applyAutoSellRules(true);';
  if (s.indexOf(ANCHOR) < 0) throw new Error(`[${FILE}] 找不到 sellAutoSellItemsNow 錨點——上游可能改寫了立即賣出,請人工檢查(此補丁防「關閉自動販賣仍被強制套規則賣裝」)。`);
  s = s.replace(ANCHOR, 'function sellAutoSellItemsNow(){_readAutoSellForm();_asBackup=null;applyAutoSellRules(player.autoSellOn!==false);   /* 🔌 加掛版補丁:總開關關閉→不套規則,只賣手動標記的廢品 */');
  s = s.replace('// 🔧 v2.6.91 force=true：即使開關關閉也強制依規則標記後立即賣', '// 🔌 加掛版補丁:開關開著才 force 套規則;關閉時只賣手動標記(上游原為無條件 force)');
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 立即賣出不強制套規則（${FILE}）`);
}

// ── 補丁 8：舊版 afk-offline 獨占離線結算 ───────────────────────
//   若 js/27 仍被頁面載入，它比外掛層早執行，必須在第一個全域掛鉤前直接退出。
//   若官方已完全移除載入（v3.8.1），則驗證所有已載核心沒有安裝已知原生離線鉤子。
//   同時停掉 js/13 依賴 js/27 checkpoint/player.offlineHunt 的原生掛機徽章，避免顯示凍結舊資料。
//   玩家關掉 afk-offline 時＝不提供離線收益，不在兩套不同時鐘／資料格式的引擎間動態切換。
function patchLegacyOfflineOwnership() {
  const INDEX_FILE = 'index.html';
  const OFFLINE_FILE = 'js/27-offline-rewards.js';
  const OFFLINE_MARKER = 'window.__afkLegacyOfflineOwnsSettlement = true;';
  const index = readFileSync(INDEX_FILE, 'utf8');
  const loadedCoreScripts = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map(m => m[1].split('?')[0])
    .filter(src => /^js\/\d+-[^/]+\.js$/i.test(src));
  const loadsLegacyNativeOffline = loadedCoreScripts.includes(OFFLINE_FILE);

  if (loadsLegacyNativeOffline) {
    let offline = readFileSync(OFFLINE_FILE, 'utf8');
    if (offline.includes(OFFLINE_MARKER)) {
      already++;
    } else {
      const ANCHOR = '    window.offlineCatchupSaveCommitted = _offlineCommitRestoredCatchup;';
      if (offline.indexOf(ANCHOR) < 0) {
        throw new Error(`[${OFFLINE_FILE}] 找不到第一個全域離線掛鉤錨點（offlineCatchupSaveCommitted）——上游可能改寫了 js/27，請人工確認新版沒有在更早處安裝事件／計時器後再更新補丁。`);
      }
      const NL = offline.includes('\r\n') ? '\r\n' : '\n';
      const GUARD = [
        '    // 🔌 加掛版補丁：離線收益由 afk-offline 實戰模擬引擎獨占；以下新版 checkpoint／結算／事件鉤子全部不安裝。',
        '    //    此標記也是 afk-offline 的 fail-closed 握手：看不到標記就拒絕啟動，避免快取混搭造成雙重發獎。',
        `    ${OFFLINE_MARKER}`,
        '    return;',
        '',
        ANCHOR
      ].join(NL);
      offline = offline.replace(ANCHOR, GUARD);
      if (!CHECK) writeFileSync(OFFLINE_FILE, offline);
      changed++;
      console.log(`[patch] 上游新版離線引擎讓位（${OFFLINE_FILE}）`);
    }
  } else {
    const nativeAssignment = /window\.(?:offlineCatchupSaveCommitted|offlineSettleCatchup|offlinePrepareCharacterSelect)\s*=/;
    const conflicting = loadedCoreScripts.filter(src => {
      try { return nativeAssignment.test(readFileSync(src, 'utf8')); } catch (_) { return false; }
    });
    if (conflicting.length) {
      throw new Error(`[${INDEX_FILE}] 官方未載入 ${OFFLINE_FILE}，但 ${conflicting.join(', ')} 仍安裝原生離線鉤子；拒絕授權舊引擎，請人工審查。`);
    }
    already++;
    console.log(`[check] 官方頁面未載入新版離線模組；已確認 ${loadedCoreScripts.length} 支載入中核心沒有已知離線鉤子。`);
  }

  const SAVE_FILE = 'js/13-shop-save.js';
  const UI_MARKER = 'if (window.__afkLegacyOfflineOwnsSettlement === true) return null;';
  let save = readFileSync(SAVE_FILE, 'utf8');
  if (save.includes(UI_MARKER)) {
    already++;
  } else {
    const ANCHOR = 'function _slotOfflineStatusNow(meta, activeRoleFps){';
    if (save.indexOf(ANCHOR) < 0) {
      // v3.8.1 已連同新版離線 checkpoint UI 一起移除；沒有函式就不需要隱藏。
      already++;
      console.log(`[check] ${SAVE_FILE} 已無新版離線 checkpoint 徽章。`);
    } else {
      save = save.replace(ANCHOR,
        ANCHOR + '\n    if (window.__afkLegacyOfflineOwnsSettlement === true) return null;   // 🔌 舊版離線引擎接手：新版 checkpoint 已停寫，不顯示凍結徽章');
      if (!CHECK) writeFileSync(SAVE_FILE, save);
      changed++;
      console.log(`[patch] 隱藏新版離線 checkpoint 徽章（${SAVE_FILE}）`);
    }
  }
}

// ── 補丁 9：PWA 圖片快取改為類別／動畫分片版本桶 ─────────────────
//   舊制每次啟動都把 24k 筆 assets manifest 送進 SW，逐筆 cache.match；動畫另對整個圖桶
//   cache.keys()。iOS 上工作量隨歷史快取變大，會把 WebContent 推到系統終止後白屏重載。
//   新制由 stamp-sw-version 依 manifest 產生 ASSET_CACHE_VERSIONS：
//   - 一般圖按 assets 第一層目錄分桶。
//   - anim/classanim/morphanim 按資料夾穩定分成 8 片。
//   - activate 只列「快取桶名稱」淘汰舊分片，永不列舉圖桶內數萬 entry。
//   sw.js / afk-pwa.js 都會被 PP 同步覆蓋，因此此補丁必須錨點式重套；錨點失效就讓同步紅燈。
function patchVersionedAssetCaches() {
  const PWA_FILE = 'afk-pwa.js';
  const SW_FILE = 'sw.js';
  const MARKER = 'AFK_VERSIONED_ASSET_CACHES';
  let pwa = readFileSync(PWA_FILE, 'utf8');
  let sw = readFileSync(SW_FILE, 'utf8');
  let touched = false;

  if (!pwa.includes(MARKER)) {
    const imageLine = /^([ \t]*)reconcileImages\(\);[^\r\n]*(?:\r?\n)?/m;
    const animLine = /^([ \t]*)reconcileAnim\(\);[^\r\n]*(?:\r?\n)?/m;
    if (!imageLine.test(pwa) || !animLine.test(pwa)) {
      throw new Error(`[${PWA_FILE}] 找不到 reconcileImages/reconcileAnim 啟動錨點——上游可能改寫 PWA 更新流程，請人工確認不再每次載入全量掃圖。`);
    }
    pwa = pwa.replace(imageLine,
      '$1// 🔌 AFK_VERSIONED_ASSET_CACHES：圖片失效改由 SW 的 manifest 版本分片桶處理；載入時不再抓／傳 24k 筆清單。\n');
    pwa = pwa.replace(animLine, '');
    const pwaLegacyStart = pwa.indexOf('  // ----- 圖桶對帳');
    const pwaLegacyEnd = pwa.indexOf('  // 程式桶對帳:', pwaLegacyStart);
    if (pwaLegacyStart < 0 || pwaLegacyEnd < 0) {
      throw new Error(`[${PWA_FILE}] 找不到舊圖桶對帳 helper 區塊——拒絕留下可被誤呼叫的全量 reconciliation。`);
    }
    pwa = pwa.slice(0, pwaLegacyStart) +
      `  // 首次安裝尚未接管（無 controller）時，等接管後再做小型程式桶清理。
  function whenController(fn) {
    var ctrl = navigator.serviceWorker.controller;
    if (ctrl) { fn(ctrl); return; }
    navigator.serviceWorker.addEventListener('controllerchange', function once() {
      navigator.serviceWorker.removeEventListener('controllerchange', once);
      whenController(fn);
    });
  }

` + pwa.slice(pwaLegacyEnd);
    pwa = pwa.replace(
      '  // ----- SW 觀察:nudge 重抓 sw.js 比對 + 圖桶對帳(更新接管交給瀏覽器,本檔不主導)-----------',
      '  // ----- SW 觀察：nudge 重抓 sw.js；圖片版本由 SW 分片桶自行處理 ----------------'
    ).replace(
      "    console.log('[AFK-pwa] hooks OK — PWA 安裝/圖桶對帳已就緒(不預抓,圖片用到才抓)。');",
      "    console.log('[AFK-pwa] hooks OK — PWA 安裝/資產版本分片已就緒(不預抓,圖片用到才抓)。');"
    );
    touched = true;
  }

  if (!sw.includes(MARKER)) {
    const docStart = sw.indexOf(' *   ● 圖桶 IMG_CACHE：');
    const docEnd = sw.indexOf(' * 更新控制：', docStart);
    if (docStart < 0 || docEnd < 0) {
      throw new Error(`[${SW_FILE}] 找不到舊圖桶說明錨點。`);
    }
    sw = sw.replace(
      ' * 兩個快取桶,刻意分開,這樣「改程式不會害人重載 30MB 圖」：',
      ' * 程式與圖片快取刻意分開，程式改版不會清掉所有圖片：'
    );
    sw = sw.slice(0, docStart) +
      ` *   ● 資產桶 asset-<group>-<manifest hash>：assets/ 全部採 cache-first、按需下載。
 *       一般資產按第一層目錄分桶；anim/classanim/morphanim 依資料夾穩定分成 8 片。
 *       manifest 內容改變時只更換受影響的桶名；activate 只列桶名並整桶淘汰舊分片，
 *       不抓 24k 筆清單、不逐項 cache.match，也不對圖片桶呼叫 cache.keys()。
 *
` + sw.slice(docEnd);
    sw = sw.replace(
      ' * 圖桶失效走 reconcileImages 逐張對帳(見上);不再背景預抓——圖片一律 on-demand 用到才抓、不主動下載整包。',
      ' * 圖片失效走 manifest 版本分片；不背景預抓，圖片一律 on-demand 用到才抓。'
    );

    const CACHE_ANCHOR = 'const IMG_CACHE  = IMG_VERSION;';
    if (!sw.includes(CACHE_ANCHOR)) {
      throw new Error(`[${SW_FILE}] 找不到 IMG_CACHE 宣告錨點——上游可能改寫圖桶策略。`);
    }
    const CACHE_BLOCK = `const ASSET_CACHE_SHARDS = 8;
const ASSET_CACHE_VERSIONS = {};
function _assetCacheShard(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) % ASSET_CACHE_SHARDS;
}
function _assetCacheGroup(pathname) {
  let clean = String(pathname || '');
  try { clean = decodeURIComponent(clean); } catch (err) {}
  clean = clean.replace(/^\\/+/, '').replace(/^public\\//, '');
  const assetsAt = clean.indexOf('assets/');
  if (assetsAt > 0) clean = clean.slice(assetsAt); // GitHub Pages 專案站：/<repo>/assets/...
  const animated = clean.match(/^assets\\/(anim|classanim|morphanim)\\/([^/]+)/);
  if (animated) return animated[1] + '-' + _assetCacheShard(animated[1] + '/' + animated[2]);
  const regular = clean.match(/^assets\\/([^/]+)/);
  return regular ? 'static-' + regular[1] : null;
}
function _assetCacheName(pathname) {
  const group = _assetCacheGroup(pathname);
  const version = group && ASSET_CACHE_VERSIONS[group];
  return version ? 'asset-' + group + '-' + version : null;
}
const ASSET_CACHE_NAMES = new Set(Object.keys(ASSET_CACHE_VERSIONS)
  .map((group) => 'asset-' + group + '-' + ASSET_CACHE_VERSIONS[group]));
// 🔌 AFK_VERSIONED_ASSET_CACHES：只列桶名淘汰舊分片，禁止列舉任何圖片桶 entry。`;
    sw = sw.replace(CACHE_ANCHOR, CACHE_BLOCK);
    const imgVersionLine = /^const IMG_VERSION[^\r\n]*(?:\r?\n)?/m;
    if (!imgVersionLine.test(sw)) {
      throw new Error(`[${SW_FILE}] 找不到舊 IMG_VERSION 宣告。`);
    }
    sw = sw.replace(imgVersionLine, '');
    const metadataStart = sw.indexOf('// 圖桶內一個合成 entry');
    const metadataEnd = sw.indexOf('// 外部 CDN：', metadataStart);
    if (metadataStart < 0 || metadataEnd < 0) {
      throw new Error(`[${SW_FILE}] 找不到舊圖片 hash metadata 宣告。`);
    }
    sw = sw.slice(0, metadataStart) + sw.slice(metadataEnd);

    const ACTIVATE_ANCHOR = ".filter((k) => k !== CODE_CACHE && k !== IMG_CACHE && !/^code-/.test(k))";
    if (!sw.includes(ACTIVATE_ANCHOR)) {
      throw new Error(`[${SW_FILE}] 找不到 activate 保留桶錨點——拒絕冒險清錯快取。`);
    }
    sw = sw.replace(ACTIVATE_ANCHOR,
      ".filter((k) => k !== CODE_CACHE && !ASSET_CACHE_NAMES.has(k) && !/^code-/.test(k))");

    const MESSAGE_ANCHOR = "self.addEventListener('message', (e) => {";
    if (!sw.includes(MESSAGE_ANCHOR)) {
      throw new Error(`[${SW_FILE}] 找不到 message handler 錨點。`);
    }
    sw = sw.replace(MESSAGE_ANCHOR,
      `function _replyVersionedAssetCache(client, type) {
  if (client) client.postMessage({ type, evicted: 0, skipped: 'versioned-asset-caches' });
}

${MESSAGE_ANCHOR}`);

    function replaceAsyncBody(source, signature, body) {
      const start = source.indexOf(signature);
      if (start < 0) throw new Error(`[${SW_FILE}] 找不到 ${signature} 錨點。`);
      const open = source.indexOf('{', start + signature.length);
      if (open < 0) throw new Error(`[${SW_FILE}] ${signature} 找不到函式開頭。`);
      const close = matchBrace(source, open);
      return source.slice(0, open + 1) + '\n' + body + '\n' + source.slice(close);
    }
    sw = replaceAsyncBody(sw, 'async function reconcileImages(manifest, client)',
      "  _replyVersionedAssetCache(client, 'reconcile-done');");
    sw = replaceAsyncBody(sw, 'async function reconcileAnim(folders, client)',
      "  _replyVersionedAssetCache(client, 'reconcile-anim-done');");
    const swLegacyStart = sw.indexOf('// manifest 每筆可能');
    const swLegacyEnd = sw.indexOf('// cache-first + 連網補存。', swLegacyStart);
    if (swLegacyStart < 0 || swLegacyEnd < 0) {
      throw new Error(`[${SW_FILE}] 找不到舊圖片 reconciliation helper 區塊。`);
    }
    sw = sw.slice(0, swLegacyStart) +
      `// 舊頁面仍可能送 reconciliation 訊息；新 SW 直接回覆完成，不讀 manifest、不開圖桶。
async function reconcileImages(manifest, client) {
  _replyVersionedAssetCache(client, 'reconcile-done');
}
async function reconcileAnim(folders, client) {
  _replyVersionedAssetCache(client, 'reconcile-anim-done');
}

` + sw.slice(swLegacyEnd);

    const FETCH_ANCHOR = '    e.respondWith(cacheFirst(req, IMG_CACHE));';
    if (!sw.includes(FETCH_ANCHOR)) {
      throw new Error(`[${SW_FILE}] 找不到 assets fetch 圖桶錨點。`);
    }
    sw = sw.replace(FETCH_ANCHOR,
      "    const assetCache = _assetCacheName(url.pathname);\n" +
      "    if (assetCache) e.respondWith(cacheFirst(req, assetCache));");
    touched = true;
  }

  if (!touched) { already++; return; }
  if (!CHECK) {
    writeFileSync(PWA_FILE, pwa);
    writeFileSync(SW_FILE, sw);
  }
  changed++;
  console.log(`[patch] PWA 圖片快取改為類別／動畫分片版本桶（${PWA_FILE}、${SW_FILE}）`);
}

// ── 補丁 10：手機雙省電時停用角色選擇／創角逐幀預覽 ─────────────
//   afk-mobile-memory.js 提供 __afkMobileMemoryLite()；沒有外掛或未同時開兩個省電選項時，
//   條件恆 false，完全維持 PP 動畫。補丁只加閘門，不接管角色資料或登入流程。
function patchMobileMemoryPreviewGate() {
  const FILE = 'js/13-shop-save.js';
  let s = readFileSync(FILE, 'utf8');
  const gate = "!(typeof window.__afkMobileMemoryLite === 'function' && window.__afkMobileMemoryLite())";
  const expectedCount = (s.match(/__afkMobileMemoryLite/g) || []).length;
  if (expectedCount === 6) { already++; return; }   // 三個條件，每個掛點名稱在 typeof 與呼叫各出現一次
  if (expectedCount !== 0) {
    throw new Error(`[${FILE}] 手機圖片記憶體閘門只套了一部分（目前 ${expectedCount}/6 個掛點名稱），拒絕重複或不完整修改。`);
  }

  const loadAnchor = "if(panel && !panel.classList.contains('hidden') && now - _loadAnimState.lastAt >= _loadAnimState.stepMs){";
  const preloadAnchor = "for(let n = range[0]; n <= Math.min(range[1], range[0] + 10); n++){\n        const pre = new Image(); pre.src = `assets/start/${key}/${n}.png`;\n    }";
  const creationAnchor = "if(panel && img && !panel.classList.contains('hidden') && (!gs || gs.classList.contains('hidden')) && !creationClassAnim.static && now - creationClassAnim.lastAt >= creationClassAnim.stepMs){";
  for (const [label, anchor] of [['選角逐幀', loadAnchor], ['創角預載', preloadAnchor], ['創角逐幀', creationAnchor]]) {
    if (!s.includes(anchor)) throw new Error(`[${FILE}] 找不到「${label}」錨點，上游可能改寫角色預覽流程。`);
  }
  s = s.replace(loadAnchor,
    "if(panel && !panel.classList.contains('hidden') && " + gate + " && now - _loadAnimState.lastAt >= _loadAnimState.stepMs){   // 🔌 手機雙省電：角色選擇停在首幀，避免逐職業解碼整套 PNG");
  s = s.replace(preloadAnchor,
    "if(" + gate + "){   // 🔌 手機雙省電：不預載後續創角幀\n" +
    "        for(let n = range[0]; n <= Math.min(range[1], range[0] + 10); n++){\n" +
    "            const pre = new Image(); pre.src = `assets/start/${key}/${n}.png`;\n" +
    "        }\n" +
    "    }");
  s = s.replace(creationAnchor,
    "if(panel && img && !panel.classList.contains('hidden') && (!gs || gs.classList.contains('hidden')) && !creationClassAnim.static && " + gate + " && now - creationClassAnim.lastAt >= creationClassAnim.stepMs){   // 🔌 手機雙省電：創角預覽停在首幀");
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 手機雙省電角色預覽閘門（${FILE}）`);
}

const PATCHES = [patchMaybeSpawnMobs, patchTradEnHook, patch16Slots, patchPetAnimTicker, patchBossHuntEscape, patchUseItemKeepModal, patchSellNowNoForce, patchLegacyOfflineOwnership, patchVersionedAssetCaches, patchMobileMemoryPreviewGate];

try {
  for (const p of PATCHES) p();
} catch (e) {
  console.error('❌ apply-core-patches 失敗：' + e.message);
  process.exit(1);
}

if (CHECK) {
  if (changed > 0) { console.error(`❌ --check：有 ${changed} 個核心補丁尚未套用（請跑 node scripts/apply-core-patches.mjs）`); process.exit(1); }
  console.log(`✅ --check：全部 ${already} 個核心補丁均已就位。`);
} else {
  console.log(`✅ apply-core-patches 完成：新套用 ${changed}、已存在 ${already}。`);
}
