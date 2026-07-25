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
import { patchNecromancyBook } from './backports/necro-book.mjs';

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

function patchNamedFunction(file, source, name, transform) {
  const token = `function ${name}(`;
  const start = source.indexOf(token);
  if (start < 0 || source.indexOf(token, start + token.length) >= 0) {
    throw new Error(`[${file}] ${name} 函式錨點不存在或不唯一。`);
  }
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error(`[${file}] ${name} 找不到函式開頭。`);
  let depth = 0;
  let close = -1;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') {
      depth--;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) throw new Error(`[${file}] ${name} 找不到函式結尾。`);
  const before = source.slice(start, close + 1);
  const usesCrlf = before.includes('\r\n');
  const normalized = before.replace(/\r\n/g, '\n');
  const transformed = transform(normalized);
  const after = usesCrlf ? transformed.replace(/\n/g, '\r\n') : transformed;
  return source.slice(0, start) + after + source.slice(close + 1);
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
  const dropEntry = "['底比斯 尼荷斯(藍)','relic_sky_god_avatar']";
  const weightEntry = '"天空之神的化身":50';
  const dropBlock = [
    '// 🔌 Shines v3.8.27 選配回移：天空之神的化身（0.0001%）',
    "[['底比斯 尼荷斯(藍)','relic_sky_god_avatar']]",
    "    .forEach(r => (MOB_DROPS[r[0]] = MOB_DROPS[r[0]] || []).push([r[1], 0.0001]));",
    'Object.assign(ITEM_WEIGHTS, {"天空之神的化身":50});',
  ].join('\n');
  let drops = readFileSync(dropFile, 'utf8');
  if (!(drops.includes(dropEntry) && drops.includes(weightEntry))) {
    if (drops.includes("'relic_sky_god_avatar'") || drops.includes(weightEntry)) {
      throw new Error(`[${dropFile}] 天空之神掉落或重量只套用一部分，拒絕猜測合併。`);
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

// ── 回移 3：舊網頁存檔載入優化（Shines v3.8.16）───────────────
// 同次 loadGame 共用一份倉庫解析，三本圖鑑只有內容真的新增時才寫回。
// 不改存檔格式、簽章、地圖落點、傭兵或離線結算。
function patchOldSaveLoadOptimization() {
  const saveFile = 'js/13-shop-save.js';
  let save = readFileSync(saveFile, 'utf8');
  const saveContracts = [
    'function purgeOrphanItems(warehouse) {',
    "let wh = warehouse && typeof warehouse === 'object' ? warehouse : loadWarehouse();",
    'let _loadWarehouse = null, _loadWarehouseReady = false;',
    'purgeOrphanItems(_loadWarehouseReady ? _loadWarehouse : undefined);',
    'let _w = _loadWarehouseReady ? _loadWarehouse : loadWarehouse();',
    'ensureEquipBook(_loadWarehouseReady ? _loadWarehouse : undefined);',
    'ensureMiscDex(_loadWarehouseReady ? _loadWarehouse : undefined);',
    'ensureRelicDex(_loadWarehouseReady ? _loadWarehouse : undefined);',
  ];
  if (!saveContracts.every(contract => save.includes(contract))) {
    if (save.includes('_loadWarehouseReady') || save.includes('function purgeOrphanItems(warehouse)')) {
      throw new Error(`[${saveFile}] 舊存檔載入優化只套用了一部分，拒絕猜測合併。`);
    }
    const nl = save.includes('\r\n') ? '\r\n' : '\n';
    save = patchNamedFunction(saveFile, save, 'purgeOrphanItems', block => {
      let next = replaceOnce(
        saveFile,
        block,
        'function purgeOrphanItems() {',
        'function purgeOrphanItems(warehouse) {',
        '孤兒物品清理函式簽名'
      );
      next = replaceOnce(
        saveFile,
        next,
        '                let wh = loadWarehouse();',
        "                let wh = warehouse && typeof warehouse === 'object' ? warehouse : loadWarehouse();",
        '孤兒物品共用倉庫'
      );
      return next;
    });

    const purgeCall = "        try { purgeOrphanItems(); } catch (e) { console.warn('purgeOrphanItems', e); }   // 🧹 v3.2.62 清除已停用舊物品（DB 無定義的孤兒·背包+倉庫·排除待轉換的舊項圈）";
    const cachedPurge = [
      '        // 🔌 Shines v3.8.27 選配回移：同次讀檔共用一次倉庫解析，避免大型舊存檔重複解壓。',
      '        let _loadWarehouse = null, _loadWarehouseReady = false;',
      "        try { if (typeof loadWarehouse === 'function') { _loadWarehouse = loadWarehouse(); _loadWarehouseReady = true; } } catch (e) {}",
      "        try { purgeOrphanItems(_loadWarehouseReady ? _loadWarehouse : undefined); } catch (e) { console.warn('purgeOrphanItems', e); }   // 🧹 v3.2.62 清除已停用舊物品（DB 無定義的孤兒·背包+倉庫·排除待轉換的舊項圈）",
    ].join(nl);
    save = replaceOnce(saveFile, save, purgeCall, cachedPurge, '讀檔倉庫快取初始化');
    save = replaceOnce(
      saveFile,
      save,
      '            try { let _w = loadWarehouse(); let _chg = false;',
      '            try { let _w = _loadWarehouseReady ? _loadWarehouse : loadWarehouse(); let _chg = false;',
      '套裝遷移共用倉庫'
    );
    save = replaceOnce(
      saveFile,
      save,
      "        if (typeof ensureEquipBook === 'function') ensureEquipBook();   // 🗡️ 舊存檔遷移",
      "        if (typeof ensureEquipBook === 'function') ensureEquipBook(_loadWarehouseReady ? _loadWarehouse : undefined);   // 🗡️ 舊存檔遷移",
      '裝備圖鑑共用倉庫'
    );
    save = replaceOnce(
      saveFile,
      save,
      "        if (typeof ensureMiscDex === 'function') ensureMiscDex();   // 🧰 舊存檔遷移",
      "        if (typeof ensureMiscDex === 'function') ensureMiscDex(_loadWarehouseReady ? _loadWarehouse : undefined);   // 🧰 舊存檔遷移",
      '道具圖鑑共用倉庫'
    );
    save = replaceOnce(
      saveFile,
      save,
      "        if (typeof ensureRelicDex === 'function') ensureRelicDex();   // 🏺 舊存檔遷移",
      "        if (typeof ensureRelicDex === 'function') ensureRelicDex(_loadWarehouseReady ? _loadWarehouse : undefined);   // 🏺 舊存檔遷移",
      '遺物圖鑑共用倉庫'
    );
    if (!saveContracts.every(contract => save.includes(contract))) {
      throw new Error(`[${saveFile}] 舊存檔載入優化完成後契約仍不完整。`);
    }
    writePatched(saveFile, save, '舊存檔單次倉庫解析');
  } else {
    already++;
  }

  const equipFile = 'js/16-equip-book.js';
  let equip = readFileSync(equipFile, 'utf8');
  const equipContracts = [
    'function ensureEquipBook(warehouse) {',
    '    let changed = false;',
    '    let register = i =>',
    "let _w = warehouse || (typeof loadWarehouse === 'function' ? loadWarehouse() : null);",
    "if (changed && typeof saveEquipDex === 'function') saveEquipDex();",
  ];
  if (!equipContracts.every(contract => equip.includes(contract))) {
    if (equip.includes('function ensureEquipBook(warehouse)')) {
      throw new Error(`[${equipFile}] ensureEquipBook 優化內容不完整。`);
    }
    equip = patchNamedFunction(equipFile, equip, 'ensureEquipBook', block => {
      let next = replaceOnce(equipFile, block, 'function ensureEquipBook() {', 'function ensureEquipBook(warehouse) {', '裝備圖鑑函式簽名');
      next = replaceOnce(equipFile, next, '    if (!player.equipDex) player.equipDex = {};', '    let changed = false;\n    if (!player.equipDex) { player.equipDex = {}; changed = true; }', '裝備圖鑑變更追蹤');
      next = replaceOnce(equipFile, next, "    if (player.inv.some(i => i.id === 'item_equip_book')) player.inv = player.inv.filter(i => i.id !== 'item_equip_book');", "    if (player.inv.some(i => i.id === 'item_equip_book')) { player.inv = player.inv.filter(i => i.id !== 'item_equip_book'); changed = true; }", '舊圖鑑本體移除追蹤');
      next = replaceOnce(
        equipFile,
        next,
        '    player.inv.forEach(i => { if (EQUIP_ITEM_CAT[i.id]) player.equipDex[i.id] = true; });\n    if (player.eq) for (let s in player.eq) { let e = player.eq[s]; if (e && e.id && EQUIP_ITEM_CAT[e.id]) player.equipDex[e.id] = true; }',
        '    let register = i => { if (i && i.id && EQUIP_ITEM_CAT[i.id] && !player.equipDex[i.id]) { player.equipDex[i.id] = true; changed = true; } };\n    player.inv.forEach(register);\n    if (player.eq) for (let s in player.eq) register(player.eq[s]);',
        '裝備圖鑑登錄器'
      );
      next = replaceOnce(
        equipFile,
        next,
        "    try { if (typeof loadWarehouse === 'function') { let _w = loadWarehouse(); if (_w && Array.isArray(_w.items)) _w.items.forEach(i => { if (i && i.id && EQUIP_ITEM_CAT[i.id]) player.equipDex[i.id] = true; }); } } catch (e) {}",
        "    try { let _w = warehouse || (typeof loadWarehouse === 'function' ? loadWarehouse() : null); if (_w && Array.isArray(_w.items)) _w.items.forEach(register); } catch (e) {}",
        '裝備圖鑑共用倉庫參數'
      );
      return replaceOnce(
        equipFile,
        next,
        "    if (typeof saveEquipDex === 'function') saveEquipDex();   // 🗡️ 補登錄後回寫共用桶（把該角色現有裝備併入共用收集）",
        "    if (changed && typeof saveEquipDex === 'function') saveEquipDex();   // 🗡️ 僅首次補登錄才回寫共用桶，避免每次載入重複序列化完整圖鑑",
        '裝備圖鑑條件寫回'
      );
    });
    if (!equipContracts.every(contract => equip.includes(contract))) throw new Error(`[${equipFile}] 優化後契約不完整。`);
    writePatched(equipFile, equip, '裝備圖鑑按需寫回');
  } else {
    already++;
  }

  const miscFile = 'js/18-misc-book.js';
  let misc = readFileSync(miscFile, 'utf8');
  const miscContracts = [
    'function ensureMiscDex(warehouse) {',
    "var _w = warehouse || (typeof loadWarehouse === 'function' ? loadWarehouse() : null);",
  ];
  if (!miscContracts.every(contract => misc.includes(contract))) {
    if (misc.includes('function ensureMiscDex(warehouse)')) throw new Error(`[${miscFile}] ensureMiscDex 優化內容不完整。`);
    misc = patchNamedFunction(miscFile, misc, 'ensureMiscDex', block => {
      let next = replaceOnce(miscFile, block, 'function ensureMiscDex() {', 'function ensureMiscDex(warehouse) {', '道具圖鑑函式簽名');
      return replaceOnce(
        miscFile,
        next,
        "    try { if (typeof loadWarehouse === 'function') { var _w = loadWarehouse(); if (_w && Array.isArray(_w.items)) _w.items.forEach(reg); } } catch (e) {}",
        "    try { var _w = warehouse || (typeof loadWarehouse === 'function' ? loadWarehouse() : null); if (_w && Array.isArray(_w.items)) _w.items.forEach(reg); } catch (e) {}",
        '道具圖鑑共用倉庫參數'
      );
    });
    if (!miscContracts.every(contract => misc.includes(contract))) throw new Error(`[${miscFile}] 優化後契約不完整。`);
    writePatched(miscFile, misc, '道具圖鑑共用倉庫');
  } else {
    already++;
  }

  const relicFile = 'js/21-relic-book.js';
  let relic = readFileSync(relicFile, 'utf8');
  const relicContracts = [
    'function ensureRelicDex(warehouse) {',
    '    let changed = false;',
    '    let register = i =>',
    "let _w = warehouse || (typeof loadWarehouse === 'function' ? loadWarehouse() : null);",
    "if (changed && typeof saveRelicDex === 'function') saveRelicDex();",
  ];
  if (!relicContracts.every(contract => relic.includes(contract))) {
    if (relic.includes('function ensureRelicDex(warehouse)')) throw new Error(`[${relicFile}] ensureRelicDex 優化內容不完整。`);
    relic = patchNamedFunction(relicFile, relic, 'ensureRelicDex', block => {
      let next = replaceOnce(relicFile, block, 'function ensureRelicDex() {', 'function ensureRelicDex(warehouse) {', '遺物圖鑑函式簽名');
      next = replaceOnce(
        relicFile,
        next,
        '    if (!player.relicDex) player.relicDex = {};\n    player.inv.forEach(i => { if (RELIC_ITEM_CAT[i.id]) player.relicDex[i.id] = true; });\n    if (player.eq) for (let s in player.eq) { let e = player.eq[s]; if (e && e.id && RELIC_ITEM_CAT[e.id]) player.relicDex[e.id] = true; }',
        '    let changed = false;\n    if (!player.relicDex) { player.relicDex = {}; changed = true; }\n    let register = i => { if (i && i.id && RELIC_ITEM_CAT[i.id] && !player.relicDex[i.id]) { player.relicDex[i.id] = true; changed = true; } };\n    player.inv.forEach(register);\n    if (player.eq) for (let s in player.eq) register(player.eq[s]);',
        '遺物圖鑑登錄器'
      );
      next = replaceOnce(
        relicFile,
        next,
        "    try { if (typeof loadWarehouse === 'function') { let _w = loadWarehouse(); if (_w && Array.isArray(_w.items)) _w.items.forEach(i => { if (i && i.id && RELIC_ITEM_CAT[i.id]) player.relicDex[i.id] = true; }); } } catch (e) {}",
        "    try { let _w = warehouse || (typeof loadWarehouse === 'function' ? loadWarehouse() : null); if (_w && Array.isArray(_w.items)) _w.items.forEach(register); } catch (e) {}",
        '遺物圖鑑共用倉庫參數'
      );
      return replaceOnce(relicFile, next, "    if (typeof saveRelicDex === 'function') saveRelicDex();", "    if (changed && typeof saveRelicDex === 'function') saveRelicDex();", '遺物圖鑑條件寫回');
    });
    if (!relicContracts.every(contract => relic.includes(contract))) throw new Error(`[${relicFile}] 優化後契約不完整。`);
    writePatched(relicFile, relic, '遺物圖鑑按需寫回');
  } else {
    already++;
  }
}

const PATCHES = [
  patchSkyGodAvatar,
  patchCastleGuardAccuracy,
  patchOldSaveLoadOptimization,
  () => patchNecromancyBook({
    replaceOnce,
    writePatched,
    patchNamedFunction,
    markAlready: () => { already++; },
  }),
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
