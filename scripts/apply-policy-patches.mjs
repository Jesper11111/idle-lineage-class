/**
 * apply-policy-patches.mjs — PP 核心同步後，固定使用者指定的傭兵混合獎勵政策。
 *
 * 修改 js/05 的獎勵公式與 afk-wiki 的政策說明；招募費用、回城免費自動刷新與
 * 受僱限制由 afk-merc-policy.js 覆寫。其他戰鬥函式仍來自 PP 最新版。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const FILE = 'js/05-kill-progression.js';
const OLD_MARKER = '// 🔒 legacy-merc-policy: v3.7.61 均分經驗、金幣與掉落不按隊伍人數加乘。';
const MARKER = '// 🔒 legacy-merc-policy: v3.7.61 經驗均分、金幣不加乘；掉寶每名未倒地傭兵 +60%。';
// 官方 Windows checkout 可能是 CRLF；錨點一律用 LF 比對，stamp-code-versions 也採相同正規化。
let src = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

function replaceOne(from, to, label) {
  const at = src.indexOf(from);
  if (at < 0) throw new Error(`[${FILE}] 找不到「${label}」錨點；官方可能改寫獎勵公式，拒絕默默套用。`);
  if (src.indexOf(from, at + from.length) >= 0) throw new Error(`[${FILE}] 「${label}」錨點出現不只一次，拒絕不確定替換。`);
  src = src.slice(0, at) + to + src.slice(at + from.length);
}

const upstreamRewardBlock =
  "function partyExpShareCount() { return partyActiveMemberCount(); }   // 相容 native-preview／舊外部呼叫；不再作為除數\n" +
  "function partyRewardMult() { return partyActiveMemberCount(); }\n" +
  "function partyDropRate(rate) { return Math.min(1, Math.max(0, Number(rate) || 0) * partyRewardMult()); }";
const oldRewardBlock =
  "function partyExpShareCount() { return partyActiveMemberCount(); }   // 🔒 舊傭兵政策：主玩家＋未倒地傭兵均分\n" +
  "function partyRewardMult() { return 1; }   // 🔒 舊傭兵政策：金幣／掉落不按隊伍人數加乘\n" +
  "function partyDropRate(rate) { return Math.min(1, Math.max(0, Number(rate) || 0)); }";
const localRewardBlock =
  "function partyExpShareCount() { return partyActiveMemberCount(); }   // 🔒 舊傭兵政策：主玩家＋未倒地傭兵均分\n" +
  "function partyRewardMult() { return 1; }   // 🔒 本地政策：金幣不按隊伍人數加乘\n" +
  "function partyDropMult() { return 1 + Math.max(0, partyActiveMemberCount() - 1) * 0.6; }   // 🔒 本地政策：每名未倒地傭兵使掉寶率 +60%，王族 7 名時 ×5.2\n" +
  "function partyDropRate(rate) { return Math.min(1, Math.max(0, Number(rate) || 0) * partyDropMult()); }";

if (src.includes(MARKER)) {
  console.log('[check] 傭兵經驗均分／掉寶 +60% 政策已套用。');
} else if (src.includes(OLD_MARKER)) {
  replaceOne(OLD_MARKER, MARKER, '舊政策標記升級');
  replaceOne(oldRewardBlock, localRewardBlock, '舊隊伍獎勵倍率升級');
} else {
  replaceOne(
    'function classicDropMult() { return 1; }',
    MARKER + '\nfunction classicDropMult() { return 1; }',
    '政策標記位置'
  );
  replaceOne(
    "let g = Math.floor((mob.exp || 0) * (1 + partyExpBonusPct() / 100) * (1 + (typeof dollFieldVal === 'function' ? dollFieldVal('expBonus') : 0) / 100));   // 🤝 v3.7.62 組隊不再拆分經驗；統計記主玩家完整應得值",
    "let g = Math.floor((mob.exp || 0) * (1 + partyExpBonusPct() / 100) / partyExpShareCount() * (1 + (typeof dollFieldVal === 'function' ? dollFieldVal('expBonus') : 0) / 100));   // 🔒 舊傭兵政策：統計記主玩家均分後應得經驗",
    '效率統計經驗'
  );
  replaceOne(
    upstreamRewardBlock,
    localRewardBlock,
    '隊伍獎勵倍率'
  );
  replaceOne(
    "// 🤝 v3.7.62 組隊經驗不再拆分：主玩家、每名未倒地傭兵、每隻未倒地寵物各取得完整經驗；既有組隊加成保留。\n    let _expEach = mob.exp * (1 + partyExpBonusPct() / 100);\n    let _petExpGain = Math.floor(_expEach * (1 + dollFieldVal('expBonus') / 100));   // 🐾 每隻存活寵物各得完整玩家份額；玩家滿等不影響養寵",
    "// 🔒 舊傭兵政策：先套既有組隊加成，再由主玩家＋未倒地傭兵均分；寵物複製主玩家份額。\n    let _expShare = mob.exp * (1 + partyExpBonusPct() / 100) / partyExpShareCount();\n    let _petExpGain = Math.floor(_expShare * (1 + dollFieldVal('expBonus') / 100));",
    '擊殺經驗主公式'
  );
  replaceOne(
    '// 🐾 寵物經驗：每隻未倒地出戰寵物各得完整份額；不受玩家 Lv100 經驗封頂影響（升級需求＝玩家表 1/10）',
    '// 🐾 舊傭兵政策：每隻未倒地寵物複製主玩家均分後份額；不受玩家 Lv100 封頂影響',
    '寵物經驗註解'
  );
  replaceOne(
    '// 🤝 協力傭兵各得完整份額（以自身等級計 getExpGainMult·滿等歸0·不減其他人）。',
    '// 🤝 舊傭兵政策：每名未倒地傭兵各取得同一份均分經驗。',
    '傭兵經驗註解'
  );
  replaceOne(
    'let _gain = Math.floor(_expEach * getExpGainMult(a.lv || 1));',
    'let _gain = Math.floor(_expShare * getExpGainMult(a.lv || 1));',
    '傭兵經驗入帳'
  );
}

if (!src.includes('let _dropMult = _dropBase * classicDropMult() * partyDropMult();')) {
  replaceOne(
    'let _dropMult = _dropBase * classicDropMult() * partyRewardMult();   // 席琳／恩賜／模式倍率後再乘有效隊伍人數（最高 ×8）',
    'let _dropMult = _dropBase * classicDropMult() * partyDropMult();   // 席琳／恩賜／模式倍率後再乘傭兵掉寶倍率（王族 7 名最高 ×5.2）',
    '一般掉落表倍率'
  );
}
if (!src.includes('e[1] * _dropBase * partyDropMult() * trialItemDropMult(e[0])')) {
  replaceOne(
    'e[1] * _dropBase * partyRewardMult() * trialItemDropMult(e[0])',
    'e[1] * _dropBase * partyDropMult() * trialItemDropMult(e[0])',
    '龍騎士試煉掉落倍率'
  );
}
if (!src.includes("partyRewardMult());   // 🪆 娃娃金幣加成後維持本地政策 ×1")) {
  replaceOne(
    "partyRewardMult());   // 🪆 娃娃加成後再乘有效隊伍人數（最高 ×8）",
    "partyRewardMult());   // 🪆 娃娃金幣加成後維持本地政策 ×1",
    '金幣倍率註解'
  );
}

const mustHave = [
  MARKER,
  '/ partyExpShareCount()',
  'function partyRewardMult() { return 1; }',
  'function partyDropMult() { return 1 + Math.max(0, partyActiveMemberCount() - 1) * 0.6; }',
  'function partyDropRate(rate) { return Math.min(1, Math.max(0, Number(rate) || 0) * partyDropMult()); }',
  'let _dropMult = _dropBase * classicDropMult() * partyDropMult();',
  'e[1] * _dropBase * partyDropMult() * trialItemDropMult(e[0])',
  'partyRewardMult());   // 🪆 娃娃金幣加成後維持本地政策 ×1',
  'let _expShare = mob.exp * (1 + partyExpBonusPct() / 100) / partyExpShareCount();',
  'let _gain = Math.floor(_expShare * getExpGainMult(a.lv || 1));'
];
const missing = mustHave.filter(x => !src.includes(x));
if (missing.length) throw new Error(`[${FILE}] 傭兵混合獎勵政策驗證失敗：${missing.join(' | ')}`);

const indexHtml = readFileSync('index.html', 'utf8');
const mercPolicySrc = readFileSync('afk-merc-policy.js', 'utf8');
const mobileMemorySrc = readFileSync('afk-mobile-memory.js', 'utf8');
const powersaveInventorySrc = readFileSync('afk-powersave-inventory.js', 'utf8');
const junkAutosellPolicySrc = readFileSync('afk-junk-autosell-policy.js', 'utf8');
const worldMapSrc = readFileSync('js/11-world-map.js', 'utf8');
const WIKI_FILE = 'afk-wiki.js';
let wikiSrc = readFileSync(WIKI_FILE, 'utf8');
const upstreamWikiRewardLine =
  '💰 <b>組隊還讓掉落與金幣翻倍</b>：<b>金幣與每件掉落機率都會乘上「有效隊伍人數」＝主玩家＋未倒地傭兵（最多 8 人）</b>——帶滿 3 名傭兵＝<b>×4</b>、王族帶滿 7 名＝<b>×8</b>（單件機率最高補到 100%）。金幣與掉落全歸你主角。';
const localWikiRewardLine =
  '💰 <b>傭兵提高掉寶率</b>：每名未倒地傭兵讓每件物品的掉落機率增加 <b>60%</b>——帶滿 3 名＝<b>×2.8</b>、王族帶滿 7 名＝<b>×5.2</b>（單件機率最高補到 100%）。<b>金幣不加乘</b>，金幣與掉落仍全歸你主角。';
if (!wikiSrc.includes(localWikiRewardLine)) {
  const firstAt = wikiSrc.indexOf(upstreamWikiRewardLine);
  if (firstAt < 0 || wikiSrc.indexOf(upstreamWikiRewardLine, firstAt + upstreamWikiRewardLine.length) >= 0) {
    throw new Error(`[${WIKI_FILE}] 找不到唯一的 PP 傭兵獎勵說明錨點，拒絕產生錯誤小百科。`);
  }
  wikiSrc = wikiSrc.slice(0, firstAt) + localWikiRewardLine + wikiSrc.slice(firstAt + upstreamWikiRewardLine.length);
}
const mercPolicyMustHave = [
  "version: '3.7.61-hybrid-drop60-town-refresh-on-pp-v3.8.5'",
  'dropPerMercPct: 60',
  'goldPartyMultiplier: false',
  'function mercRehireCostPolicy() { return 0; }',
  'paidManualRehire: false',
  'townRefresh: true'
];
const mercPolicyMissing = mercPolicyMustHave.filter(x => !mercPolicySrc.includes(x));
if (mercPolicyMissing.length || /\bwindow\.refreshAllAllies\s*=/.test(mercPolicySrc)) {
  throw new Error(`[afk-merc-policy.js] 回城免費自動刷新政策驗證失敗：${mercPolicyMissing.join(' | ') || '不可覆寫 PP 核心 refreshAllAllies'}`);
}
if (!worldMapSrc.includes("if (typeof refreshAllAllies === 'function') refreshAllAllies();")) {
  throw new Error('[js/11-world-map.js] 找不到進安全區的 refreshAllAllies 單一掛點，拒絕繼續。');
}
const powersaveInventoryMustHave = [
  "version: '1.3.0-local'",
  'TAB_COUNT_PATCH_MS = 250',
  'TAB_FULL_REBUILD_MS = 1000',
  '_autoSortInventoryWrapped.__afkPsInventory = true',
  'autoSortDeferred: true',
  'mobileDormancy: true',
  'function mobileBackpackVisible()',
  'function patchEquipWeightHeader(root)',
  "if (tab === 'equip') patchEquipWeightHeader(root);",
  'document.addEventListener(\'DOMContentLoaded\', install'
];
const powersaveInventoryMissing = powersaveInventoryMustHave.filter(x => !powersaveInventorySrc.includes(x));
const tabContextBlock = (powersaveInventorySrc.match(/function tabContextSig\(\) \{[\s\S]*?\n        \}/) || [''])[0];
if (powersaveInventoryMissing.length || /\b(?:weightPct|loadTier)\b/.test(tabContextBlock)) {
  throw new Error(`[afk-powersave-inventory.js] 背包增量更新契約不完整：${powersaveInventoryMissing.join(' | ') || '負重不可放進結構簽章'}`);
}
const junkAutosellPolicyMustHave = [
  "var VERSION = '1.0.0-local'",
  'toggleJunkPolicy.__afkJunkAutosellPolicy = true',
  'runQuickJunkPolicy.__afkJunkAutosellPolicy = true',
  'applyAutoSellRulesPolicy.__afkJunkAutosellPolicy = true',
  'autoSellJunkPolicy.__afkJunkAutosellPolicy = true',
  'window.AFK_JUNK_AUTOSELL_POLICY = Object.freeze',
  'immediatePersistence: true',
  'manualPreferenceWins: true',
  'offlineVirtualGrace: true'
];
const junkAutosellPolicyMissing = junkAutosellPolicyMustHave.filter(x => !junkAutosellPolicySrc.includes(x));
if (junkAutosellPolicyMissing.length) {
  throw new Error(`[afk-junk-autosell-policy.js] 廢品自動販賣安全契約不完整：${junkAutosellPolicyMissing.join(' | ')}`);
}
const mobileMemoryMustHave = [
  'window.__afkMobileMemoryLite = lite',
  "settingOn('noanim') && settingOn('lowfps')",
  'window.__afkMobileTownNpcFrames',
  'window.__afkMobileWanderingBuyerStill',
  'window.__afkMobileMemoryProbeCurrent',
  'window.__afkMobileMemoryLifecycle',
  'function releasePanelBody(id)',
  'function closeAndReleaseImagePanels()',
  "installBookCloseGuard('closeNpcInteraction', 'interaction-content');",
  "releasePanelBody('m-wiki-body');",
  'function renderStaticActors()',
  'releaseActiveActorDom();',
  'wrapped.__afkMobileMemoryOuter = true',
  'window._townMapBg.__afkMobileMemory = true'
];
const mobileMemoryMissing = mobileMemoryMustHave.filter(x => !mobileMemorySrc.includes(x));
if (mobileMemoryMissing.length) {
  throw new Error(`[afk-mobile-memory.js] 手機圖片記憶體政策不完整：${mobileMemoryMissing.join(' | ')}`);
}
const mobileBannerAt = indexHtml.indexOf('<script src="afk-mobile-banner.js');
const ownerAt = indexHtml.indexOf('<script src="afk-offline-owner.js');
const mercAt = indexHtml.indexOf('<script src="afk-merc-policy.js');
const mobileMemoryAt = indexHtml.indexOf('<script src="afk-mobile-memory.js');
const powersaveInventoryAt = indexHtml.indexOf('<script src="afk-powersave-inventory.js');
const junkAutosellAt = indexHtml.indexOf('<script src="afk-junk-autosell-policy.js');
const offlineAt = indexHtml.indexOf('<script src="afk-offline.js');
if (mobileBannerAt < 0 || ownerAt < 0 || mercAt < 0 || mobileMemoryAt < 0 || powersaveInventoryAt < 0 || junkAutosellAt < 0 || offlineAt < 0 ||
    mobileBannerAt > ownerAt || ownerAt > mercAt || mercAt > mobileMemoryAt || mobileMemoryAt > powersaveInventoryAt ||
    powersaveInventoryAt > junkAutosellAt || junkAutosellAt > offlineAt) {
  throw new Error('[index.html] 載入順序必須是 afk-mobile-banner → afk-offline-owner → afk-merc-policy → afk-mobile-memory → afk-powersave-inventory → afk-junk-autosell-policy → afk-offline。');
}

if (CHECK) {
  console.log('✅ --check：傭兵均分經驗、掉寶 +60%、金幣 ×1、回城免費刷新政策與載入順序正確。');
} else {
  writeFileSync(FILE, src);
  writeFileSync(WIKI_FILE, wikiSrc);
  console.log(`✅ 傭兵掉寶 +60% 政策已固定（${FILE}、${WIKI_FILE}）；金幣與其他戰鬥核心維持原政策。`);
}
