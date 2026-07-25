/**
 * apply-shines-backports.mjs — 在 PP 核心同步完成後，重套經人工核准的 Shines 功能回移。
 *
 * 原則：
 *   - 只搬核准功能，不追隨 Shines 的桌面殼、傭兵、離線或其他政策。
 *   - 錨點式、冪等、失敗大聲；PP 改到同一區時讓同步 CI 停下來人工審查。
 *   - `--check` 只驗證，不寫檔。
 *
 * 用法：node scripts/apply-shines-backports.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
let changed = 0;
let already = 0;

function replaceOnce(file, source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(`[${file}] ${label} 錨點應恰好 1 處，實際 ${count} 處；PP 可能已修改同區，請人工審查。`);
  }
  return source.replace(anchor, replacement);
}

function writePatched(file, source, label) {
  if (!CHECK) writeFileSync(file, source);
  changed++;
  console.log(`[backport] ${label}（${file}）`);
}

// ── 回移 1：天空之神的化身（Shines v3.8.12）────────────────────
// PP v3.8.5 已有 wearerEle 的完整能力與傷害框架，因此只補物品、掉落、重量與圖示。
function patchSkyGodAvatar() {
  const dataFile = 'js/00-data.js';
  const itemLine = '        "relic_sky_god_avatar":     { n: "天空之神的化身",     type: "arm", slot: "armor", relic: true, noEnhance: true, ac: 11, wearerEle: "wind", req: "all", p: 10000, gachaWeight: 0, d: "【遺物】天空之神遺留在人間的羽衣，披上後身軀便與長風融為一體。" },';
  let data = readFileSync(dataFile, 'utf8');
  if (!data.includes(itemLine)) {
    if (data.includes('"relic_sky_god_avatar"')) {
      throw new Error(`[${dataFile}] 已存在 relic_sky_god_avatar，但定義與核准的 Shines v3.8.27 內容不同。`);
    }
    const anchor = '        "clk_elf": { n: "精靈斗篷",';
    data = replaceOnce(
      dataFile,
      data,
      anchor,
      '        // 🔌 Shines v3.8.27 選配回移：天空之神的化身（PP 已具 wearerEle 框架）\n' + itemLine + '\n' + anchor,
      '天空之神物品'
    );
    writePatched(dataFile, data, '天空之神物品資料');
  } else {
    already++;
  }

  const dropFile = 'js/01-drops-config.js';
  const dropBlock = [
    '// 🔌 Shines v3.8.27 選配回移：天空之神的化身（0.0001%）',
    "[['底比斯 尼荷斯(藍)','relic_sky_god_avatar']]",
    "    .forEach(r => (MOB_DROPS[r[0]] = MOB_DROPS[r[0]] || []).push([r[1], 0.0001]));",
    'Object.assign(ITEM_WEIGHTS, {"天空之神的化身":50});',
  ].join('\n');
  let drops = readFileSync(dropFile, 'utf8');
  if (!drops.includes(dropBlock)) {
    if (drops.includes("'relic_sky_god_avatar'")) {
      throw new Error(`[${dropFile}] 已存在天空之神掉落，但內容與核准版本不同。`);
    }
    const anchor = 'Object.assign(ITEM_WEIGHTS, {"古代地龍鱗盔甲":250,';
    drops = replaceOnce(dropFile, drops, anchor, dropBlock + '\n' + anchor, '天空之神掉落');
    writePatched(dropFile, drops, '天空之神掉落與重量');
  } else {
    already++;
  }

  const icon = 'assets/icons/armors/天空之神的化身.png';
  if (!existsSync(icon)) {
    throw new Error(`[${icon}] 缺少核准的 Shines 圖示；請從固定來源提交資產後再執行。`);
  }
  already++;
}

// ── 回移 2：城堡護衛命中補強（Shines v3.8.18）─────────────────
// 只移植命中公式；不帶入同檔後續的鐵衛套裝或任何傭兵規則。
function patchCastleGuardAccuracy() {
  const file = 'js/31-castle-guards.js';
  let source = readFileSync(file, 'utf8');
  const finalContracts = [
    '        hitBonus: 30,',
    '        hitBonus: 35,',
    '        hitBonus: 33,',
    'function _guardHit(lv, hitBonus) {',
    '    hitBonus = Math.max(0, Number(hitBonus) || 0);',
    '        if (d) return Math.max(1, Math.round(lv + hitBonus + (d.hit || 0) / hm));',
    '    return Math.max(1, Math.round(lv * 2.2 + hitBonus));',
    '        hit: _guardHit(lv, spec.hitBonus),',
  ];
  if (finalContracts.every(contract => source.includes(contract))) {
    already++;
    return;
  }
  if (source.includes('hitBonus:') || source.includes('function _guardHit(lv, hitBonus)')) {
    throw new Error(`[${file}] 城堡護衛命中補強只套用了一部分，拒絕猜測合併。`);
  }

  const nl = source.includes('\r\n') ? '\r\n' : '\n';
  const specPatches = [
    ['        hpPerLv: 16, dpsRatio: 0.50, aspdSec: 1.0,', '        hitBonus: 30,'],
    ['        hpPerLv: 10, dpsRatio: 0.70, aspdSec: 0.5,', '        hitBonus: 35,'],
    ['        hpPerLv: 13, dpsRatio: 0.60, aspdSec: 0.7,', '        hitBonus: 33,'],
  ];
  for (const [anchor, addition] of specPatches) {
    source = replaceOnce(file, source, anchor, anchor + nl + addition, '護衛部隊命中加成');
  }
  source = replaceOnce(
    file,
    source,
    'function _guardHit(lv) {   // 命中沿用裸杜賓命中（剔除夥伴精通命中加成），維持與寵物同水準',
    'function _guardHit(lv, hitBonus) {   // 護衛命中＝自身等級＋部隊補強＋裸杜賓命中（剔除夥伴精通）' +
      nl + '    hitBonus = Math.max(0, Number(hitBonus) || 0);',
    '護衛命中函式'
  );
  source = replaceOnce(
    file,
    source,
    '        if (d) return Math.max(1, Math.round((d.hit || 0) / hm));',
    '        if (d) return Math.max(1, Math.round(lv + hitBonus + (d.hit || 0) / hm));',
    '護衛命中寵物基準公式'
  );
  source = replaceOnce(
    file,
    source,
    '    return Math.max(1, Math.round(lv * 1.2));',
    '    return Math.max(1, Math.round(lv * 2.2 + hitBonus));',
    '護衛命中退路公式'
  );
  source = replaceOnce(
    file,
    source,
    '        hit: _guardHit(lv),',
    '        hit: _guardHit(lv, spec.hitBonus),',
    '護衛數值命中呼叫'
  );
  if (!finalContracts.every(contract => source.includes(contract))) {
    throw new Error(`[${file}] 城堡護衛命中補強完成後契約仍不完整。`);
  }
  writePatched(file, source, '城堡護衛命中補強');
}

const PATCHES = [
  patchSkyGodAvatar,
  patchCastleGuardAccuracy,
];

try {
  for (const patch of PATCHES) patch();
} catch (error) {
  console.error('❌ apply-shines-backports 失敗：' + error.message);
  process.exit(1);
}

if (CHECK) {
  if (changed > 0) {
    console.error(`❌ --check：有 ${changed} 個 Shines 回移補丁尚未套用。`);
    process.exit(1);
  }
  console.log(`✅ --check：全部 ${already} 個 Shines 回移契約均已就位。`);
} else {
  console.log(`✅ apply-shines-backports 完成：新套用 ${changed}、已存在/資產 ${already}。`);
}
