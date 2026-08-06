/**
 * 將 PP 同步檔中的性向說明改為本站政策；真正行為由 afk-alignment-policy.js 外掛提供。
 * 所有替換都要求唯一錨點，PP 改寫時直接失敗，避免留下錯誤說明。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');

function patchFile(file, upstreamText, localText, label) {
  let src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (src.includes(localText)) return { file, src, changed: false };
  const at = src.indexOf(upstreamText);
  if (at < 0 || src.indexOf(upstreamText, at + upstreamText.length) >= 0) {
    throw new Error(`[${file}] 找不到唯一的「${label}」錨點，拒絕留下錯誤性向說明。`);
  }
  src = src.slice(0, at) + localText + src.slice(at + upstreamText.length);
  return { file, src, changed: true };
}

const wikiUpstream =
  "wDesc('<b>怎麼變動</b>：打<b>一般怪物</b>每隻 <b>+1</b>；<b>殺掉正義的玩家 −10,000</b>、<b>殺掉中立的玩家 −5,000</b>（殺已經是紅名的玩家不扣）。血盟敵人、攻城區內的擊殺、以及<b>與你的血盟交戰中的敵盟成員</b>都<b>不影響</b>性向值。'));";
const wikiLocal =
  "wDesc('<b>怎麼變動</b>：擊殺<b>一般怪物</b>時，先以「怪物等級 ± 隨機 1～怪物等級（最高 50）」算原始值；原始值不大於 0 時固定 +1，否則再除以「怪物等級平方根的一半（無條件進位）～完整平方根（無條件捨去）」之間的隨機整數。結果依目前性向套用倍率：<b>未滿 +1,000 為 100%</b>、<b>+1,000～+9,999 為 50%</b>、<b>+10,000 以上為 25%</b>，最終至少 +1。<b>殺掉正義的玩家 −10,000</b>、<b>殺掉中立的玩家 −5,000</b>（殺已經是紅名的玩家不扣）。血盟敵人、攻城區內的擊殺、以及<b>與你的血盟交戰中的敵盟成員</b>都<b>不影響</b>性向值。'));";

const worldUpstream =
  "'殺怪性向 +1；殺白名玩家 NPC 扣 5000，殺藍名扣 10000，殺紅名不扣，攻城區不列入。',";
const worldLocal =
  "'殺一般怪物會依怪物等級與隨機除數增加性向；目前性向達 1000／10000 後，增加量會降為一半／四分之一，最少仍 +1。殺白名玩家 NPC 扣 5000，殺藍名扣 10000，殺紅名不扣，攻城區不列入。',";

const offlineUpstream =
  '//    ⚠ 性向值(alignmentValue)絕對不可放進簽章:每殺一隻普通怪它就 +1(js/03 pvpChangeAlignment(1)),';
const offlineLocal =
  '//    ⚠ 性向值(alignmentValue)絕對不可放進簽章:每殺一隻普通怪都會依本站性向政策變動(afk-alignment-policy.js),';

const patches = [
  patchFile('afk-wiki.js', wikiUpstream, wikiLocal, 'PVP／性向值變動說明'),
  patchFile('js/26-world-channel.js', worldUpstream, worldLocal, '世界頻道性向問答'),
  patchFile('afk-offline.js', offlineUpstream, offlineLocal, '離線性向快取註解')
];

const plugin = readFileSync('afk-alignment-policy.js', 'utf8');
const index = readFileSync('index.html', 'utf8');
const mustHave = [
  "var POLICY_ID = 'alignmentpolicy';",
  "var VERSION = 'level-random-sqrt-band-v1';",
  'var magnitudeMax = Math.min(50, level);',
  'var min = Math.max(1, Math.ceil(root / 2));',
  'var max = Math.max(min, Math.floor(root));',
  'if (alignment < 1000) return 1;',
  'if (alignment < 10000) return 0.5;',
  'return 0.25;',
  'var gain = Math.max(1, Math.floor(base * rate));',
  'window.pvpChangeAlignment = policyChange;',
  'window.pvpOnKillMob = wrappedPvpOnKillMob;'
];
const missing = mustHave.filter(text => !plugin.includes(text));
if (missing.length) throw new Error(`[afk-alignment-policy.js] 性向政策不完整：${missing.join(' | ')}`);

const policyAt = index.indexOf('<script src="afk-alignment-policy.js');
const offlineAt = index.indexOf('<script src="afk-offline.js');
if (policyAt < 0 || offlineAt < 0 || policyAt > offlineAt) {
  throw new Error('[index.html] afk-alignment-policy.js 必須在 afk-offline.js 前載入。');
}

if (CHECK) {
  const pending = patches.filter(patch => patch.changed).map(patch => patch.file);
  if (pending.length) throw new Error(`性向政策說明尚未套用：${pending.join(', ')}`);
  console.log('✅ --check：怪物等級、雙層隨機、性向分段與線上／離線共用政策完整。');
} else {
  for (const patch of patches) if (patch.changed) writeFileSync(patch.file, patch.src);
  console.log(`✅ 性向政策說明已固定（新套用 ${patches.filter(patch => patch.changed).length}）。`);
}
