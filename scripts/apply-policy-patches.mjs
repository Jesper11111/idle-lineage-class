/**
 * apply-policy-patches.mjs — PP 核心同步後，固定使用者指定的舊傭兵獎勵政策。
 *
 * 只修改 js/05 的獎勵公式；招募費用、手動重招募、回村結算與受僱限制由
 * afk-merc-policy.js 覆寫。其他戰鬥函式仍來自 PP 最新版。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const FILE = 'js/05-kill-progression.js';
const MARKER = '// 🔒 legacy-merc-policy: v3.7.61 均分經驗、金幣與掉落不按隊伍人數加乘。';
// 官方 Windows checkout 可能是 CRLF；錨點一律用 LF 比對，stamp-code-versions 也採相同正規化。
let src = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

function replaceOne(from, to, label) {
  const at = src.indexOf(from);
  if (at < 0) throw new Error(`[${FILE}] 找不到「${label}」錨點；官方可能改寫獎勵公式，拒絕默默套用。`);
  if (src.indexOf(from, at + from.length) >= 0) throw new Error(`[${FILE}] 「${label}」錨點出現不只一次，拒絕不確定替換。`);
  src = src.slice(0, at) + to + src.slice(at + from.length);
}

if (src.includes(MARKER)) {
  console.log('[check] 舊傭兵獎勵政策已套用。');
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
    "function partyExpShareCount() { return partyActiveMemberCount(); }   // 相容 native-preview／舊外部呼叫；不再作為除數\nfunction partyRewardMult() { return partyActiveMemberCount(); }\nfunction partyDropRate(rate) { return Math.min(1, Math.max(0, Number(rate) || 0) * partyRewardMult()); }",
    "function partyExpShareCount() { return partyActiveMemberCount(); }   // 🔒 舊傭兵政策：主玩家＋未倒地傭兵均分\nfunction partyRewardMult() { return 1; }   // 🔒 舊傭兵政策：金幣／掉落不按隊伍人數加乘\nfunction partyDropRate(rate) { return Math.min(1, Math.max(0, Number(rate) || 0)); }",
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

const mustHave = [
  MARKER,
  '/ partyExpShareCount()',
  'function partyRewardMult() { return 1; }',
  'function partyDropRate(rate) { return Math.min(1, Math.max(0, Number(rate) || 0)); }',
  'let _expShare = mob.exp * (1 + partyExpBonusPct() / 100) / partyExpShareCount();',
  'let _gain = Math.floor(_expShare * getExpGainMult(a.lv || 1));'
];
const missing = mustHave.filter(x => !src.includes(x));
if (missing.length) throw new Error(`[${FILE}] 舊傭兵政策驗證失敗：${missing.join(' | ')}`);

const indexHtml = readFileSync('index.html', 'utf8');
const mobileBannerAt = indexHtml.indexOf('<script src="afk-mobile-banner.js');
const ownerAt = indexHtml.indexOf('<script src="afk-offline-owner.js');
const mercAt = indexHtml.indexOf('<script src="afk-merc-policy.js');
const offlineAt = indexHtml.indexOf('<script src="afk-offline.js');
if (mobileBannerAt < 0 || ownerAt < 0 || mercAt < 0 || offlineAt < 0 ||
    mobileBannerAt > ownerAt || ownerAt > mercAt || mercAt > offlineAt) {
  throw new Error('[index.html] 載入順序必須是 afk-mobile-banner → afk-offline-owner → afk-merc-policy → afk-offline。');
}

if (CHECK) {
  console.log('✅ --check：舊傭兵獎勵政策與載入順序正確。');
} else {
  writeFileSync(FILE, src);
  console.log(`✅ 舊傭兵獎勵政策已固定（${FILE}）；其他戰鬥核心維持 PP 最新版。`);
}
