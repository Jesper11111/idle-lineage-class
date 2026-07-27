/* ============================================================================
 * smoke-hooks.mjs — 冒煙測試:用無頭瀏覽器載入 index.html,確認五支外掛都 hook 成功
 *
 * 用途:自動同步 PP index.html 後,驗證 PP 更新沒有改壞外掛掛點(改 id / DOM 結構)。
 *   - 全部 hooks OK → exit 0(workflow 才會 commit/push)
 *   - 任一外掛沒掛上 → exit 1(workflow 改為開 issue 通知,不自動推壞掉的版本)
 * ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium, devices } from 'playwright';

const PORT = 8799;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));

// 本機桌面附帶的 Playwright 版本可能比已快取 browser revision 新；Windows 優先使用系統 Chrome。
// GitHub Actions（Linux）仍使用 `npx playwright install` 安裝的預設 Chromium。
const systemChrome = platform() === 'win32'
  ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
     'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)
  : null;
const browser = await chromium.launch(systemChrome ? { executablePath: systemChrome } : {});
const logs = [];

// 各外掛的開機 log:'[AFK] hooks OK' / '[AFK-mobile] hooks OK' / …(集中定義,goto 後輪詢等待 + 最後判定共用)
// afk-mobile 為「桌機零接觸」設計——只有偵測到手機尺寸/裝置才會 init 並印出 hooks OK(見 afk-mobile.js);
//   故它單獨在「手機模擬」那一輪驗,桌機那輪不列入(否則桌機永遠等不到它、smoke 假性失敗)。
// afk-battlehud 桌機也會 init(只是 CSS 讓它不顯示)→ 放 need 即可;它取代的是核心手機版 #mobile-vitals。
// afk-touchtip 只在觸控裝置 init(桌機有 hover,本來就不該掛)→ 桌機那輪永遠等不到,必須放手機輪。
const needMobileOnly = ['[AFK-touchtip]'];
const need = ['[AFK]', '[AFK-merc-policy]', '[AFK-banner]', '[AFK-mobile-banner]', '[AFK-mobile-memory]', '[AFK-mobile-audio-memory]', '[AFK-lzcache]', '[AFK-synccompress]', '[AFK-mobile]', '[AFK-backnav]', '[AFK-battlehud]', '[AFK-mapbar]', '[AFK-nozoom]', '[AFK-trackinfo]', '[AFK-relicguard]', '[AFK-enhtarget]', '[AFK-retrial]', '[AFK-battlebuffs]', '[AFK-slotinfo]', '[AFK-dex]', '[AFK-wiki]', '[AFK-syncinfo]', '[AFK-statpts]', '[AFK-statlist]', '[AFK-pwa]', '[AFK-storage]', '[AFK-history]', '[AFK-quotawarn]', '[AFK-notice]', '[AFK-reissueid]', '[AFK-diag]', '[AFK-mobname]', '[AFK-training]', '[AFK-powersave]', '[AFK-powersave-inventory]', '[AFK-itemsearch]', '[AFK-eqlist]', '[AFK-npclist]', '[AFK-skin]', '[AFK-junkmgr]', '[AFK-mercguard]'];
const seen = (list) => list.every((n) => logs.some((l) => l.includes(n) && l.includes('hooks OK')));

// ⚠ 不用 waitUntil:'networkidle':作者新版(.49 起)加了背景音樂 assets/bgm/*.mp3，<audio> 媒體串流會讓網路
//   「永遠不靜止」→ networkidle 等不到逾時、smoke 假性失敗、自動同步整個卡住(踩過 2026-06-30,掛點其實全正常)。
//   改成 domcontentloaded + 輪詢「外掛是否都印出 hooks OK」,既驗到掛點、又完全不受媒體/長連線影響。

// --- 第一輪:桌機視窗,驗桌機面向的 12 支外掛 + 地圖翻譯 ---
const page = await browser.newPage();
page.on('console', (m) => logs.push(m.text()));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
const _deadline = Date.now() + 20000;   // 最多等 20 秒讓全部外掛初始化(CI 較慢)
while (Date.now() < _deadline && !seen(need)) await page.waitForTimeout(200);
await page.waitForTimeout(300);   // 緩衝:讓 hooks 之後的索引(dex/wiki)與 AFK_EXTRA 建好,再做地圖翻譯檢查

// 全裝置都必須隱藏 PP 的來源橫幅；桌機也不可留下高度或讓位空白。
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = '_orig_pbar';
  d.style.cssText = 'position:fixed;left:0;right:0;top:0;height:52px;background:#123;z-index:2147483647;';
  d.textContent = '這是非官方轉載版本，前往官方最新版：shines871.github.io/idle-lineage-class';
  document.body.appendChild(d);
  if (window.AFK_BANNER) AFK_BANNER.remeasure();
});
await page.waitForTimeout(150);
const desktopBannerProblems = await page.evaluate(() => {
  const bad = [];
  const bar = document.getElementById('_orig_pbar');
  const barH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--orig-bar-h')) || 0;
  if (!bar || getComputedStyle(bar).display !== 'none' || bar.getBoundingClientRect().height !== 0) {
    bad.push('桌機上的非官方轉載橫幅仍可見');
  }
  if (barH !== 0) bad.push(`桌機隱藏橫幅後 --orig-bar-h 仍是 ${barH}px`);
  return bad;
});
await page.evaluate(() => {
  const bar = document.getElementById('_orig_pbar');
  if (bar) bar.remove();
  if (window.AFK_BANNER) AFK_BANNER.remeasure();
});

// --- 第二輪:手機模擬(iPhone 13),專驗 afk-mobile 的三欄掛點在作者最新 DOM 上仍成立 ---
//   afk-mobile 只在手機時 init,桌機那輪印不出 hooks OK;用真手機模擬(pointer:coarse/UA)讓它跑起來才驗得到。
const mctx = await browser.newContext({ ...devices['iPhone 13'] });
const mpage = await mctx.newPage();
mpage.on('console', (m) => logs.push(m.text()));
await mpage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
const _mDeadline = Date.now() + 20000;
while (Date.now() < _mDeadline && !seen(needMobileOnly)) await mpage.waitForTimeout(200);
const mobileBottomScrollProblems = await mpage.evaluate(() => {
  const bad = [];
  const right = document.getElementById('col-right');
  if (!right) return ['手機右欄不存在'];
  document.documentElement.style.setProperty('--m-nav-h', '39px');
  document.body.classList.add('m-mobile', 'mview-right');
  const spacer = getComputedStyle(right, '::after');
  const flexBasis = parseFloat(spacer.flexBasis) || 0;
  if (spacer.content === 'none' || spacer.display === 'none' || flexBasis < 39) {
    bad.push(`隱藏橫幅後右欄尾端捲動緩衝不足（display=${spacer.display}, flex-basis=${spacer.flexBasis}）`);
  }
  const game = document.getElementById('game-screen');
  if (!game || !getComputedStyle(game).touchAction.includes('pan-y')) {
    bad.push('手機主畫面未明確允許垂直觸控捲動');
  }
  return bad;
});

// --- 第三輪:手機 + 「手機版面」外掛關閉 ---
//   為什麼要驗這個:玩家可以逐支關外掛,但 afk-toggles 的逃生門按鈕與各外掛入口「不可以跟著消失」——
//   否則玩家關掉某支外掛後連把它開回來的入口都沒有,變成死結(2026-07-20 實際回報)。
//   歷史成因都是「基礎設施依賴了可被關掉的外掛」:逃生門的 top 讀 afk-mobile 設的 --orig-bar-h、
//   afk-skin 靠 afk-mobile 掛的 body.m-mobile 判斷手機。前兩輪都是「全開」狀態,永遠測不到。
const octx = await browser.newContext({ ...devices['iPhone 13'] });
const opage = await octx.newPage();
await opage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await opage.evaluate(() => localStorage.setItem('afk_toggle_mobile', '0'));
await opage.reload({ waitUntil: 'domcontentloaded' });
await opage.waitForTimeout(3000);
// 模擬線上的非官方橫幅：全裝置政策必須把它隱藏，即使「手機版面」外掛已關閉。
await opage.evaluate(() => {
  if (document.getElementById('_orig_pbar')) return;
  const d = document.createElement('div');
  d.id = '_orig_pbar';
  d.style.cssText = 'position:fixed;left:0;right:0;top:0;height:92px;background:#123;z-index:2147483647;';   // z-index 要用線上實測值(遊戲橫幅是 int 上限);設低了會蓋不住按鈕、測不出遮蔽
  // ⚠ 文字不可省:外掛認橫幅是靠文字比對(/shines871|官方|非官方|轉載/,見 afk-mobile/afk-battlehud 的 findBanner)。
  //   沒文字的假橫幅在偵測邏輯眼中根本不存在 → 只測得到「z-index 硬蓋」,完全驗不到「量測→讓位」那條路徑。
  d.textContent = '這是非官方轉載版本，前往官方最新版：shines871.github.io/idle-lineage-class';
  document.body.appendChild(d);
});
await opage.waitForTimeout(1500);
const toggleOffProblems = await opage.evaluate(() => {
  const bad = [];
  // 橫幅隱藏政策不可依賴可停用的 afk-mobile；關掉手機版面後仍須維持。
  const bar = document.getElementById('_orig_pbar');
  const barH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--orig-bar-h')) || 0;
  if (!bar || getComputedStyle(bar).display !== 'none' || bar.getBoundingClientRect().height !== 0) {
    bad.push('手機上的非官方轉載橫幅仍可見');
  }
  if (barH !== 0) bad.push(`手機隱藏橫幅後 --orig-bar-h 仍是 ${barH}px`);
  const btn = document.getElementById('afk-toggles-entry');
  if (!btn) bad.push('左上角「外掛開關」逃生門按鈕不存在');
  else {
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!(r.width > 0 && r.height > 0)) bad.push('逃生門按鈕沒有尺寸');
    else if (!(top === btn || btn.contains(top))) bad.push(`逃生門按鈕被「${(top && (top.id || top.tagName)) || '未知元素'}」蓋住,點不到`);
  }
  // 入口(掉落查詢/小百科)在手機上必須直接可見,不可被收進桌機用的 Modal
  for (const [sel, nm] of [['.m-dex-entry-main', '掉落查詢入口'], ['.m-wiki-entry-main', '小百科入口']]) {
    const el = document.querySelector(sel);
    if (!el) { bad.push(nm + '不存在'); continue; }
    if (el.getBoundingClientRect().height <= 0) bad.push(nm + '高度為 0(被收進桌機 Modal?)');
  }
  return bad;
});

// --- 第四輪:平板幾何(觸控 + 寬 > 768),驗右欄分頁不會「內外兩層都不捲」---
//   afk-mobile 的 detectMobile() 只要 pointer:coarse 就算手機,範圍比上游 CSS 的手機斷點
//   (max-width:768px / max-height:520px and pointer:coarse)大 → 觸控平板在我方眼中是手機、在上游眼中是桌機。
//   我方「把分頁攤平、交給 #game-screen 單層捲」那組規則若沒包進上游同一條 media query,平板就會拿到
//   「分頁不捲(我方規則) + #game-screen 也不捲(上游桌機幾何)」→ 道具/防具/設定超出畫面的部分永遠
//   看不到也滑不到(2026-07-25 玩家回報)。前三輪都是手機或桌機尺寸,正好落在這道縫的兩側,測不到。
const tctx = await browser.newContext({
  viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const tpage = await tctx.newPage();
await tpage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await tpage.waitForTimeout(3000);
const tabletProblems = await tpage.evaluate(() => {
  const bad = [];
  const SCROLLABLE = ['auto', 'scroll'];
  const oy = (el) => getComputedStyle(el).overflowY;
  if (!document.body.classList.contains('m-mobile')) return bad;
  if (matchMedia('(max-width: 768px), (max-height: 520px) and (pointer: coarse)').matches) return bad;
  const gs = document.getElementById('game-screen');
  if (gs && SCROLLABLE.includes(oy(gs))) return bad;
  const panel = document.getElementById('tab-content-panel');
  if (panel && oy(panel) === 'visible') bad.push('#tab-content-panel 被攤平(overflow-y:visible),但 #game-screen 不是捲動容器');
  for (const id of ['tab-items', 'tab-weapons', 'tab-armors', 'tab-automation']) {
    const el = document.getElementById(id);
    if (!el) { bad.push(`#${id} 不存在(上游改了分頁 id?)`); continue; }
    if (!SCROLLABLE.includes(oy(el))) bad.push(`#${id} 不是捲動容器(overflow-y:${oy(el)}),而 #game-screen 也不捲`);
  }
  return bad;
});

// 🗺️ 地圖名翻譯覆蓋檢查:掉落查詢的「出沒地圖」來源＝DB.maps 的 key,經 AFK_EXTRA.mapName 解析。
//   mapName 查不到任一中文來源時會原樣回傳英文 id(name === id),這就是「漏翻」的精準訊號。
//   作者新增「不在 MAP_CATEGORIES/MAP_REGIONS/DB.towns…」的地圖結構時會被這裡擋下 → 提醒補進 mapName。
const untranslatedMaps = await page.evaluate(() => {
  const out = [];
  try {
    const mn = (window.AFK_EXTRA && AFK_EXTRA.mapName) ? AFK_EXTRA.mapName : null;
    if (mn && typeof DB !== 'undefined' && DB.maps) {
      for (const id of Object.keys(DB.maps)) {
        const nm = String(mn(id));
        if (nm === id || /[A-Za-z]/.test(nm)) out.push([id, nm]);   // 原樣回傳 id 或仍含英文字母 = 漏翻
      }
    }
  } catch (e) {}
  return out;
});

// 離線引擎互斥契約：PP v3.8.5 不載入 js/27；獨立 owner 只在沒有其他離線鉤子時授權舊引擎。
const offlineEngineProblems = await page.evaluate(() => {
  const bad = [];
  if (window.__afkLegacyOfflineOwnsSettlement !== true) bad.push('afk-offline-owner 未授權舊版離線引擎獨占');
  if (!window.__afk || window.__afk.version !== '2.2.0-jesper-safety') bad.push('afk-offline 安全版未成功啟動');
  for (const name of ['offlineCatchupSaveCommitted', 'offlineSettleCatchup', 'offlinePrepareCharacterSelect']) {
    if (typeof window[name] !== 'undefined') bad.push(`新版離線全域 ${name} 仍存在`);
  }
  const rows = window.AFK_TOGGLES && AFK_TOGGLES.list ? AFK_TOGGLES.list() : [];
  for (const id of ['offline', 'history']) {
    const row = rows.find((r) => r.id === id);
    if (!row) bad.push(`外掛開關缺少 ${id}`);
    else if (row.locked) bad.push(`${id} 仍被 locked`);
  }
  const blocked = window.__afk && window.__afk.blockedInstanceMap;
  for (const id of ['antharas_nest_1', 'antharas_nest_2', 'antharas_nest_3', 'antharas_lair']) {
    if (typeof blocked !== 'function' || !blocked(id)) bad.push(`安塔瑞斯副本未禁止離線：${id}`);
  }
  for (const id of ['siege_v2_kent_outer', 'siege_v2_kent_gate', 'siege_v2_kent_tower_guard', 'siege_v2_kent_tower', 'siege_v2_kent_lord']) {
    if (typeof blocked !== 'function' || !blocked(id)) bad.push(`攻城 V2 暫態地圖未禁止離線：${id}`);
  }
  if (typeof blocked === 'function' && blocked('dragon_valley')) bad.push('一般狩獵圖被誤判為禁止離線');
  if (!window.__afk || __afk.offStatsSchema !== 2 ||
      __afk.offStatsRuleset !== 'pp-v3.8.5+shines-v3.8.27-content-r2-bossring' ||
      typeof __afk.offStatsSignature !== 'function') {
    bad.push('離線 _offStats v5 完整簽章契約未啟動');
  } else {
    // 純記憶體測試，不呼叫 saveGame：配點/自動設定、套裝詞綴與傭兵任一變動都必須使快取失效。
    const oldConfig = player.config;
    const oldAllies = player.allies;
    const oldArmor = player.eq && player.eq.armor;
    try {
      const base = __afk.offStatsSignature();
      player.config = Object.assign({}, oldConfig || {}, { __sigProbeAutoSkill: true });
      const configChanged = __afk.offStatsSignature();
      player.config = oldConfig;
      if (configChanged === base) bad.push('離線快取簽章未涵蓋自動技能／設定');

      if (!player.eq) player.eq = {};
      player.eq.armor = { id: '__sig_probe_armor', en: 0, seteff: '白鳥', attrMagic: 'fire', attrMagicStar: 3 };
      const affixA = __afk.offStatsSignature();
      player.eq.armor.seteff = '紅獅';
      const affixB = __afk.offStatsSignature();
      player.eq.armor = oldArmor;
      if (affixA === affixB) bad.push('離線快取簽章未涵蓋套裝／隨機詞綴');

      player.allies = (oldAllies || []).concat([{
        _slot:'__sig_probe', cls:'mage', lv:80, base:{ int:60 }, d:{ int:80, sp:30 },
        skills:['sk_fireball'], config:{ autoBuffSkills:{ sk_fireball:true } },
        eq:{ shield:{ id:'relic_necro_book', en:0 } }
      }]);
      const allyChanged = __afk.offStatsSignature();
      player.allies = oldAllies;
      if (allyChanged === base) bad.push('離線快取簽章未涵蓋傭兵戰力／技能／裝備');

      if (!window.AFK_BOSSRING || typeof AFK_BOSSRING.offlineStep !== 'function' ||
          typeof AFK_BOSSRING.offlineCatchupActive !== 'function' ||
          typeof AFK_BOSSRING.signature !== 'function') {
        bad.push('自動找 BOSS 未暴露離線結算橋接介面');
      } else {
        const bossCb = document.getElementById('set-teleport-boss');
        if (!bossCb) {
          bad.push('自動找 BOSS 勾選框未注入');
        } else {
          const oldBossOn = bossCb.checked;
          bossCb.checked = !oldBossOn;
          bossCb.dispatchEvent(new Event('change'));
          const bossSettingChanged = __afk.offStatsSignature();
          bossCb.checked = oldBossOn;
          bossCb.dispatchEvent(new Event('change'));
          if (bossSettingChanged === base) bad.push('離線快取簽章未涵蓋自動找 BOSS 開關');
        }

        const oldInv = player.inv;
        const oldRings = {};
        for (const slot of ['ring1', 'ring2', 'ring3', 'ring4']) {
          oldRings[slot] = player.eq && player.eq[slot];
          if (player.eq) player.eq[slot] = null;
        }
        try {
          player.inv = (oldInv || []).filter((item) => item && item.id !== 'acc_116');
          const noBackpackRing = __afk.offStatsSignature();
          player.inv = player.inv.concat([{ id:'acc_116', uid:'__sig_probe_bossring', cnt:1 }]);
          const withBackpackRing = __afk.offStatsSignature();
          if (withBackpackRing === noBackpackRing) bad.push('離線快取簽章未涵蓋背包內傳送控制戒指');
        } finally {
          player.inv = oldInv;
          for (const slot of ['ring1', 'ring2', 'ring3', 'ring4']) {
            if (player.eq) player.eq[slot] = oldRings[slot];
          }
        }
      }
    } catch (e) {
      bad.push('離線快取簽章測試例外：' + e.message);
    } finally {
      player.config = oldConfig;
      player.allies = oldAllies;
      if (!player.eq) player.eq = {};
      player.eq.armor = oldArmor;
    }
  }
  return bad;
});

// 背包省電層必須是最外層 renderTabs wrapper；只有印出 hooks OK 還不夠。
// 若上游新增外掛在它之後重新包裝 renderTabs，戰鬥 tick 仍會先付出昂貴的背包掃描成本。
const powersaveInventoryProblems = await page.evaluate(() => {
  const bad = [];
  const p = window.__afkPsInventory;
  if (!p || p.version !== '1.2.0-local') bad.push('背包增量更新模組未啟動');
  if (p && (p.countPatchMs !== 250 || p.fullRebuildMs !== 1000)) {
    bad.push(`背包增量更新節流參數異常（${p.countPatchMs}/${p.fullRebuildMs}ms）`);
  }
  if (!p || p.autoSortDeferred !== true ||
      typeof window.autoSortInventory !== 'function' ||
      window.autoSortInventory.__afkPsInventory !== true) {
    bad.push('自動整理仍可繞過背包增量更新');
  }
  if (typeof window.renderTabs !== 'function' || window.renderTabs.__afkPsInventory !== true) {
    bad.push('背包增量更新不是最外層 renderTabs wrapper');
  }
  return bad;
});

// 舊傭兵獎勵／招募／受僱政策＋回城免費刷新 + PP v3.8.5 戰鬥模組並存契約。
const mercPolicyProblems = await page.evaluate(() => {
  const bad = [];
  const p = window.__legacyMercPolicy;
  if (!p || p.version !== '3.7.61-hybrid-drop60-town-refresh-on-pp-v3.8.5') bad.push('傭兵混合政策層未啟動');
  if (typeof GAME_VERSION === 'undefined' || GAME_VERSION !== 'v3.8.5') bad.push(`核心版本不是 v3.8.5（${typeof GAME_VERSION === 'undefined' ? 'missing' : GAME_VERSION}）`);
  if (!p || p.dropPerMercPct !== 60 || p.goldPartyMultiplier !== false) bad.push('傭兵掉寶／金幣政策中繼資料錯誤');
  if (typeof partyRewardMult !== 'function' || partyRewardMult() !== 1) bad.push('金幣仍按隊伍人數加乘');
  if (typeof partyDropMult !== 'function' || typeof partyDropRate !== 'function') {
    bad.push('傭兵掉寶倍率函式未載入');
  } else {
    const oldAllies = player.allies;
    const setAlive = n => {
      player.allies = Array.from({ length: n }, (_, i) => ({ uid: `drop-test-${i}`, _downed: false }));
    };
    const near = (a, b) => Math.abs(a - b) <= 1e-12;
    try {
      setAlive(0);
      if (!near(partyDropMult(), 1) || !near(partyDropRate(0.125), 0.125)) bad.push('無傭兵掉寶倍率不是 ×1');
      setAlive(1);
      if (!near(partyDropMult(), 1.6) || !near(partyDropRate(0.125), 0.2)) bad.push('1 名傭兵掉寶倍率不是 ×1.6');
      player.allies.push({ uid: 'drop-test-downed', _downed: true });
      if (!near(partyDropMult(), 1.6)) bad.push('倒地傭兵仍被計入掉寶倍率');
      setAlive(3);
      if (!near(partyDropMult(), 2.8) || !near(partyDropRate(0.125), 0.35)) bad.push('3 名傭兵掉寶倍率不是 ×2.8');
      setAlive(7);
      if (!near(partyDropMult(), 5.2) || !near(partyDropRate(0.25), 1)) bad.push('王族 7 名傭兵不是 ×5.2 或單件掉率未封頂 100%');
    } finally {
      player.allies = oldAllies;
    }
  }
  if (typeof mercRehireCost !== 'function' || mercRehireCost(1) !== 0 || mercRehireCost(50) !== 0 || mercRehireCost(100) !== 0) bad.push('傭兵快照更新仍會收費');
  if (typeof currentRoleMercenaryEmployer !== 'function' || currentRoleMercenaryEmployer() !== null) bad.push('反向受僱登記仍生效');
  if (typeof mercenaryRoleBattleBlocked !== 'function' || mercenaryRoleBattleBlocked('dragon_valley', false) !== false) bad.push('受僱角色仍被鎖在安全區');
  if (typeof refreshAllAllies !== 'function' || refreshAllAllies === mercBankAlliesAtTown ||
      !p || p.townRefresh !== true || p.paidManualRehire !== false) {
    bad.push('回城未使用免費自動刷新戰力快照政策');
  }
  if (typeof renderAllyNPC !== 'function' || String(renderAllyNPC).includes('onclick="rehireAlly')) bad.push('傭兵面板仍顯示手動重新招募按鈕');
  if (!p || p.elementRestriction !== false || typeof allySkillElementOk !== 'function' ||
      allySkillElementOk({ elfEle: 'water', grantedSkills: [] }, 'sk_elf_dancefire') !== true) {
    bad.push('妖精傭兵仍受目前屬性限制');
  }
  if (typeof THREAT_ENABLED === 'undefined' || THREAT_ENABLED !== true || typeof threatWrap !== 'function' || typeof victimThreatWeight !== 'function') bad.push('PP 威脅系統未載入');
  if (!window.SiegeV2 || !Array.isArray(SiegeV2.stages) || SiegeV2.stages.length !== 5) bad.push('PP 攻城 V2 未載入');
  if (typeof castleGuardTick !== 'function' || typeof castleGuardSync !== 'function') bad.push('PP 城堡護衛未載入');
  if (typeof TEAM_AURA_SKILLS === 'undefined' || !TEAM_AURA_SKILLS.includes('sk_elf_dancefire')) bad.push('PP v3.8.5 舞躍之火團隊光環未載入');
  return bad;
});

// --- 第四輪:離線掛機外掛關閉 ---
// 關閉代表完全不做離線結算，不能因舊引擎未啟動而讓 js/27 新引擎回退接管。
const fctx = await browser.newContext();
const fpage = await fctx.newPage();
await fpage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await fpage.evaluate(() => localStorage.setItem('afk_toggle_offline', '0'));
await fpage.reload({ waitUntil: 'domcontentloaded' });
await fpage.waitForTimeout(500);
const offlineToggleOffProblems = await fpage.evaluate(() => {
  const bad = [];
  if (window.__afkLegacyOfflineOwnsSettlement !== true) bad.push('關閉舊引擎後，owner 獨占標記消失');
  if (typeof window.__afk !== 'undefined') bad.push('關閉離線掛機後，舊引擎仍啟動');
  for (const name of ['offlineCatchupSaveCommitted', 'offlineSettleCatchup', 'offlinePrepareCharacterSelect']) {
    if (typeof window[name] !== 'undefined') bad.push(`關閉舊引擎後，新版離線全域 ${name} 回退啟動`);
  }
  return bad;
});

await browser.close();
server.close();

const okMap = {};
for (const n of [...need, ...needMobileOnly]) okMap[n] = logs.some((l) => l.includes(n) && l.includes('hooks OK'));
const allOK = Object.values(okMap).every(Boolean);

console.log('外掛掛點檢查:', JSON.stringify(okMap, null, 0));
if (!allOK) {
  console.error('冒煙測試失敗:有外掛沒有成功 hook(PP 更新可能改了 DOM / id)。');
  process.exit(1);
}

if (desktopBannerProblems.length) {
  console.error('冒煙測試失敗:桌機橫幅未完全隱藏:');
  for (const p of desktopBannerProblems) console.error('  ' + p);
  process.exit(1);
}

if (toggleOffProblems.length) {
  console.error('冒煙測試失敗:全裝置橫幅隱藏或關閉「手機版面」後的逃生門/入口不正確:');
  for (const p of toggleOffProblems) console.error('  ' + p);
  console.error('  判準:不可停用的基礎設施不能依賴可被關掉的外掛提供的 CSS 變數 / body class。');
  process.exit(1);
}

if (mobileBottomScrollProblems.length) {
  console.error('冒煙測試失敗:隱藏來源橫幅後，手機右欄短內容可能被底部導覽蓋住且無法起捲:');
  for (const p of mobileBottomScrollProblems) console.error('  ' + p);
  process.exit(1);
}

if (tabletProblems.length) {
  console.error('冒煙測試失敗:平板(觸控·寬 820)上右欄分頁內外兩層都不捲,超出畫面的內容看不到也滑不到:');
  for (const p of tabletProblems) console.error('  ' + p);
  console.error('  判準:要覆寫上游「寫在 media query 裡」的樣式時,自己的規則必須包進同一條 media query');
  console.error('       (afk-mobile.js 的 MOBILE_GEOM_MQ);只寫 body.m-mobile 會讓觸控平板拿到混搭幾何。');
  process.exit(1);
}

if (untranslatedMaps.length) {
  console.error('冒煙測試失敗:掉落查詢有地圖名未翻譯(會顯示英文 id),請補進 afk-extradata.js 的 AFK_EXTRA.mapName:');
  for (const [id, nm] of untranslatedMaps) console.error(`  ${id}  ->  ${nm}`);
  process.exit(1);
}

if (offlineEngineProblems.length) {
  console.error('冒煙測試失敗:離線引擎互斥／恢復契約不成立:');
  for (const p of offlineEngineProblems) console.error('  ' + p);
  process.exit(1);
}

if (offlineToggleOffProblems.length) {
  console.error('冒煙測試失敗:關閉離線掛機後，新版離線引擎回退接管:');
  for (const p of offlineToggleOffProblems) console.error('  ' + p);
  process.exit(1);
}

if (powersaveInventoryProblems.length) {
  console.error('冒煙測試失敗:背包增量更新載入／包裝順序不正確:');
  for (const p of powersaveInventoryProblems) console.error('  ' + p);
  process.exit(1);
}

if (mercPolicyProblems.length) {
  console.error('冒煙測試失敗:傭兵混合政策與 v3.8.5 戰鬥模組並存契約不成立:');
  for (const p of mercPolicyProblems) console.error('  ' + p);
  process.exit(1);
}

console.log('冒煙測試通過:外掛 hooks、舊離線互斥、傭兵混合政策與 v3.8.5 戰鬥模組均成立，且地圖名已完整翻譯。');
