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
 *  11. 手機雙省電怪物縮圖閘門 — 戰鬥渲染在原尺寸 URL 進 DOM 前詢問本地政策掛點；
 *      簡化模式改用 96×96 單層辨識圖，並禁止載入原尺寸影子／武器圖層。
 *  12. 存檔壓縮工作合併 — 網頁版仍先同步寫入原文確保持久化，但 Worker 改為全域只執行
 *      一件工作、每個 key 只保留最新待處理版本；舊版本不再全部排進 Worker 複製完整存檔。
 *  13. 手機圖片生命週期 — 城鎮 NPC／玩家收購 NPC 在雙省電下只載首幀，城鎮 ticker 停止，
 *      換圖／換角通知本地政策層釋放圖片快取；非同步動畫探測完成前再次確認模式。
 *  14. 手機登入資源閘門 — 已儲存雙省電設定的手機在 CSS 載入前改用漸層背景；隱藏的選角／
 *      創角圖片延遲載入，登入逐幀預載也遵守圖片記憶體模式。
 *  15. 手機卡片圖鑑單層縮圖 — 圖鑑沿用 96×96 怪物縮圖時，不再另外疊回原尺寸影子／武器。
 *  16. 背景 Worker Blob 生命週期 — 即使 Worker 建構同步失敗，也會撤銷暫時 Blob URL。
 *  17. 手機補算排程 — 保留逐 tick 收益，但把手機前景 80/8ms 高占用改成 12/48ms，並優先讓出輸入。
 *  18. 手機補算正確性 — 補跑 housekeeping 暫停遊戲鐘、節流進度重繪，並確保慢 tick 有限完成與三次錯誤真的停止。
 *  19. 前後景補跑競態 — hidden/pagehide 作廢舊續跑 callback，避免回前景時吞掉背景時間。
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
  // 上游 checkout 在 Windows 會保留 CRLF；所有多行錨點先正規化，避免乾淨上游第一次重套失敗。
  let s = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
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

// ── 補丁 11：手機雙省電怪物改走 96×96 單層辨識圖 ───────────────
//   關動畫只會停止逐幀 ticker；原核心仍把 spawn/idle 本體、影子、武器與第二武器 URL 放進 DOM，
//   Safari 因此照樣解碼原尺寸 PNG 並把不同怪物留在 decoded-image cache。必須在 innerHTML 寫入前
//   詢問 afk-mobile-memory 的 __afkMobileMobStill()，事後 display:none 或換 src 都已來不及。
function patchMobileMobThumbGate() {
  const FILE = 'js/09-vfx-render.js';
  let s = readFileSync(FILE, 'utf8');
  const readyMarkers = [
    "let _mobileLiteStill = (typeof window.__afkMobileMobStill === 'function')",
    'let _mi = _mobileLiteStill || mobStillImg(m.n, m.img, true);',
    'let _fullMobLayers = !_mobileLiteStill;',
    'let _spriteShadow = _fullMobLayers && MOB_ANIM_NAMES.has(m.n)',
    'let _weaponFx = _fullMobLayers && MOB_ANIM_NAMES.has(m.n)',
    'let _weaponFx2 = _fullMobLayers && MOB_ANIM_NAMES.has(m.n)'
  ];
  const readyCount = readyMarkers.filter((marker) => s.includes(marker)).length;
  if (readyCount === readyMarkers.length) { already++; return; }
  if (readyCount || s.includes('__afkMobileMobStill')) {
    throw new Error(`[${FILE}] 手機怪物縮圖閘門只剩 ${readyCount}/${readyMarkers.length} 個完整標記，拒絕靜默略過。`);
  }

  const stillAnchor = '            let _mi = mobStillImg(m.n, m.img, true);   // 🎬 戰鬥初始幀：有動畫→優先 spawn_0（無 spawn 退 idle_0·再退舊靜態）；無動畫→舊靜態';
  const shadowAnchor = "            let _spriteShadow = MOB_ANIM_NAMES.has(m.n) && (typeof MOB_ANIM_SPRITE_SHADOW !== 'undefined') && MOB_ANIM_SPRITE_SHADOW.has(m.n);";
  const weaponAnchor = "            let _weaponFx = MOB_ANIM_NAMES.has(m.n) && (typeof MOB_ANIM_WEAPON_FX !== 'undefined') && MOB_ANIM_WEAPON_FX.has(m.n);";
  const weapon2Anchor = "            let _weaponFx2 = MOB_ANIM_NAMES.has(m.n) && (typeof MOB_ANIM_WEAPON_FX2 !== 'undefined') && MOB_ANIM_WEAPON_FX2.has(m.n);";
  for (const [label, anchor] of [
    ['怪物靜態圖', stillAnchor],
    ['怪物影子圖層', shadowAnchor],
    ['怪物武器圖層', weaponAnchor],
    ['怪物第二武器圖層', weapon2Anchor]
  ]) {
    if (!s.includes(anchor)) throw new Error(`[${FILE}] 找不到「${label}」錨點，上游可能改寫戰鬥怪物渲染。`);
  }

  s = s.replace(stillAnchor,
    "            let _mobileLiteStill = (typeof window.__afkMobileMobStill === 'function') ? window.__afkMobileMobStill(m.n, m.img, true) : null;   // 🔌 手機雙省電：在原尺寸 URL 進 DOM／開始解碼前，換成 96×96 單層辨識圖\n" +
    "            let _mi = _mobileLiteStill || mobStillImg(m.n, m.img, true);   // 🎬 戰鬥初始幀：一般模式維持 spawn/idle；手機雙省電走有上限的縮圖\n" +
    "            let _fullMobLayers = !_mobileLiteStill;   // 雙省電縮圖已是完整單層畫面；禁止再載原尺寸影子／武器圖層");
  s = s.replace(shadowAnchor,
    "            let _spriteShadow = _fullMobLayers && MOB_ANIM_NAMES.has(m.n) && (typeof MOB_ANIM_SPRITE_SHADOW !== 'undefined') && MOB_ANIM_SPRITE_SHADOW.has(m.n);");
  s = s.replace(weaponAnchor,
    "            let _weaponFx = _fullMobLayers && MOB_ANIM_NAMES.has(m.n) && (typeof MOB_ANIM_WEAPON_FX !== 'undefined') && MOB_ANIM_WEAPON_FX.has(m.n);");
  s = s.replace(weapon2Anchor,
    "            let _weaponFx2 = _fullMobLayers && MOB_ANIM_NAMES.has(m.n) && (typeof MOB_ANIM_WEAPON_FX2 !== 'undefined') && MOB_ANIM_WEAPON_FX2.has(m.n);");

  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 手機雙省電怪物縮圖閘門（${FILE}）`);
}

// ── 補丁 12：非同步存檔壓縮改為有上限的最新值佇列 ─────────────────
//   原版每次 _lzSet 都把完整 JSON 同時留在主執行緒 dictionary、再 postMessage 複製進 Worker。
//   已被新 revision 取代的舊工作仍會完整壓完才丟棄；換角／生命週期連續存檔會瞬間保留數十份。
//   原文在排壓縮前已同步寫入 localStorage，所以安全的合併方式是：全域一個 in-flight，
//   每個 key 一個最新 pending。被取代的只是不必要的壓縮工作，不是存檔本身。
function patchCoalescedSaveCompression() {
  const DATA_FILE = 'js/00-data.js';
  let data = readFileSync(DATA_FILE, 'utf8');
  const queueReady = [
    '_lzWorkerPending = Object.create(null)',
    '_lzWorkerWatchdog = null',
    '_lzWorkerGen = 0',
    'job.value = null',
    'function _resumeLzCompression()',
    '_lzWorkerGen !== workerGen',
    'var token = active.token',
    'if (workerUrl) {'
  ].every((marker) => data.includes(marker));
  if (!queueReady) {
    const START = 'var _lzWorker = null';
    const END = '// 一次性遷移：打包版首次啟用檔案存檔時';
    const start = data.indexOf(START);
    const end = data.indexOf(END, start);
    if (start < 0 || end < 0) {
      throw new Error(`[${DATA_FILE}] 找不到非同步 LZ Worker 區塊錨點，上游可能改寫存檔壓縮流程。`);
    }
    const replacement = `var _lzWorker = null, _lzWorkerGen = 0, _lzWorkerSeq = 0, _lzWorkerRev = Object.create(null), _lzWorkerRaw = Object.create(null);
var _lzWorkerPending = Object.create(null), _lzWorkerActive = null;
var _lzWorkerWatchdog = null, _LZ_WORKER_TIMEOUT_MS = 15000;
function _clearLzWorkerWatchdog() {
  if (_lzWorkerWatchdog != null) {
    clearTimeout(_lzWorkerWatchdog);
    _lzWorkerWatchdog = null;
  }
}
// 同一 key 的直接覆寫／刪除與同步壓縮都可呼叫：撤掉尚未送出的舊工作，並立即放掉主線 raw 參照。
// 已 postMessage 的單一 active clone 無法取消，但 revision guard 會讓回覆失效；最多只剩這一份。
function _cancelLzCompressionKey(key) {
  var pending = _lzWorkerPending[key];
  if (pending) {
    delete _lzWorkerRaw[pending.token];
    delete _lzWorkerPending[key];
  }
  if (_lzWorkerActive && _lzWorkerActive.key === key) delete _lzWorkerRaw[_lzWorkerActive.token];
}
// Direct raw replacements (backup restore / migration) must invalidate a queued compression
// result for the same key, otherwise an older Worker reply can overwrite the restored value.
function _lzSetStoredRaw(key, value) {
  if (!_FS) {
    _lzWorkerRev[key] = (_lzWorkerRev[key] || 0) + 1;
    _cancelLzCompressionKey(key);
  }
  return _lsSet(key, value);
}
function _lzRemoveStored(key) {
  if (!_FS) {
    _lzWorkerRev[key] = (_lzWorkerRev[key] || 0) + 1;
    _cancelLzCompressionKey(key);
  }
  _lsRemove(key);
}
function _resetLzCompressionQueue() {
  _clearLzWorkerWatchdog();
  _lzWorkerActive = null;
  _lzWorkerPending = Object.create(null);
  _lzWorkerRaw = Object.create(null);
}
function _resumeLzCompression() {
  if (_FS || !Object.keys(_lzWorkerPending).length) return;
  _getLzWorker();
  _drainLzCompression();
}
function _drainLzCompression() {
  if (_FS || _lzWorkerActive || !_lzWorker) return;
  var keys = Object.keys(_lzWorkerPending);
  if (!keys.length) return;
  var job = _lzWorkerPending[keys[0]];
  delete _lzWorkerPending[job.key];
  var worker = _lzWorker;
  job.id = ++_lzWorkerSeq;
  job.worker = worker;
  job.gen = _lzWorkerGen;
  _lzWorkerActive = job;
  try {
    worker.postMessage({ id: job.id, key: job.key, rev: job.rev, value: job.value });
    job.value = null;   // structured clone 已完成；active 不再重複持有整份主線字串
    var activeToken = job.token;
    var activeId = job.id;
    _clearLzWorkerWatchdog();
    _lzWorkerWatchdog = setTimeout(function() {
      if (_lzWorker !== worker || _lzWorkerGen !== job.gen || !_lzWorkerActive ||
          _lzWorkerActive.token !== activeToken || _lzWorkerActive.id !== activeId) return;
      delete _lzWorkerRaw[activeToken];
      _lzWorkerActive = null;
      try { worker.terminate(); } catch (e) {}
      _lzWorker = null;
      _lzWorkerWatchdog = null;
      _resumeLzCompression();
    }, _LZ_WORKER_TIMEOUT_MS);
  } catch (e) {
    _clearLzWorkerWatchdog();
    delete _lzWorkerRaw[job.token];
    _lzWorkerActive = null;
    try { worker.terminate(); } catch (e2) {}
    if (_lzWorker === worker) _lzWorker = null;
    setTimeout(_resumeLzCompression, 0);
  }
}
function _getLzWorker() {
  if (_lzWorker || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return _lzWorker;
  var workerUrl = null;
  try {
    var source = [
      'var f=String.fromCharCode,LZString={};',
      'LZString._compress=' + LZString._compress.toString() + ';',
      'LZString.compressToUTF16=' + LZString.compressToUTF16.toString() + ';',
      'self.onmessage=function(e){var d=e.data;try{self.postMessage({id:d.id,key:d.key,rev:d.rev,packed:"LZ1:"+LZString.compressToUTF16(d.value)});}catch(err){self.postMessage({id:d.id,key:d.key,rev:d.rev,error:true});}};'
    ].join('\\n');
    workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    var worker = new Worker(workerUrl);
    var workerGen = ++_lzWorkerGen;
    _lzWorker = worker;
    worker.onmessage = function(e) {
      var d = e.data || {};
      if (_lzWorker !== worker || _lzWorkerGen !== workerGen) return;
      var active = _lzWorkerActive;
      if (!active || active.id !== d.id || active.key !== d.key || active.rev !== d.rev) return;
      _clearLzWorkerWatchdog();
      _lzWorkerActive = null;
      var token = active.token, raw = _lzWorkerRaw[token];
      delete _lzWorkerRaw[token];
      if (!d.error && active && active.key === d.key && active.rev === d.rev &&
          _lzWorkerRev[d.key] === d.rev && raw != null && _lsGet(d.key) === raw) {
        _lsSet(d.key, d.packed);
      }
      _drainLzCompression();
    };
    worker.onerror = function() {
      if (_lzWorker !== worker || _lzWorkerGen !== workerGen) return;
      _clearLzWorkerWatchdog();
      var active = _lzWorkerActive;
      if (active) delete _lzWorkerRaw[active.token];
      _lzWorkerActive = null;
      try { worker.terminate(); } catch (e) {}
      _lzWorker = null;
      _resumeLzCompression();
    };
  } catch (e) {
    _lzWorker = null;
    _resetLzCompressionQueue();
  } finally {
    if (workerUrl) {
      try { URL.revokeObjectURL(workerUrl); } catch (e) {}
    }
  }
  return _lzWorker;
}
function _queueLzCompression(key, value, rev) {
  if (_FS) return;
  var worker = _getLzWorker();
  if (!worker) return;
  var old = _lzWorkerPending[key];
  if (old) delete _lzWorkerRaw[old.token];
  // 新 revision 已使同 key 的 active 工作失效；主線 raw 可先放掉，Worker 內最多只剩一份 clone。
  if (_lzWorkerActive && _lzWorkerActive.key === key) delete _lzWorkerRaw[_lzWorkerActive.token];
  var token = key + '@' + rev;
  var job = { key: key, value: value, rev: rev, token: token };
  _lzWorkerPending[key] = job;
  _lzWorkerRaw[token] = value;
  _drainLzCompression();
}
`;
    data = data.slice(0, start) + replacement + data.slice(end);
  }
  if (!data.includes('_cancelLzCompressionKey(key); // raw 寫失敗轉同步 fallback')) {
    const revAnchor = `  _lzWorkerRev[key] = rev; // Invalidate every older result before either write path starts.`;
    if (!data.includes(revAnchor)) {
      throw new Error(`[${DATA_FILE}] 找不到 _lzSet revision 錨點，上游可能改寫存檔 fallback。`);
    }
    data = data.replace(revAnchor, `${revAnchor}
  _cancelLzCompressionKey(key); // raw 寫失敗轉同步 fallback 時，也不能留下同 key 舊工作白做完整壓縮。`);
  }

  const SAVE_FILE = 'js/13-shop-save.js';
  let save = readFileSync(SAVE_FILE, 'utf8');
  const flushReady = save.includes('function _closeFlushClock()') &&
    save.includes('if(_flushSaved) _lastCloseFlushAt = _flushNow');
  if (!flushReady) {
    const startMarker = save.includes('let _lastCloseFlushAt =')
      ? 'let _lastCloseFlushAt =' : 'function _flushSaveNow(){';
    const start = save.indexOf(startMarker);
    const end = save.indexOf("if(typeof document !== 'undefined' && document.addEventListener)", start);
    if (start < 0 || end < 0) {
      throw new Error(`[${SAVE_FILE}] 找不到關頁存檔錨點，上游可能改寫生命週期存檔。`);
    }
    const replacement = `let _lastCloseFlushAt = -Infinity;
function _closeFlushClock(){
    return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
        ? performance.now() : Date.now();
}
function _flushSaveNow(){
    if(typeof player === 'undefined' || !player || !player.cls || typeof saveGame !== 'function') return;
    let _flushNow = _closeFlushClock();
    if(_flushNow - _lastCloseFlushAt < 250) return;   // visibilitychange/pagehide/beforeunload 同一輪只寫一次
    let _flushSaved = false;
    if(typeof window !== 'undefined') window.__fb5CloseFlush = true;
    try { _flushSaved = saveGame() === true; } catch(e) {}
    finally { if(typeof window !== 'undefined') window.__fb5CloseFlush = false; }
    if(_flushSaved) _lastCloseFlushAt = _flushNow;   // 失敗不鎖住後續 pagehide／beforeunload 的救援重試
    return _flushSaved;
}
`;
    save = save.slice(0, start) + replacement + save.slice(end);
  }
  const saveLogMarker = '成功提示不是持久化交易的一部分';
  if (!save.includes(saveLogMarker)) {
    const saveLogAnchor = '    logSys(`遊戲進度已儲存。`);';
    if (!save.includes(saveLogAnchor)) {
      throw new Error(`[${SAVE_FILE}] 找不到 saveGame 成功提示錨點，上游可能改寫提交結果。`);
    }
    save = save.replace(saveLogAnchor,
      '    try { logSys(`遊戲進度已儲存。`); } catch(e) {}   // 成功提示不是持久化交易的一部分；DOM 日誌失敗不得把已落盤的主檔＋寵物桶回報成失敗');
  }
  const saveFailureLogMarker = '本次進度未完整寫入';
  if (!save.includes(saveFailureLogMarker)) {
    const failureLogAnchor = "            logSys('<span class=\"text-red-400 font-bold\">⚠ 遊戲進度儲存失敗，本次進度未寫入。請重新整理後再試；若反覆失敗，請先用「匯出進度」備份存檔。</span>');";
    if (!save.includes(failureLogAnchor)) {
      throw new Error(`[${SAVE_FILE}] 找不到 saveGame 失敗提示錨點，上游可能改寫錯誤處理。`);
    }
    save = save.replace(failureLogAnchor,
      "            try { logSys('<span class=\"text-red-400 font-bold\">⚠ 遊戲進度儲存失敗，本次進度未完整寫入。請重新整理後再試；若反覆失敗，請先用「匯出進度」備份存檔。</span>'); } catch(_logErr) {}");
  }

  const dataDone = data.includes('_lzWorkerPending = Object.create(null)') &&
    data.includes('_lzWorkerWatchdog = null') &&
    data.includes('_lzWorkerGen = 0') &&
    data.includes('_LZ_WORKER_TIMEOUT_MS = 15000') &&
    data.includes('job.value = null') &&
    data.includes('function _resumeLzCompression()') &&
    data.includes('_lzWorkerGen !== workerGen') &&
    data.includes('var token = active.token') &&
    data.includes('if (workerUrl) {') &&
    data.includes('_cancelLzCompressionKey(key); // raw 寫失敗轉同步 fallback');
  const saveDone = save.includes('function _closeFlushClock()') &&
    save.includes('if(_flushSaved) _lastCloseFlushAt = _flushNow') &&
    save.includes(saveLogMarker) &&
    save.includes(saveFailureLogMarker);
  if (!dataDone || !saveDone) throw new Error('存檔壓縮合併補丁未完整產生。');
  const dataBefore = readFileSync(DATA_FILE, 'utf8');
  const saveBefore = readFileSync(SAVE_FILE, 'utf8');
  const wasDone = [
    '_lzWorkerWatchdog = null',
    '_lzWorkerGen = 0',
    'job.value = null',
    'function _resumeLzCompression()',
    '_lzWorkerGen !== workerGen',
    'var token = active.token',
    'if (workerUrl) {',
    '_cancelLzCompressionKey(key); // raw 寫失敗轉同步 fallback'
  ].every((marker) => dataBefore.includes(marker)) &&
    saveBefore.includes('function _closeFlushClock()') &&
    saveBefore.includes('if(_flushSaved) _lastCloseFlushAt = _flushNow') &&
    saveBefore.includes(saveLogMarker) &&
    saveBefore.includes(saveFailureLogMarker);
  if (wasDone) { already++; return; }
  if (!CHECK) {
    writeFileSync(DATA_FILE, data);
    writeFileSync(SAVE_FILE, save);
  }
  changed++;
  console.log(`[patch] 存檔壓縮改為每 key 最新值有界佇列（${DATA_FILE}、${SAVE_FILE}）`);
}

// ── 補丁 13：手機圖片快取生命週期與城鎮靜態幀閘門 ─────────────
function patchMobileImageLifecycleHooks() {
  const WORLD_FILE = 'js/11-world-map.js';
  // Windows checkout 會把上游檔案展開成 CRLF；這一組補丁有多行精確錨點，
  // 先統一成 LF 再處理，避免 source-dir 預演在真正覆蓋前誤判不相容。
  const readLf = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  let world = readLf(WORLD_FILE);
  const PROGRESSION_FILE = 'js/05-kill-progression.js';
  let progression = readLf(PROGRESSION_FILE);
  const directMapLifecycleLine = "    if (typeof window.__afkMobileMemoryLifecycle === 'function') window.__afkMobileMemoryLifecycle('map-change');";
  const progressionTargets = [
    "    mapState.current = 'pride_f' + n;",
    '    mapState.current = mapKey;',
    "    mapState.current = 'rift_battle';"
  ];
  const progressionLines = () => progression.split(/\r?\n/);
  const progressionTargetsReady = () => {
    const lines = progressionLines();
    return progressionTargets.every((target) => {
      const at = lines.indexOf(target);
      return at > 0 && lines[at - 1].includes(directMapLifecycleLine.trim());
    });
  };
  const progressionLifecycleCount = (progression.match(/__afkMobileMemoryLifecycle\('map-change'\)/g) || []).length;
  if (progressionLifecycleCount === 0) {
    for (const target of progressionTargets) {
      const anchor = new RegExp(`    saveSiegeBossHp\\(\\);\\r?\\n${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      if (!anchor.test(progression)) {
        throw new Error(`[${PROGRESSION_FILE}] 找不到直接進圖生命週期錨點：${target.trim()}`);
      }
      progression = progression.replace(anchor, `    saveSiegeBossHp();\n${directMapLifecycleLine}   // 🔌 直接進圖也必須釋放上一張圖片\n${target}`);
    }
  } else if (progressionLifecycleCount !== progressionTargets.length || !progressionTargetsReady()) {
    throw new Error(`[${PROGRESSION_FILE}] 直接進圖生命週期鉤子應完整存在 ${progressionTargets.length} 處，實際 ${progressionLifecycleCount}。`);
  }
  const worldMarkers = [
    '__afkMobileTownNpcFrames(key, false)',
    '__afkMobileTownNpcFrames(key, true)',
    '手機雙省電：城鎮也停止 8fps',
    "if (_changeTarget !== mapState.current && typeof window.__afkMobileMemoryLifecycle === 'function') window.__afkMobileMemoryLifecycle('map-change');"
  ];
  const worldDone = worldMarkers.every((marker) => world.includes(marker));
  if (!worldDone) {
    if (world.includes('__afkMobileTownNpcFrames') || world.includes("__afkMobileMemoryLifecycle('map-change')")) {
      throw new Error(`[${WORLD_FILE}] 手機 NPC／地圖生命週期鉤子只剩部分，拒絕靜默略過。`);
    }
    const bodyAnchor = `function _npcFrames(key) {`;
    const weaponAnchor = `function _npcWeaponFrames(key) {   // 🔥 火焰/武器疊層幀(idle_w_N)：僅 NPC_SPR 有 w 的（如宙斯之熔岩高崙）·與本體同幀數同步`;
    const tickAnchor = `function _townNpcAnimTick() {`;
    const mapAnchor = `    mapState.current = document.getElementById('map-select').value;`;
    for (const [label, anchor] of [['NPC body', bodyAnchor], ['NPC weapon', weaponAnchor], ['town ticker', tickAnchor], ['map lifecycle', mapAnchor]]) {
      if (!world.includes(anchor)) throw new Error(`[${WORLD_FILE}] 找不到 ${label} 錨點。`);
    }
    world = world.replace(bodyAnchor, `${bodyAnchor}
    let _mobileFrames = (typeof window.__afkMobileTownNpcFrames === 'function') ? window.__afkMobileTownNpcFrames(key, false) : null;
    if (_mobileFrames) return _mobileFrames;   // 🔌 手機雙省電：DOM 已載 idle_0，不建立完整站立序列`);
    world = world.replace(weaponAnchor, `${weaponAnchor}
    let _mobileFrames = (typeof window.__afkMobileTownNpcFrames === 'function') ? window.__afkMobileTownNpcFrames(key, true) : null;
    if (_mobileFrames) return _mobileFrames;   // 🔌 手機雙省電：DOM 已載 idle_w_0，不建立完整武器序列`);
    world = world.replace(tickAnchor, `${tickAnchor}
    if (typeof window.__afkMobileMemoryLite === 'function' && window.__afkMobileMemoryLite()) return;   // 🔌 手機雙省電：城鎮也停止 8fps`);
    world = world.replace(mapAnchor, `    if (_changeTarget !== mapState.current && typeof window.__afkMobileMemoryLifecycle === 'function') window.__afkMobileMemoryLifecycle('map-change');
${mapAnchor}`);
  }
  const sanctuaryLifecycleLine = `${directMapLifecycleLine}   // 🔌 隱藏聖地直接進圖也要形成圖片資源邊界`;
  const sanctuaryLifecycleCount = (world.match(/隱藏聖地直接進圖也要形成圖片資源邊界/g) || []).length;
  if (sanctuaryLifecycleCount === 0) {
    const sanctuaryAnchor = /    saveSiegeBossHp\(\);\r?\n    mapState\.current = mapKey;/;
    if (!sanctuaryAnchor.test(world)) {
      throw new Error(`[${WORLD_FILE}] 找不到 sanctuaryEnter 直接進圖生命週期錨點。`);
    }
    world = world.replace(sanctuaryAnchor, `    saveSiegeBossHp();\n${sanctuaryLifecycleLine}\n    mapState.current = mapKey;`);
  } else if (sanctuaryLifecycleCount !== 1 || !world.includes(sanctuaryLifecycleLine)) {
    throw new Error(`[${WORLD_FILE}] sanctuaryEnter 圖片生命週期鉤子不完整。`);
  }

  const VFX_FILE = 'js/09-vfx-render.js';
  let vfx = readLf(VFX_FILE);
  const probeLoaderSignature = 'function _probeFramesWin(urlFor, maxF, minF, done, stillCurrent)';
  const probeLoaderMarkers = [
    probeLoaderSignature,
    'const MOBILE_ACTIVE_CAP = 6, DESKTOP_ACTIVE_CAP = 12',
    'window.__afkCancelImageProbes = cancelAll',
    'window.__afkEnforceImageProbeCap = enforceCap',
    'window.__afkImageProbeStats = stats',
    '_probeFramesWin._scheduler = scheduler',
    'let results = [], active = Object.create(null)',
    'done(null, 0, true)',
    "im.removeAttribute('src')"
  ];
  if (!probeLoaderMarkers.every((marker) => vfx.includes(marker))) {
    const globalMarkers = [
      'MOBILE_ACTIVE_CAP',
      '__afkCancelImageProbes',
      '__afkEnforceImageProbeCap',
      '__afkImageProbeStats',
      '_probeFramesWin._scheduler'
    ];
    if (globalMarkers.some((marker) => vfx.includes(marker))) {
      throw new Error(`[${VFX_FILE}] 全域有界 probe loader 只剩部分，拒絕靜默略過。`);
    }
    const probeStart = vfx.indexOf('function _probeFramesWin(');
    const probeEnd = vfx.indexOf('function _mobAnimProbe(name)', probeStart);
    if (probeStart < 0 || probeEnd < 0) {
      throw new Error(`[${VFX_FILE}] 找不到 _probeFramesWin 完整區塊錨點。`);
    }
    const existingProbeLoader = vfx.slice(probeStart, probeEnd);
    for (const marker of ['_manifestCount(urlFor(0))', 'new Image()', 'function pump()']) {
      if (!existingProbeLoader.includes(marker)) {
        throw new Error(`[${VFX_FILE}] _probeFramesWin 缺少預期結構 ${marker}，拒絕不確定替換。`);
      }
    }
    const probeLoader = `function _probeFramesWin(urlFor, maxF, minF, done, stillCurrent) {
    // 每個序列只保留小窗口，所有 mob／玩家／傭兵／寵物序列再共用一個全域 semaphore。
    // 否則一隻多圖層怪會同時開 20+ 個序列，每序列 6 張仍足以瞬間壓垮手機解碼記憶體。
    const WIN = 6;
    let scheduler = _probeFramesWin._scheduler;
    if (!scheduler) {
        scheduler = (() => {
            const MOBILE_ACTIVE_CAP = 6, DESKTOP_ACTIVE_CAP = 12;
            let queue = [], activeJobs = new Set(), groups = new Set(), cancellingAll = false;
            function mobile() {
                try {
                    if (document.body && document.body.classList.contains('m-mobile')) return true;
                    return window.innerWidth <= 900 && !!window.matchMedia &&
                        window.matchMedia('(pointer: coarse)').matches;
                } catch (e) {
                    try { return window.innerWidth <= 900; } catch (e2) { return false; }
                }
            }
            function cap() { return mobile() ? MOBILE_ACTIVE_CAP : DESKTOP_ACTIVE_CAP; }
            let lastCap = cap();
            function queuedCount() {
                let total = 0;
                for (let job of queue) if (job && job.state === 'queued') total++;
                return total;
            }
            function unload(im) {
                if (!im) return;
                im.onload = im.onerror = null;
                try { im.removeAttribute('src'); }
                catch (e) { try { im.src = 'data:,'; } catch (e2) {} }
            }
            function enforceCap() {
                let nextCap = cap();
                let shrank = nextCap < lastCap;
                lastCap = nextCap;
                // 工作是以 probe group 完成；任意砍半個 group 會讓它的 inFlight 永遠不歸零。
                // cap 縮小且現有 active＋queued 超標時整批取消，讓呼叫端收到 cancelled、
                // 同步卸載 Image，下一次 render 再依新 cap 建立乾淨批次。
                if (shrank && activeJobs.size + queuedCount() > nextCap) {
                    cancelAll();
                    return true;
                }
                return false;
            }
            function drain() {
                if (cancellingAll) return;
                if (enforceCap()) return;
                let limit = cap();
                while (activeJobs.size < limit && queue.length) {
                    let job = queue.shift();
                    if (!job || job.state !== 'queued') continue;
                    job.state = 'active';
                    let im;
                    try { im = new Image(); }
                    catch (e) {
                        job.state = 'done';
                        let failed = job.settle;
                        job.settle = null;
                        if (failed) failed(false, null);
                        continue;
                    }
                    job.image = im;
                    activeJobs.add(job);
                    let finish = ok => {
                        if (job.state !== 'active') { unload(im); return; }
                        job.state = 'done';
                        activeJobs.delete(job);
                        im.onload = im.onerror = null;
                        let settle = job.settle;
                        job.settle = null;
                        try { if (settle) settle(ok, im); }
                        finally { drain(); }
                    };
                    im.onload = () => finish(true);
                    im.onerror = () => finish(false);
                    try { im.src = job.url; } catch (e) { finish(false); }
                }
            }
            function schedule(url, settle) {
                let job = { url: url, settle: settle, image: null, state: 'queued' };
                queue.push(job);
                return job;
            }
            function cancelJob(job) {
                if (!job || job.state === 'done' || job.state === 'cancelled') return;
                if (job.state === 'active') {
                    activeJobs.delete(job);
                    unload(job.image);
                }
                job.state = 'cancelled';
                job.settle = null;
                if (!cancellingAll) drain();
            }
            function cancelJobs(jobs) {
                let outerCancel = cancellingAll;
                cancellingAll = true;
                try {
                    for (let job of jobs) cancelJob(job);
                } finally {
                    cancellingAll = outerCancel;
                }
                if (!cancellingAll) drain();
            }
            function register(cancel) { groups.add(cancel); }
            function unregister(cancel) { groups.delete(cancel); }
            function cancelAll() {
                if (cancellingAll) return;
                cancellingAll = true;
                let pendingGroups = Array.from(groups);
                for (let cancel of pendingGroups) {
                    try { cancel(); } catch (e) {}
                }
                for (let job of queue) cancelJob(job);
                queue = [];
                for (let job of Array.from(activeJobs)) cancelJob(job);
                cancellingAll = false;
                drain();
            }
            function stats() {
                return { active: activeJobs.size, queued: queuedCount(), groups: groups.size, cap: cap() };
            }
            let api = { schedule, run: drain, cancel: cancelJob, cancelMany: cancelJobs, register, unregister, cancelAll, enforceCap, stats };
            try {
                window.__afkCancelImageProbes = cancelAll;
                window.__afkEnforceImageProbeCap = enforceCap;
                window.__afkImageProbeStats = stats;
            } catch (e) {}
            return api;
        })();
        _probeFramesWin._scheduler = scheduler;
    }
    let known = _manifestCount(urlFor(0));
    let stopAt = known === null ? maxF : Math.min(known, maxF);
    let need = minF || 2;
    let results = [], active = Object.create(null);
    let next = 0, inFlight = 0, finished = false;
    function current() {
        if (typeof stillCurrent !== 'function') return true;
        try { return stillCurrent() !== false; } catch (e) { return false; }
    }
    function unload(im) {
        if (!im) return;
        im.onload = im.onerror = null;
        try { im.removeAttribute('src'); }
        catch (e) { try { im.src = 'data:,'; } catch (e2) {} }
    }
    function releaseActive(from) {
        let jobs = [];
        Object.keys(active).forEach(k => {
            if (from !== undefined && Number(k) < from) return;
            let job = active[k];
            delete active[k];
            inFlight--;
            jobs.push(job);
        });
        scheduler.cancelMany(jobs);
    }
    function releaseResults(keep) {
        for (let i = keep || 0; i < results.length; i++) {
            if (results[i] && results[i] !== false) unload(results[i]);
        }
    }
    function cancel() {
        if (finished) return;
        finished = true;
        scheduler.unregister(cancel);
        releaseActive();
        releaseResults(0);
        done(null, 0, true);
    }
    function complete(n) {
        if (finished) return;
        finished = true;
        scheduler.unregister(cancel);
        let frames = n >= need ? results.slice(0, n) : null;
        releaseActive();
        releaseResults(frames ? n : 0);
        done(frames, n, false);
    }
    function settle(i, ok, im) {
        if (finished) { unload(im); return; }
        if (active[i] && active[i].image === im) {
            delete active[i];
            inFlight--;
        }
        if (!current()) { unload(im); cancel(); return; }
        if (ok) results[i] = im;
        else {
            results[i] = false;
            unload(im);
            if (i < stopAt) {
                stopAt = i;
                releaseActive(stopAt);
                releaseResults(stopAt);
            }
        }
        let n = 0;
        while (n < stopAt && results[n]) n++;
        if (n >= stopAt || results[n] === false) { complete(n); return; }
        pump();
    }
    function pump() {
        if (finished) return;
        if (!current()) { cancel(); return; }
        while (!finished && inFlight < WIN && next < stopAt) {
            if (!current()) { cancel(); return; }
            let i = next++;
            inFlight++;
            active[i] = scheduler.schedule(urlFor(i), (ok, im) => settle(i, ok, im));
        }
        scheduler.run();   // active[i] 全部賦值後才可建立 Image，涵蓋 constructor/src 同步拋錯
        if (!finished && stopAt === 0) complete(0);
    }
    scheduler.register(cancel);
    pump();
}
`;
    vfx = vfx.slice(0, probeStart) + probeLoader + vfx.slice(probeEnd);
  }

  const vfxEpochMarkers = [
    'let _mobMemoryEpoch =',
    '__afkMobileMemoryAcceptFrames(_mobMemoryEpoch)',
    '__afkMobileMemoryProbeCurrent(_mobMemoryEpoch)',
    'let _mob8MemoryEpoch =',
    '__afkMobileMemoryAcceptFrames(_mob8MemoryEpoch)',
    '__afkMobileMemoryProbeCurrent(_mob8MemoryEpoch)',
    'let _morphMemoryEpoch =',
    '__afkMobileMemoryAcceptFrames(_morphMemoryEpoch)',
    '__afkMobileMemoryProbeCurrent(_morphMemoryEpoch)'
  ];
  if (!vfxEpochMarkers.every((marker) => vfx.includes(marker))) {
    if (vfx.includes('__afkMobileMemoryAcceptFrames') || vfx.includes('__afkMobileMemoryFrameEpoch')) {
      throw new Error(`[${VFX_FILE}] 手機 probe epoch 鉤子只剩部分，拒絕靜默略過。`);
    }
    const mobStart = `    if (_mobAnimCache[name] !== undefined) return;`;
    const mob8Start = `    if (_mob8Cache[key] !== undefined) return;`;
    const morphStart = `function _battleSpriteProbe(form) {`;
    const mobFinish = `    let finish = () => { if (--pending > 0) return; _mobAnimCache[name] = (out.idle || out.spawn || out.attack || out.skill || out.hurt || out.death) ? out : null; };`;
    const mob8Finish = `    let finish = () => { if (--pending > 0) return; _mob8Cache[key] = out.idle ? out : null; };`;
    const morphFinish = `    let finish = () => { if (--pending <= 0) {`;
    for (const [label, anchor] of [['mob start', mobStart], ['mob8 start', mob8Start], ['morph start', morphStart], ['mob probe', mobFinish], ['mob8 probe', mob8Finish], ['morph probe', morphFinish]]) {
      if (!vfx.includes(anchor)) throw new Error(`[${VFX_FILE}] 找不到 ${label} 完成錨點。`);
    }
    vfx = vfx.replace(mobStart, `${mobStart}
    let _mobMemoryEpoch = (typeof window.__afkMobileMemoryFrameEpoch === 'function') ? window.__afkMobileMemoryFrameEpoch() : null;`);
    vfx = vfx.replace(mob8Start, `${mob8Start}
    let _mob8MemoryEpoch = (typeof window.__afkMobileMemoryFrameEpoch === 'function') ? window.__afkMobileMemoryFrameEpoch() : null;`);
    vfx = vfx.replace(morphStart, `${morphStart}
    let _morphMemoryEpoch = (typeof window.__afkMobileMemoryFrameEpoch === 'function') ? window.__afkMobileMemoryFrameEpoch() : null;`);
    vfx = vfx.replace(mobFinish, `    let finish = () => { if (--pending > 0) return; if (typeof window.__afkMobileMemoryAcceptFrames === 'function' && !window.__afkMobileMemoryAcceptFrames(_mobMemoryEpoch)) { if (typeof window.__afkMobileMemoryProbeCurrent !== 'function' || window.__afkMobileMemoryProbeCurrent(_mobMemoryEpoch)) delete _mobAnimCache[name]; return; } _mobAnimCache[name] = (out.idle || out.spawn || out.attack || out.skill || out.hurt || out.death) ? out : null; };`);
    vfx = vfx.replace(mob8Finish, `    let finish = () => { if (--pending > 0) return; if (typeof window.__afkMobileMemoryAcceptFrames === 'function' && !window.__afkMobileMemoryAcceptFrames(_mob8MemoryEpoch)) { if (typeof window.__afkMobileMemoryProbeCurrent !== 'function' || window.__afkMobileMemoryProbeCurrent(_mob8MemoryEpoch)) delete _mob8Cache[key]; return; } _mob8Cache[key] = out.idle ? out : null; };`);
    vfx = vfx.replace(morphFinish, `${morphFinish}
        if (typeof window.__afkMobileMemoryAcceptFrames === 'function' && !window.__afkMobileMemoryAcceptFrames(_morphMemoryEpoch)) { if (typeof window.__afkMobileMemoryProbeCurrent !== 'function' || window.__afkMobileMemoryProbeCurrent(_morphMemoryEpoch)) delete _morphBattleCache[form.key]; return; }`);
  }

  const vfxProbeMarkers = [
    'let _mobMemoryCurrent =',
    '}, _mobMemoryCurrent);',
    'let _mob8MemoryCurrent =',
    '_mob8MemoryCurrent);',
    'let _morphMemoryCurrent =',
    '_morphMemoryCurrent);'
  ];
  if (!vfxProbeMarkers.every((marker) => vfx.includes(marker))) {
    if (vfxProbeMarkers.some((marker) => vfx.includes(marker))) {
      throw new Error(`[${VFX_FILE}] probe 取消 predicate 只剩部分，拒絕靜默略過。`);
    }
    const mobEpoch = `    let _mobMemoryEpoch = (typeof window.__afkMobileMemoryFrameEpoch === 'function') ? window.__afkMobileMemoryFrameEpoch() : null;`;
    const mob8Epoch = `    let _mob8MemoryEpoch = (typeof window.__afkMobileMemoryFrameEpoch === 'function') ? window.__afkMobileMemoryFrameEpoch() : null;`;
    const morphEpoch = `    let _morphMemoryEpoch = (typeof window.__afkMobileMemoryFrameEpoch === 'function') ? window.__afkMobileMemoryFrameEpoch() : null;`;
    const mobCall = '        let attempt = () => _probeFramesWin(i => `assets/anim/${animName}/${prefixes[pi]}${i}.png`, MOB_ANIM_MAX_FRAMES, minF || 2, (frames, n) => {';
    const mobCallEnd = `            target[key] = frames; finish();
        });`;
    const mob8Call = `        _probeFramesWin(i => folder + pfx + i + '.png', MOB_ANIM_MAX_FRAMES, minF || 2, frames => { target[k] = frames; finish(); });`;
    const morphCall = `        _probeFramesWin(i => form.base + pfx + i + '.png', MOB_ANIM_MAX_FRAMES, minF || 2, frames => { target[key] = frames; finish(); });`;
    for (const [label, anchor] of [
      ['mob epoch', mobEpoch], ['mob8 epoch', mob8Epoch], ['morph epoch', morphEpoch],
      ['mob callback', mobCall], ['mob callback end', mobCallEnd],
      ['mob8 callback', mob8Call], ['morph callback', morphCall],
      ['mob fallback', 'if (!frames && n === 0 && pi + 1 < prefixes.length)']
    ]) {
      if (!vfx.includes(anchor)) throw new Error(`[${VFX_FILE}] 找不到 ${label} predicate 錨點。`);
    }
    vfx = vfx.replace(mobEpoch, `${mobEpoch}
    let _mobMemoryCurrent = () => typeof window.__afkMobileMemoryProbeCurrent !== 'function' || window.__afkMobileMemoryProbeCurrent(_mobMemoryEpoch);`);
    vfx = vfx.replace(mob8Epoch, `${mob8Epoch}
    let _mob8MemoryCurrent = () => typeof window.__afkMobileMemoryProbeCurrent !== 'function' || window.__afkMobileMemoryProbeCurrent(_mob8MemoryEpoch);`);
    vfx = vfx.replace(morphEpoch, `${morphEpoch}
    let _morphMemoryCurrent = () => typeof window.__afkMobileMemoryProbeCurrent !== 'function' || window.__afkMobileMemoryProbeCurrent(_morphMemoryEpoch);`);
    vfx = vfx.replace(mobCall, mobCall.replace('(frames, n) => {', '(frames, n, cancelled) => {'));
    vfx = vfx.replace('if (!frames && n === 0 && pi + 1 < prefixes.length)', 'if (!cancelled && !frames && n === 0 && pi + 1 < prefixes.length)');
    vfx = vfx.replace(mobCallEnd, `            target[key] = frames; finish();
        }, _mobMemoryCurrent);`);
    vfx = vfx.replace(mob8Call, `        _probeFramesWin(i => folder + pfx + i + '.png', MOB_ANIM_MAX_FRAMES, minF || 2, frames => { target[k] = frames; finish(); }, _mob8MemoryCurrent);`);
    vfx = vfx.replace(morphCall, `        _probeFramesWin(i => form.base + pfx + i + '.png', MOB_ANIM_MAX_FRAMES, minF || 2, frames => { target[key] = frames; finish(); }, _morphMemoryCurrent);`);
  }
  const vfxMarkers = [...probeLoaderMarkers, ...vfxEpochMarkers, ...vfxProbeMarkers];

  const PET_FILE = 'js/22-pets.js';
  let pets = readLf(PET_FILE);
  const petEpochMarkers = ['let _petMemoryEpoch =', '__afkMobileMemoryAcceptFrames(_petMemoryEpoch)', '__afkMobileMemoryProbeCurrent(_petMemoryEpoch)'];
  if (!petEpochMarkers.every((marker) => pets.includes(marker))) {
    if (pets.includes('__afkMobileMemoryAcceptFrames') || pets.includes('__afkMobileMemoryFrameEpoch')) {
      throw new Error(`[${PET_FILE}] 手機 pet probe epoch 鉤子只剩部分，拒絕靜默略過。`);
    }
    const petStart = `    if (_pet8Cache[key] !== undefined) return;`;
    const petFinish = `    let finish = () => { if (--pending > 0) return; _pet8Cache[key] = out.idle ? out : null; };`;
    if (!pets.includes(petStart) || !pets.includes(petFinish)) throw new Error(`[${PET_FILE}] 找不到 pet8 probe 錨點。`);
    pets = pets.replace(petStart, `${petStart}
    let _petMemoryEpoch = (typeof window.__afkMobileMemoryFrameEpoch === 'function') ? window.__afkMobileMemoryFrameEpoch() : null;`);
    pets = pets.replace(petFinish, `    let finish = () => { if (--pending > 0) return; if (typeof window.__afkMobileMemoryAcceptFrames === 'function' && !window.__afkMobileMemoryAcceptFrames(_petMemoryEpoch)) { if (typeof window.__afkMobileMemoryProbeCurrent !== 'function' || window.__afkMobileMemoryProbeCurrent(_petMemoryEpoch)) delete _pet8Cache[key]; return; } _pet8Cache[key] = out.idle ? out : null; };`);
  }
  const petProbeMarkers = ['let _petMemoryCurrent =', '_petMemoryCurrent);'];
  if (!petProbeMarkers.every((marker) => pets.includes(marker))) {
    if (petProbeMarkers.some((marker) => pets.includes(marker))) {
      throw new Error(`[${PET_FILE}] pet probe 取消 predicate 只剩部分，拒絕靜默略過。`);
    }
    const petEpoch = `    let _petMemoryEpoch = (typeof window.__afkMobileMemoryFrameEpoch === 'function') ? window.__afkMobileMemoryFrameEpoch() : null;`;
    const petCall = `        _probeFramesWin(i => folder + pfx + i + '.png', PET_ANIM_MAXF, minF || 2, frames => { target[k] = frames; finish(); });`;
    if (!pets.includes(petEpoch) || !pets.includes(petCall)) {
      throw new Error(`[${PET_FILE}] 找不到 pet probe predicate 錨點。`);
    }
    pets = pets.replace(petEpoch, `${petEpoch}
    let _petMemoryCurrent = () => typeof window.__afkMobileMemoryProbeCurrent !== 'function' || window.__afkMobileMemoryProbeCurrent(_petMemoryEpoch);`);
    pets = pets.replace(petCall, `        _probeFramesWin(i => folder + pfx + i + '.png', PET_ANIM_MAXF, minF || 2, frames => { target[k] = frames; finish(); }, _petMemoryCurrent);`);
  }
  const petMarkers = [...petEpochMarkers, ...petProbeMarkers];

  const MARKET_FILE = 'js/24-pandora-relic-market.js';
  let market = readLf(MARKET_FILE);
  const marketCleanupMarkers = [
    '__afkClearWanderingBuyerFrames',
    'img.onload = img.onerror = null',
    "img.removeAttribute('src')",
    "img.removeAttribute('srcset')",
    '_classFrameCache = Object.create(null)'
  ];
  const marketDone = market.includes('__afkMobileWanderingBuyerStill') &&
    marketCleanupMarkers.every((marker) => market.includes(marker));
  if (!marketDone) {
    if (market.includes('__afkMobileWanderingBuyerStill') ||
        market.includes('__afkClearWanderingBuyerFrames')) {
      throw new Error(`[${MARKET_FILE}] 玩家收購 NPC 手機鉤子只剩部分，拒絕靜默略過。`);
    }
    const folderAnchor = `        let folder = String((w && w.avatar) || '男騎士') + _dirs[_h % 3];`;
    const exportAnchor = `    window.wanderingBuyerSpriteData = wanderingBuyerSpriteData;`;
    if (!market.includes(folderAnchor) || !market.includes(exportAnchor)) {
      throw new Error(`[${MARKET_FILE}] 找不到玩家收購 NPC 快取錨點。`);
    }
    market = market.replace(folderAnchor, `${folderAnchor}
        let _mobileStill = (typeof window.__afkMobileWanderingBuyerStill === 'function') ? window.__afkMobileWanderingBuyerStill(w, folder) : null;
        if (_mobileStill) return _mobileStill;   // 🔌 手機雙省電：只交首幀 URL，不建立 body+shadow 完整序列`);
    market = market.replace(exportAnchor, `    window.__afkClearWanderingBuyerFrames = function () {
        Object.keys(_classFrameCache).forEach(function (key) {
            let entry = _classFrameCache[key];
            [entry && entry.frames, entry && entry.shadows].forEach(function (list) {
                (Array.isArray(list) ? list : []).forEach(function (img) {
                    if (!img) return;
                    img.onload = img.onerror = null;
                    try {
                        img.removeAttribute('src');
                        img.removeAttribute('srcset');
                    } catch (e) {
                        try { img.src = ''; } catch (_) {}
                    }
                });
            });
        });
        _classFrameCache = Object.create(null);   // 主動卸載 body+shadow Image，再丟棄快取
    };
${exportAnchor}`);
  }

  const SAVE_FILE = 'js/13-shop-save.js';
  let save = readLf(SAVE_FILE);
  const saveMarkers = [
    "__afkMobileMemoryLifecycle('character-select')",
    "__afkMobileMemoryLifecycle('role-load')",
    "__afkMobileMemoryLifecycle('role-start')",
    '父畫面隱藏時，子 panel 即使沒 hidden 也不可在遊戲背後逐幀解碼',
    '進遊戲後子 panel 也明確隱藏，禁止背景逐幀與圖片回流'
  ];
  const baseLifecycle = [
    "__afkMobileMemoryLifecycle('character-select')",
    "__afkMobileMemoryLifecycle('role-load')",
    "__afkMobileMemoryLifecycle('role-start')"
  ];
  if (!baseLifecycle.every((marker) => save.includes(marker))) {
    if (baseLifecycle.some((marker) => save.includes(marker))) {
      throw new Error(`[${SAVE_FILE}] 手機角色生命週期鉤子只剩部分，拒絕靜默略過。`);
    }
    const selectAnchor = `    try { if(typeof _bgmTick === 'function') { _bgmScene = null; _bgmTick(); } } catch(e) {}`;
    const loadAnchor = `        player = d.p; mapState = d.ms;`;
    const startAnchor = `    document.body.classList.add('game-bg-dim');   // 正式遊戲後：背景淡化`;
    for (const [label, anchor] of [['character select', selectAnchor], ['load role', loadAnchor], ['start role', startAnchor]]) {
      if (!save.includes(anchor)) throw new Error(`[${SAVE_FILE}] 找不到 ${label} 生命週期錨點。`);
    }
    save = save.replace(selectAnchor, `    if (typeof window.__afkMobileMemoryLifecycle === 'function') window.__afkMobileMemoryLifecycle('character-select');
${selectAnchor}`);
    save = save.replace(loadAnchor, `        if (typeof window.__afkMobileMemoryLifecycle === 'function') window.__afkMobileMemoryLifecycle('role-load');
${loadAnchor}`);
    save = save.replace(startAnchor, `${startAnchor}
    if (typeof window.__afkMobileMemoryLifecycle === 'function') window.__afkMobileMemoryLifecycle('role-start');`);
  }
  const readyCount = (save.match(/__afkMobileMemoryLifecycle\('role-ready'\)/g) || []).length;
  if (readyCount === 0) {
    const createReadyAnchor = "    startGameTimers();\n    logSys(`===== 歡迎來到天堂放置冒險 =====`);";
    const loadReadyAnchor = "        startGameTimers();\n        logSys(`===== 歡迎回來 =====`);";
    if (!save.includes(createReadyAnchor) || !save.includes(loadReadyAnchor)) {
      throw new Error(`[${SAVE_FILE}] 找不到新建／讀檔 role-ready 錨點。`);
    }
    save = save.replace(createReadyAnchor, "    startGameTimers();\n    if (typeof window.__afkMobileMemoryLifecycle === 'function') window.__afkMobileMemoryLifecycle('role-ready');\n    logSys(`===== 歡迎來到天堂放置冒險 =====`);");
    save = save.replace(loadReadyAnchor, "        startGameTimers();\n        if (typeof window.__afkMobileMemoryLifecycle === 'function') window.__afkMobileMemoryLifecycle('role-ready');\n        logSys(`===== 歡迎回來 =====`);");
  } else if (readyCount !== 2) {
    throw new Error(`[${SAVE_FILE}] role-ready 鉤子應有 2 處，實際 ${readyCount}。`);
  }
  if (!save.includes('父畫面隱藏時，子 panel 即使沒 hidden 也不可在遊戲背後逐幀解碼')) {
    const tickerAnchor = `        const panel = document.getElementById('load-select-panel');
        if(panel && !panel.classList.contains('hidden') && !(typeof window.__afkMobileMemoryLite === 'function' && window.__afkMobileMemoryLite()) && now - _loadAnimState.lastAt >= _loadAnimState.stepMs){`;
    if (!save.includes(tickerAnchor)) throw new Error(`[${SAVE_FILE}] 找不到選角逐幀可見性錨點。`);
    save = save.replace(tickerAnchor, `        const panel = document.getElementById('load-select-panel');
        const screen = document.getElementById('creation-screen');   // 🔌 父畫面隱藏時，子 panel 即使沒 hidden 也不可在遊戲背後逐幀解碼
        const game = document.getElementById('game-screen');
        if(panel && screen && !screen.classList.contains('hidden') && (!game || game.classList.contains('hidden')) &&
           !panel.classList.contains('hidden') && !(typeof window.__afkMobileMemoryLite === 'function' && window.__afkMobileMemoryLite()) && now - _loadAnimState.lastAt >= _loadAnimState.stepMs){`);
  }
  if (!save.includes('進遊戲後子 panel 也明確隱藏，禁止背景逐幀與圖片回流')) {
    const loadHideAnchor = `        document.getElementById('creation-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');`;
    if (!save.includes(loadHideAnchor)) throw new Error(`[${SAVE_FILE}] 找不到讀檔隱藏選角面板錨點。`);
    save = save.replace(loadHideAnchor, `        document.getElementById('creation-screen').classList.add('hidden');
        { let _loadPanel = document.getElementById('load-select-panel'); if (_loadPanel) _loadPanel.classList.add('hidden'); }   // 🔌 進遊戲後子 panel 也明確隱藏，禁止背景逐幀與圖片回流
        document.getElementById('game-screen').classList.remove('hidden');`);
  }
  if ((save.match(/__afkMobileMemoryLifecycle\('role-ready'\)/g) || []).length !== 2) {
    throw new Error(`[${SAVE_FILE}] role-ready 鉤子驗證失敗。`);
  }

  const doneBefore = readFileSync(WORLD_FILE, 'utf8').includes('__afkMobileTownNpcFrames') &&
    worldMarkers.every((marker) => readFileSync(WORLD_FILE, 'utf8').includes(marker)) &&
    (readFileSync(WORLD_FILE, 'utf8').match(/隱藏聖地直接進圖也要形成圖片資源邊界/g) || []).length === 1 &&
    (readFileSync(PROGRESSION_FILE, 'utf8').match(/__afkMobileMemoryLifecycle\('map-change'\)/g) || []).length === progressionTargets.length &&
    vfxMarkers.every((marker) => readFileSync(VFX_FILE, 'utf8').includes(marker)) &&
    petMarkers.every((marker) => readFileSync(PET_FILE, 'utf8').includes(marker)) &&
    readFileSync(MARKET_FILE, 'utf8').includes('__afkMobileWanderingBuyerStill') &&
    readFileSync(MARKET_FILE, 'utf8').includes('__afkClearWanderingBuyerFrames') &&
    saveMarkers.every((marker) => readFileSync(SAVE_FILE, 'utf8').includes(marker)) &&
    (readFileSync(SAVE_FILE, 'utf8').match(/__afkMobileMemoryLifecycle\('role-ready'\)/g) || []).length === 2;
  if (doneBefore) { already++; return; }
  if (!CHECK) {
    writeFileSync(WORLD_FILE, world);
    writeFileSync(PROGRESSION_FILE, progression);
    writeFileSync(VFX_FILE, vfx);
    writeFileSync(PET_FILE, pets);
    writeFileSync(MARKET_FILE, market);
    writeFileSync(SAVE_FILE, save);
  }
  changed++;
  console.log(`[patch] 手機圖片生命週期／城鎮首幀閘門（${WORLD_FILE}、${PROGRESSION_FILE}、${VFX_FILE}、${PET_FILE}、${MARKET_FILE}、${SAVE_FILE}）`);
}

// ── 補丁 14：手機登入背景與隱藏創角資源延遲載入 ───────────────────
function patchMobileLoginResources() {
  const FILE = 'index.html';
  let s = readFileSync(FILE, 'utf8');
  const lazyIds = ['load-select-bg', 'load-select-overlay', 'creation-bg-image', 'class-preview-img'];
  const lazyIdReady = lazyIds.every((id) => {
    const tag = (s.match(new RegExp('<img\\s+id="' + id + '"[^>]*>')) || [])[0] || '';
    return tag.includes('loading="lazy"') && tag.includes('decoding="async"') &&
      tag.includes('data-afk-mobile-lazy="1"');
  });
  const lazyLogoCount = (s.match(/class="creation-class-btn[^>]*>\s*<img[^>]*data-afk-mobile-lazy="1"[^>]*>/g) || []).length;
  const loginMarkers = [
    'window.__afkIsMobileDevice = function ()',
    "localStorage.getItem('afk_toggle_powersave')",
    "localStorage.getItem('afk_ps_noanim') === '1'",
    "localStorage.getItem('afk_ps_lowfps') === '1'",
    "document.documentElement.classList.add('afk-memory-lite-boot')",
    'var nextFrame=first+1,preloadRunning=false,preloadTimer=0,preloadImage=null;',
    'function pausePreload()',
    "preloadImage.removeAttribute('src')",
    'function creationVisible()',
    "window.addEventListener('afk-mobile-memory-change'",
    "window.addEventListener('afk-mobile-memory-login'",
    "if(ready&&img&&screen&&!screen.classList.contains('hidden')&&!memoryLite()"
  ];
  const loginReady = lazyIdReady && lazyLogoCount === 8 &&
    loginMarkers.every((marker) => s.includes(marker));
  if (loginReady) { already++; return; }

  const headAnchor = `    <title>放置天堂 - 日出之國</title>`;
  if (!s.includes(headAnchor)) throw new Error(`[${FILE}] 找不到 head 啟動錨點。`);
  const bootstrap = `    <!-- 🔌 加掛版補丁：在大型 CSS 圖進入 computed style 前讀取既有雙省電設定，避免先解碼 3344×1882 body 背景。 -->
    <script>
      try {
        window.__afkIsMobileDevice = function () {
          return (typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches) ||
            /Android|iPhone|iPad|iPod|Mobile/i.test((navigator && navigator.userAgent) || '') ||
            (innerWidth || 9999) <= 820;
        };
        var afkPsToggle = localStorage.getItem('afk_toggle_powersave');
        if ((afkPsToggle === null || afkPsToggle === '1') &&
            localStorage.getItem('afk_ps_noanim') === '1' && localStorage.getItem('afk_ps_lowfps') === '1' &&
            window.__afkIsMobileDevice()) {
          document.documentElement.classList.add('afk-memory-lite-boot');
        }
      } catch (e) {}
    </script>
    <style>html.afk-memory-lite-boot body{background-image:linear-gradient(135deg,#172033 0%,#101827 48%,#080d18 100%)!important;background-attachment:scroll!important;}</style>

`;
  const bootstrapStart = s.indexOf('    <!-- 🔌 加掛版補丁：在大型 CSS 圖進入 computed style 前讀取既有雙省電設定');
  if (bootstrapStart >= 0) {
    const styleEnd = s.indexOf('</style>', bootstrapStart);
    if (styleEnd < 0) throw new Error(`[${FILE}] 手機登入背景啟動區塊缺少 </style>。`);
    const blockEnd = styleEnd + '</style>'.length;
    s = s.slice(0, bootstrapStart) + bootstrap.trimEnd() + s.slice(blockEnd);
  } else if (!s.includes('afk-memory-lite-boot')) {
    s = s.replace(headAnchor, bootstrap + headAnchor);
  }

  for (const id of lazyIds) {
    const tagRe = new RegExp('<img\\s+id="' + id + '"[^>]*>');
    const tag = (s.match(tagRe) || [])[0];
    if (!tag) throw new Error(`[${FILE}] 找不到隱藏登入圖片 #${id}。`);
    if (tag.includes('data-afk-mobile-lazy')) continue;
    const re = new RegExp('(<img\\s+id="' + id + '"\\s+)(?![^>]*data-afk-mobile-lazy)');
    s = s.replace(re, '$1loading="lazy" decoding="async" data-afk-mobile-lazy="1" ');
  }
  const logoRe = /(<button[^>]+class="creation-class-btn[^>]*><img\s+)(?![^>]*data-afk-mobile-lazy)/g;
  s = s.replace(logoRe, '$1loading="lazy" decoding="async" data-afk-mobile-lazy="1" ');
  if ((s.match(/data-afk-mobile-lazy="1"/g) || []).length < 12) {
    throw new Error(`[${FILE}] 隱藏登入圖片 lazy 標記不足 12 張。`);
  }

  if (!s.includes('var nextFrame=first+1') || !s.includes('function pausePreload()') ||
      !s.includes('function creationVisible()') ||
      !s.includes("window.addEventListener('afk-mobile-memory-change'") ||
      !s.includes("window.addEventListener('afk-mobile-memory-login'")) {
    const loginStartText = `      // 登入頁逐幀動畫：273.png～300.png，使用相對路徑，GitHub Pages 可直接部署。`;
    const loginEndText = `      })();`;
    const loginStart = s.indexOf(loginStartText);
    const loginEndAt = s.indexOf(loginEndText, loginStart);
    if (loginStart < 0 || loginEndAt < 0) {
      throw new Error(`[${FILE}] 找不到完整登入逐幀預載區塊。`);
    }
    const loginEnd = loginEndAt + loginEndText.length;
    const preloader = `      // 登入頁逐幀動畫：273.png～300.png；雙省電可中止在途預載，關閉後從斷點恢復。
      (function(){
        var first=273,last=300,frame=first,lastAt=0,stepMs=90,ready=false;
        var nextFrame=first+1,preloadRunning=false,preloadTimer=0,preloadImage=null;
        var base='public/assets/login/';
        function memoryLite(){
          return typeof window.__afkMobileMemoryLite==='function'&&window.__afkMobileMemoryLite();
        }
        function creationVisible(){
          var screen=document.getElementById('creation-screen');
          return !!(screen&&!screen.classList.contains('hidden'));
        }
        function preloadNext(){
          if(ready||memoryLite()||!creationVisible()){preloadRunning=false;return;}
          if(nextFrame>last){ready=true;preloadRunning=false;return;}
          preloadRunning=true;
          var n=nextFrame,p=new Image();
          preloadImage=p;
          var settle=function(){
            if(preloadImage!==p)return;
            p.onload=p.onerror=null;
            preloadImage=null;
            nextFrame=n+1;
            preloadRunning=false;
            preloadNext();
          };
          p.onload=p.onerror=settle;
          p.src=base+n+'.png';
        }
        function beginPreload(){
          if(ready||preloadRunning||preloadTimer||memoryLite()||!creationVisible())return;
          preloadTimer=setTimeout(function(){preloadTimer=0;preloadNext();},500);
        }
        function pausePreload(){
          if(preloadTimer){clearTimeout(preloadTimer);preloadTimer=0;}
          if(preloadImage){
            preloadImage.onload=preloadImage.onerror=null;
            try{preloadImage.removeAttribute('src');}catch(e){}
            preloadImage=null;
          }
          preloadRunning=false;
        }
        if(document.readyState==='complete')beginPreload();
        else window.addEventListener('load',beginPreload,{once:true});
        window.addEventListener('afk-mobile-memory-change',function(event){
          if(event&&event.detail&&event.detail.active)pausePreload();
          else beginPreload();
        });
        window.addEventListener('afk-mobile-memory-login',function(event){
          if(event&&event.detail&&event.detail.visible)beginPreload();
          else pausePreload();
        });
        function animateLogin(now){
          var screen=document.getElementById('creation-screen');
          var img=document.getElementById('login-anim-image');
          if(ready&&img&&screen&&!screen.classList.contains('hidden')&&!memoryLite()&&now-lastAt>=stepMs){
            frame=frame>=last?first:frame+1;
            img.src=base+frame+'.png';
            lastAt=now;
          }
          requestAnimationFrame(animateLogin);
        }
        requestAnimationFrame(animateLogin);
      })();`;
    s = s.slice(0, loginStart) + preloader + s.slice(loginEnd);
  }

  const finalLazyIdReady = lazyIds.every((id) => {
    const tag = (s.match(new RegExp('<img\\s+id="' + id + '"[^>]*>')) || [])[0] || '';
    return tag.includes('loading="lazy"') && tag.includes('decoding="async"') &&
      tag.includes('data-afk-mobile-lazy="1"');
  });
  const finalLazyLogoCount = (s.match(/class="creation-class-btn[^>]*>\s*<img[^>]*data-afk-mobile-lazy="1"[^>]*>/g) || []).length;
  const missingLoginMarkers = loginMarkers.filter((marker) => !s.includes(marker));
  if (!finalLazyIdReady || finalLazyLogoCount !== 8 || missingLoginMarkers.length) {
    throw new Error(`[${FILE}] 手機登入資源閘門產生不完整：` +
      `${!finalLazyIdReady ? '4 張固定圖片 lazy 不完整；' : ''}` +
      `${finalLazyLogoCount !== 8 ? `職業 logo=${finalLazyLogoCount}/8；` : ''}` +
      missingLoginMarkers.join(' | '));
  }

  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 手機登入背景／隱藏選角資源閘門（${FILE}）`);
}

// ── 補丁 15：手機雙省電的卡片圖鑑只用單層縮圖 ─────────────────────
function patchMobileCardThumbGate() {
  const FILE = 'js/15-cards.js';
  let s = readFileSync(FILE, 'utf8');
  const desired = "    if (typeof window.__afkMobileMemoryLite === 'function' && window.__afkMobileMemoryLite()) return single;   // 🔌 手機雙省電縮圖已含完整單層，不疊回原尺寸影子／武器";
  if (s.includes(desired)) { already++; return; }
  if (s.includes('__afkMobileMemoryLite') || s.includes('手機雙省電縮圖已含完整單層')) {
    throw new Error(`[${FILE}] 手機卡片縮圖閘門只剩部分，拒絕用註解誤判完成。`);
  }
  const anchor = `    if (silh) return single;   // 剪影(未收集)：黑影單張即可`;
  if (!s.includes(anchor)) throw new Error(`[${FILE}] 找不到卡片圖鑑縮圖錨點。`);
  s = s.replace(anchor, `${anchor}
${desired}`);
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 手機卡片圖鑑單層縮圖閘門（${FILE}）`);
}

// ── 補丁 16：背景心跳 Worker 建構失敗也撤銷 Blob URL ──────────────────
function patchBackgroundHeartbeatBlobLifecycle() {
  const FILE = 'js/01-drops-config.js';
  let s = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  const doneMarker = 'URL.revokeObjectURL(_u);   // Worker 建立同步失敗時也必須釋放 Blob URL';
  if (s.includes(doneMarker)) { already++; return; }
  if (s.includes('new Worker(_u)') && /finally\s*\{\s*URL\.revokeObjectURL\(_u\)/.test(s)) {
    throw new Error(`[${FILE}] 背景心跳 Worker Blob URL 補丁只剩部分，拒絕靜默略過。`);
  }
  const anchor =
`        _bgHeartbeatWorker = new Worker(_u);
        URL.revokeObjectURL(_u);`;
  if (!s.includes(anchor)) {
    throw new Error(`[${FILE}] 找不到背景心跳 Worker Blob URL 錨點。`);
  }
  s = s.replace(anchor,
`        try {
            _bgHeartbeatWorker = new Worker(_u);
        } finally {
            URL.revokeObjectURL(_u);   // Worker 建立同步失敗時也必須釋放 Blob URL
        }`);
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 背景心跳 Worker Blob URL 生命週期（${FILE}）`);
}

// ── 補丁 17：手機前景補算降低主執行緒 duty cycle ─────────────────────
function patchMobileCatchupScheduler() {
  const FILE = 'js/03-combat-core.js';
  let s = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  const doneMarkers = [
    'const FF_MOBILE_BUDGET_MS = 12;',
    'function _ffMobileDevice()',
    'function _ffShouldYield(budget0, mobile)',
    'window.__afkCatchupPolicy = function ()',
    '}, _ffYieldMs());'
  ];
  if (doneMarkers.every((marker) => s.includes(marker))) { already++; return; }
  if (doneMarkers.some((marker) => s.includes(marker))) {
    throw new Error(`[${FILE}] 手機補算排程補丁只剩部分，拒絕靜默略過。`);
  }

  s = s.replace(
`    // ⏩ 補跑路徑（v3.6.95 重建 v3.2.78 時間預算榨乾制）：每次呼叫最多吃 FF_BUDGET_MS 計算時間就讓步，
    //    未還完的債留待下次呼叫（每 4 tick 量一次 performance.now·FF_HARD_CAP 保底防單次過量）。`,
`    // ⏩ 補跑路徑（v3.6.95 重建 v3.2.78 時間預算榨乾制）：每次呼叫最多吃目前裝置的時間預算就讓步，
    //    未還完的債留待下次呼叫（手機每 tick、桌機每 4 tick 檢查·FF_HARD_CAP 保底防單次過量）。`);
  s = s.replace(
`    let ran = 0, budget0 = now;
    let _burstMax = owed;`,
`    let ran = 0, budget0 = now;
    let _ffMobile = _ffMobileDevice();
    let _burstMax = owed;`);
  s = s.replace(
`            if ((ran & 3) === 0) {
                let t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                if (t - budget0 >= FF_BUDGET_MS) break;
            }`,
`            if ((_ffMobile || (ran & 3) === 0) && _ffShouldYield(budget0, _ffMobile)) break;`);
  s = s.replace(
`// ⏩ 補跑專用快速排程：每批最多運算 80ms、讓出 8ms 後續跑；仍逐 tick 真實結算。
const FF_BUDGET_MS = 80;
const FF_YIELD_MS = 8;`,
`// ⏩ 補跑專用快速排程：桌機維持 80/8ms；手機以 12/48ms 降到約 20% duty。
//    只改分片與讓步，不封頂時間債、不抽樣放大收益，RNG／死亡／藥水／掉落仍逐 tick 相同。
const FF_BUDGET_MS = 80;
const FF_YIELD_MS = 8;
const FF_MOBILE_BUDGET_MS = 12;
const FF_MOBILE_YIELD_MS = 48;`);
  s = s.replace(
`let _ffResumeTimer = null;
let _ffProgressEl = null;`,
`let _ffResumeTimer = null;
let _ffProgressEl = null;

function _ffMobileDevice() {
    try {
        if (typeof window !== 'undefined' && typeof window.__afkIsMobileDevice === 'function') {
            return !!window.__afkIsMobileDevice();
        }
        if (typeof document !== 'undefined' && document.body && document.body.classList.contains('m-mobile')) return true;
        return (typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches) ||
            (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')) ||
            (typeof innerWidth === 'number' && innerWidth <= 820);
    } catch (e) { return false; }
}

function _ffBudgetMs(mobile) { return mobile ? FF_MOBILE_BUDGET_MS : FF_BUDGET_MS; }
function _ffYieldMs() { return _ffMobileDevice() ? FF_MOBILE_YIELD_MS : FF_YIELD_MS; }
function _ffShouldYield(budget0, mobile) {
    try {
        if (typeof navigator !== 'undefined' && navigator.scheduling &&
            typeof navigator.scheduling.isInputPending === 'function' && navigator.scheduling.isInputPending()) return true;
    } catch (e) {}
    let t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return t - budget0 >= _ffBudgetMs(mobile);
}
if (typeof window !== 'undefined') {
    window.__afkCatchupPolicy = function () {
        let mobile = _ffMobileDevice();
        return { mobile: mobile, budgetMs: _ffBudgetMs(mobile), yieldMs: mobile ? FF_MOBILE_YIELD_MS : FF_YIELD_MS };
    };
}`);
  s = s.replace('    }, FF_YIELD_MS);', '    }, _ffYieldMs());');

  const missing = doneMarkers.filter((marker) => !s.includes(marker));
  if (missing.length || !s.includes('(_ffMobile || (ran & 3) === 0) && _ffShouldYield')) {
    throw new Error(`[${FILE}] 手機補算排程產生不完整：${missing.join(' | ') || '逐 tick 讓步閘門'}`);
  }
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 手機補算 12/48ms 與輸入讓步（${FILE}）`);
}

// ── 補丁 18：補算 wall-time 守恆、進度節流與錯誤停損 ────────────────
function patchMobileCatchupAccounting() {
  const FILE = 'js/03-combat-core.js';
  let s = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  const doneMarkers = [
    '_ffProgressUpdate(_ffAcc, _tickDebt, true);',
    'function _ffReanchorCatchupClock()',
    'const FF_PROGRESS_INTERVAL_MS = 250;',
    'function _ffProgressUpdate(acc, remainingMs, force)',
    'if (player.dead || _ffAcc.aborted) _tickDebt = 0;',
    'let _ffResumeGeneration = 0;',
    '_ffResumeToken !== _ffResumeGeneration',
    '_ffResumeGeneration++;',
    '補跑 tick／進度 DOM 是償還既有時間債的 housekeeping',
    '收尾重繪／大型存檔也屬於 housekeeping',
    '前景補跑讓步時間暫停遊戲鐘',
    "try { logSys('<span class=\"text-red-400 font-bold\">補跑連續發生錯誤"
  ];
  if (doneMarkers.every((marker) => s.includes(marker))) { already++; return; }
  if (doneMarkers.some((marker) => s.includes(marker))) {
    throw new Error(`[${FILE}] 手機補算正確性補丁只剩部分，拒絕靜默略過。`);
  }

  const replaceExact = (from, to, label) => {
    const first = s.indexOf(from);
    const second = first < 0 ? -1 : s.indexOf(from, first + from.length);
    if (first < 0 || second >= 0) {
      throw new Error(`[${FILE}] 找不到唯一「${label}」錨點。`);
    }
    s = s.slice(0, first) + to + s.slice(first + from.length);
  };

  replaceExact(
`        _ffProgressUpdate(_ffAcc, _tickDebt);
        _ffScheduleNext();`,
`        _ffProgressUpdate(_ffAcc, _tickDebt, true);
        _ffReanchorCatchupClock();   // 補跑提示屬於 housekeeping；重錨後不讓提示成本反過來製造新債務
        _ffScheduleNext();`,
    '首次進度繪製');

  replaceExact(
`    if (player.dead) _tickDebt = 0;   // 進入下方統一收尾與最終重繪，不留下死亡後的補跑債務
    if (!_hidden) _ffProgressUpdate(_ffAcc, _tickDebt);
    if (_tickDebt < TICK_MS) {   // 補跑完畢`,
`    if (!_hidden) _ffProgressUpdate(_ffAcc, _tickDebt);
    // 補跑 tick／進度 DOM 是償還既有時間債的 housekeeping，本身不得再製造新債務；
    // 否則單 tick + 48ms 讓步超過 100ms 的慢手機永遠追不完，save/render 也會形成回授。
    _ffReanchorCatchupClock();
    if (player.dead || _ffAcc.aborted) _tickDebt = 0;   // 重錨後再清除，三次錯誤停損不會被本批耗時復活
    if (_tickDebt < TICK_MS) {   // 補跑完畢`,
    '批次 wall-time 與停止順序');

  replaceExact(
`    if (_acc.aborted && typeof logSys === 'function') {
        logSys('<span class="text-red-400 font-bold">補跑連續發生錯誤，已停止剩餘補跑，避免進度卡在重複補跑；請重新整理後確認。</span>');
    }`,
`    if (_acc.aborted && typeof logSys === 'function') {
        try { logSys('<span class="text-red-400 font-bold">補跑連續發生錯誤，已停止剩餘補跑，避免進度卡在重複補跑；請重新整理後確認。</span>'); } catch (e) {}
    }`,
    '錯誤提示清理');

  replaceExact(
`const FF_MOBILE_YIELD_MS = 48;
const FF_HARD_CAP = 6000;`,
`const FF_MOBILE_YIELD_MS = 48;
const FF_PROGRESS_INTERVAL_MS = 250;
const FF_HARD_CAP = 6000;`,
    '進度節流常數');

  replaceExact(
`let _ffResumeTimer = null;
let _ffProgressEl = null;`,
`let _ffResumeTimer = null;
let _ffResumeGeneration = 0;   // invalidate 已排入 task queue、clearTimeout 也未必攔得住的舊前景 callback
let _ffProgressEl = null;`,
    '續跑 callback 世代');

  replaceExact(
`function _ffYieldMs() { return _ffMobileDevice() ? FF_MOBILE_YIELD_MS : FF_YIELD_MS; }
function _ffShouldYield(budget0, mobile) {`,
`function _ffYieldMs() { return _ffMobileDevice() ? FF_MOBILE_YIELD_MS : FF_YIELD_MS; }
function _ffReanchorCatchupClock() {
    _loopLast = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return _loopLast;
}
function _ffShouldYield(budget0, mobile) {`,
    '補跑虛擬時鐘重錨 helper');

  replaceExact(
`function _ffProgressUpdate(acc, remainingMs) {
    if (!acc || typeof document === 'undefined' || document.hidden) return;`,
`function _ffProgressUpdate(acc, remainingMs, force) {
    if (!acc || typeof document === 'undefined' || document.hidden) return;
    let paintNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!force && Number.isFinite(acc.progressPaintAt) && paintNow - acc.progressPaintAt < FF_PROGRESS_INTERVAL_MS) return;
    acc.progressPaintAt = paintNow;`,
    '進度 DOM 節流');

  replaceExact(
`    _ffErrorStreak = 0;
    _ffProgressHide();
}`,
`    _ffErrorStreak = 0;
    _ffProgressHide();
    _ffReanchorCatchupClock();   // 收尾重繪／大型存檔也屬於 housekeeping，不可回灌成 finish→save 迴圈
}`,
    '補跑收尾時鐘重錨');

  replaceExact(
`    _ffResumeTimer = setTimeout(function () {
        _ffResumeTimer = null;
        if (_tickDebt >= TICK_MS && state && state.running && player && !player.dead) gameLoop();`,
`    let _ffResumeToken = ++_ffResumeGeneration;
    _ffResumeTimer = setTimeout(function () {
        if (_ffResumeToken !== _ffResumeGeneration) return;   // hide／換角已取消；不得清掉新 timer 或吞掉背景 elapsed
        _ffResumeTimer = null;
        if (typeof document === 'undefined' || !document.hidden) _ffReanchorCatchupClock();   // 前景補跑讓步時間暫停遊戲鐘；背景 heartbeat 仍由正常 elapsed 全額入債
        if (_tickDebt >= TICK_MS && state && state.running && player && !player.dead) gameLoop();`,
    '前景續跑虛擬時鐘');

  replaceExact(
`function _ffCancelScheduledLoop() {
    if (_ffResumeTimer !== null) clearTimeout(_ffResumeTimer);`,
`function _ffCancelScheduledLoop() {
    _ffResumeGeneration++;
    if (_ffResumeTimer !== null) clearTimeout(_ffResumeTimer);`,
    '續跑 callback 取消世代');

  const missing = doneMarkers.filter((marker) => !s.includes(marker));
  if (missing.length || /overloadDroppedMs|FF_MOBILE_MAX_CATCHUP_WALL_MS|adaptiveMinTicks/.test(s)) {
    throw new Error(`[${FILE}] 手機補算正確性產生不完整或含危險停損：${missing.join(' | ') || 'unsafe marker'}`);
  }
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 手機補算 wall-time 守恆、進度節流與錯誤停損（${FILE}）`);
}

// ── 補丁 19：切換前後景時作廢舊補跑 callback ───────────────────────
function patchBackgroundCatchupTimerCancellation() {
  const FILE = 'js/01-drops-config.js';
  let s = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  const hiddenMarker = '凍結前作廢前景續跑；回前景不得由逾期 callback 先吞掉 hidden elapsed';
  const pagehideMarker = 'bfcache／pagehide 也作廢已排程的前景 callback';
  if (s.includes(hiddenMarker) && s.includes(pagehideMarker)) { already++; return; }
  if (s.includes(hiddenMarker) || s.includes(pagehideMarker)) {
    throw new Error(`[${FILE}] 前後景補跑 timer 取消補丁只剩部分，拒絕靜默略過。`);
  }

  const replaceExact = (from, to, label) => {
    const first = s.indexOf(from);
    const second = first < 0 ? -1 : s.indexOf(from, first + from.length);
    if (first < 0 || second >= 0) throw new Error(`[${FILE}] 找不到唯一「${label}」錨點。`);
    s = s.slice(0, first) + to + s.slice(first + from.length);
  };

  replaceExact(
`        if (document.hidden) { if (!_ffHiddenAt) _ffHiddenAt = _perfNow(); return; }`,
`        if (document.hidden) {
            if (typeof _ffCancelScheduledLoop === 'function') _ffCancelScheduledLoop();   // 凍結前作廢前景續跑；回前景不得由逾期 callback 先吞掉 hidden elapsed
            if (!_ffHiddenAt) _ffHiddenAt = _perfNow();
            return;
        }`,
    'visibility hidden 分支');

  replaceExact(
`if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pageshow', function (ev) {`,
`if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', function () {
        if (typeof _ffCancelScheduledLoop === 'function') _ffCancelScheduledLoop();   // bfcache／pagehide 也作廢已排程的前景 callback
    });
    window.addEventListener('pageshow', function (ev) {`,
    'pagehide 取消分支');

  if (!s.includes(hiddenMarker) || !s.includes(pagehideMarker)) {
    throw new Error(`[${FILE}] 前後景補跑 timer 取消補丁產生不完整。`);
  }
  if (!CHECK) writeFileSync(FILE, s);
  changed++;
  console.log(`[patch] 前後景切換作廢舊補跑 callback（${FILE}）`);
}

const PATCHES = [patchMaybeSpawnMobs, patchTradEnHook, patch16Slots, patchPetAnimTicker, patchBossHuntEscape, patchUseItemKeepModal, patchSellNowNoForce, patchLegacyOfflineOwnership, patchVersionedAssetCaches, patchMobileMemoryPreviewGate, patchMobileMobThumbGate, patchCoalescedSaveCompression, patchMobileImageLifecycleHooks, patchMobileLoginResources, patchMobileCardThumbGate, patchBackgroundHeartbeatBlobLifecycle, patchMobileCatchupScheduler, patchMobileCatchupAccounting, patchBackgroundCatchupTimerCancellation];

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
