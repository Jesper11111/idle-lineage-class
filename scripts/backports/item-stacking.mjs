import { readFileSync } from 'node:fs';

function patchFile(ctx, file, contracts, label, transform) {
  let source = readFileSync(file, 'utf8');
  if (contracts.every(contract => source.includes(contract))) {
    ctx.markAlready();
    return;
  }
  source = transform(source);
  if (!contracts.every(contract => source.includes(contract))) {
    throw new Error(`[${file}] ${label} 套用後契約仍不完整。`);
  }
  ctx.writePatched(file, source, label);
}

export function patchItemStacking(ctx) {
  patchFile(
    ctx,
    'js/01-drops-config.js',
    [
      "function _invStackFind(e, includeJunk) {",
      "function invAddOrStack(e) {",
      "let ex = _invStackFind(e, true);",
      "let ex = _invStackFind(e, false);",
      "來源、uid、鎖定與廢品旗標不入鍵；同能力物品不論來源皆可疊加。",
    ],
    '物品跨來源堆疊入口',
    source => {
      const nl = source.includes('\r\n') ? '\r\n' : '\n';
      source = ctx.replaceOnce(
        'js/01-drops-config.js',
        source,
        "function itemSig(it) { let _ams = Math.max(1, Math.min(3, Math.floor(Number(it.attrMagicStar) || 1))); return it.id + '|' + (it.en || 0) + '|' + (it.bless === true ? 'B' : (it.bless ? 'C' : 0)) + '|' + (it.anc === true ? 'A' : (it.anc || 0)) + '|' + (it.attr || '') + '|' + (it.seteff || '') + (it.attrMagic ? '|' + it.attrMagic + (_ams > 1 ? '@' + _ams : '') : ''); }   // 🔮 屬性附加魔法採可選尾碼；1星沿用舊簽章，2/3星分開，避免合併時遺失星級",
        "function itemSig(it) { let _ams = Math.max(1, Math.min(3, Math.floor(Number(it.attrMagicStar) || 1))); return it.id + '|' + (it.en || 0) + '|' + (it.bless === true ? 'B' : (it.bless ? 'C' : 0)) + '|' + (it.anc === true ? 'A' : (it.anc || 0)) + '|' + (it.attr || '') + '|' + (it.seteff || '') + (it.attrMagic ? '|' + it.attrMagic + (_ams > 1 ? '@' + _ams : '') : ''); }   // 來源、uid、鎖定與廢品旗標不入鍵；同能力物品不論來源皆可疊加。",
        '物品同一性來源說明'
      );
      const anchor = [
        '//    回傳 true＝已併入既有堆疊；false＝呼叫端需自行 player.inv.push(e)。',
        'function invMergeBack(e) {',
        '    if (!e || e.gw) return false;',
        '    let ex = player.inv.find(i => !i.gw && !i.junk && sameItemSig(i, e));',
      ].join(nl);
      const replacement = [
        'function _invStackFind(e, includeJunk) {',
        '    if (!e || e.gw || !Array.isArray(player.inv)) return null;',
        '    return player.inv.find(i => !i.gw && (includeJunk || !i.junk) && sameItemSig(i, e));',
        '}',
        '// 新取得的物品統一入口：來源不影響疊加；鎖定只會擴散，不會因合併遺失。',
        'function invAddOrStack(e) {',
        '    if (!e) return null;',
        '    if (!Array.isArray(player.inv)) player.inv = [];',
        '    let ex = _invStackFind(e, true);',
        '    if (!ex) { player.inv.push(e); return e; }',
        '    ex.cnt = (ex.cnt || 1) + (e.cnt || 1);',
        '    if (e.lock) { ex.lock = true; ex.junk = false; }',
        '    return ex;',
        '}',
        '// 回傳 true＝已併入既有堆疊；false＝呼叫端需自行 player.inv.push(e)。',
        'function invMergeBack(e) {',
        '    if (!e || e.gw) return false;',
        '    let ex = _invStackFind(e, false);',
      ].join(nl);
      return ctx.replaceOnce('js/01-drops-config.js', source, anchor, replacement, '背包統一堆疊入口');
    }
  );

  patchFile(
    ctx,
    'js/04-combat-attack.js',
    ['invAddOrStack({ id: id, uid: uid(), cnt: 1, en: en, bless: bless, anc: anc, attr: attr, seteff: false'],
    '血盟掉落堆疊',
    source => ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      'player.inv.push({ id: id, uid: uid(), cnt: 1, en: en, bless: bless, anc: anc, attr: attr, seteff: false, lock: false, junk: !!(player.junkPrefs && player.junkPrefs[itemSig(_jProbe)]) });',
      'invAddOrStack({ id: id, uid: uid(), cnt: 1, en: en, bless: bless, anc: anc, attr: attr, seteff: false, lock: false, junk: !!(player.junkPrefs && player.junkPrefs[itemSig(_jProbe)]) });',
      '血盟掉落統一堆疊'
    )
  );

  patchFile(
    ctx,
    'js/08-items-equip.js',
    ['invAddOrStack({ id:resultId, uid:uid(), cnt:1, en:_tEn'],
    '靈魂之球產物堆疊',
    source => {
      const nl = source.includes('\r\n') ? '\r\n' : '\n';
      const anchor = [
        '            let _probe = { id:resultId, en:_tEn, bless:false, anc:false, attr:false, seteff:_seteff };',
        '            let _ex = _tEn > 0 ? null : player.inv.find(i => (i.en||0)===0 && sameItemSig(i, _probe));   // 🏛️ 自帶強化(en>0)獨立成堆、不併入 +0（比照 gainItem）；🔒 v3.6.92 併入鎖定堆疊',
        '            if (_ex) _ex.cnt += 1;',
        '            else player.inv.push({ id:resultId, uid:uid(), cnt:1, en:_tEn, bless:false, anc:false, attr:false, seteff:_seteff, lock:false, junk:false });',
      ].join(nl);
      return ctx.replaceOnce(
        'js/08-items-equip.js',
        source,
        anchor,
        '            invAddOrStack({ id:resultId, uid:uid(), cnt:1, en:_tEn, bless:false, anc:false, attr:false, seteff:_seteff, lock:false, junk:false });',
        '靈魂之球統一堆疊'
      );
    }
  );

  patchFile(
    ctx,
    'js/11-world-map.js',
    ['    invAddOrStack(snap);'],
    '阿卡塔贖回堆疊',
    source => ctx.replaceOnce(
      'js/11-world-map.js',
      source,
      '    player.inv.push(snap);',
      '    invAddOrStack(snap);',
      '阿卡塔贖回統一堆疊'
    )
  );

  patchFile(
    ctx,
    'js/12-npc-quests.js',
    ["function _whStackFind(arr, it){ return (!it.gw) ? arr.find(x => !x.gw && sameItemSig(x, it)) : null; }"],
    '倉庫強化品堆疊',
    source => ctx.replaceOnce(
      'js/12-npc-quests.js',
      source,
      "function _whStackFind(arr, it){ return ((it.en||0)===0 && !it.gw) ? arr.find(x => (x.en||0)===0 && !x.gw && sameItemSig(x, it)) : null; }",
      "function _whStackFind(arr, it){ return (!it.gw) ? arr.find(x => !x.gw && sameItemSig(x, it)) : null; }",
      '倉庫堆疊依完整簽章'
    )
  );

  patchFile(
    ctx,
    'js/13-shop-save.js',
    [
      'let key = itemSig(it);   // 🔧 架構#3：統一簽章（祝福/詛咒/遠古變體/屬性/en 全部入鍵；不同來源不分堆）',
      'function consolidateInventory() {',
    ],
    '載入時強化品堆疊',
    source => {
      source = ctx.patchNamedFunction('js/13-shop-save.js', source, 'consolidateInventory', block => {
        let next = ctx.replaceOnce(
          'js/13-shop-save.js',
          block,
          '        if ((it.en || 0) !== 0) { out.push(it); return; }   // 強化品不合併\n',
          '',
          '載入時允許同強化值合併'
        );
        return ctx.replaceOnce(
          'js/13-shop-save.js',
          next,
          '        let key = itemSig(it);   // 🔧 架構#3：統一簽章（祝福/詛咒/遠古變體/屬性/en 全部入鍵）',
          '        let key = itemSig(it);   // 🔧 架構#3：統一簽章（祝福/詛咒/遠古變體/屬性/en 全部入鍵；不同來源不分堆）',
          '載入合併忽略來源'
        );
      });
      return source;
    }
  );

  patchFile(
    ctx,
    'js/14-craft-pandora.js',
    ['    invAddOrStack(inst);'],
    '客製製作品堆疊',
    source => {
      const count = source.split('    player.inv.push(inst);').length - 1;
      if (count !== 2) {
        throw new Error(`[js/14-craft-pandora.js] 客製製作品錨點應恰好 2 處，實際 ${count} 處。`);
      }
      return source.replaceAll('    player.inv.push(inst);', '    invAddOrStack(inst);');
    }
  );

  patchFile(
    ctx,
    'js/22-pets.js',
    [
      '_gearBack.forEach(g => { let _back = _petGearUnpack(g); if (!invMergeBack(_back)) player.inv.push(_back); });',
      'if (old) { let _back = _petGearUnpack(old); if (!invMergeBack(_back)) player.inv.push(_back); }',
      '{ let _back = _petGearUnpack(g); if (!invMergeBack(_back)) player.inv.push(_back); }',
      'if (!invMergeBack(_pg)) player.inv.push(_pg);',
    ],
    '寵物退裝堆疊',
    source => {
      const replacements = [
        [
          '    _gearBack.forEach(g => player.inv.push(_petGearUnpack(g)));',
          '    _gearBack.forEach(g => { let _back = _petGearUnpack(g); if (!invMergeBack(_back)) player.inv.push(_back); });',
        ],
        [
          '    if (old) player.inv.push(_petGearUnpack(old));',
          '    if (old) { let _back = _petGearUnpack(old); if (!invMergeBack(_back)) player.inv.push(_back); }',
        ],
        [
          '    player.inv.push(_petGearUnpack(g));',
          '    { let _back = _petGearUnpack(g); if (!invMergeBack(_back)) player.inv.push(_back); }',
        ],
        [
          '            player.inv.push(_pg);',
          '            if (!invMergeBack(_pg)) player.inv.push(_pg);',
        ],
      ];
      for (const [anchor, replacement] of replacements) {
        source = ctx.replaceOnce('js/22-pets.js', source, anchor, replacement, '寵物退裝統一堆疊');
      }
      return source;
    }
  );
}
