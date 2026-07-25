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

function removeNamedFunction(file, source, name) {
  const token = `function ${name}(`;
  const start = source.indexOf(token);
  if (start < 0 || source.indexOf(token, start + token.length) >= 0) {
    throw new Error(`[${file}] ${name} 函式錨點不存在或不唯一。`);
  }
  const open = source.indexOf('{', start);
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
  let end = close + 1;
  if (source.slice(end, end + 2) === '\r\n') end += 2;
  else if (source[end] === '\n') end += 1;
  return source.slice(0, start) + source.slice(end);
}

export function patchSherineSetRework(ctx) {
  patchFile(
    ctx,
    'js/01-drops-config.js',
    [
      "'紅獅': ['2件：額外傷害+5、額外魔法點數+3', '3件：傷害減免+10', '5件：最終傷害+10%（普攻與技能皆適用）']",
      "'白鳥': ['2件：額外命中+5', '3件：魅力+10', '5件：一般攻擊命中時使目標「脆弱」3秒（受所有來源傷害+10%，重複觸發刷新）']",
      "'鐵衛': ['2件：AC-3、傷害減免+5', '3件：受到傷害減少20%', '5件：一般攻擊命中附加嘲諷 3 秒，使目標優先攻擊自身；受嘲諷目標的一般攻擊傷害-10%']",
      "'麗人': ['2件：近距離傷害+3、近距離命中+3', '3件：近距離爆擊率+3%', '5件：裝備近距離武器時，攻擊速度+20%']",
      "'月光': ['2件：額外傷害+2、額外命中+3', '3件：ER+5、MR+10', '5件：一般攻擊或技能造成傷害時，使目標「碎裂」3秒（AC-10，最多1層，重複觸發刷新）']",
      "'暗影': ['2件：額外傷害+7', '3件：裝備鋼爪、雙刀時，雙擊觸發機率+20%', '5件：雙擊觸發的額外一般攻擊傷害加倍']",
      "'狂怒': ['2件：負重上限+500', '3件：最大HP+20%', '5件：HP每少10%，造成傷害+3%、受到傷害-3%（最多±15%，即HP低於50%時達上限）']",
      'if (t && t.st) { if (t.st.fragile > 0) m *= 1.1; if (t.st.armorbreak > 0) m *= 1.58; }',
    ],
    '七套席琳遺骸說明與白鳥倍率',
    source => {
      const replacements = [
        [
          "    '紅獅': ['2件：額外傷害+5、額外魔法點數+3', '3件：傷害減免+10', '5件：最終傷害+20%（普攻與技能皆適用）'],",
          "    '紅獅': ['2件：額外傷害+5、額外魔法點數+3', '3件：傷害減免+10', '5件：最終傷害+10%（普攻與技能皆適用）'],",
        ],
        [
          "    '白鳥': ['2件：額外命中+5', '3件：魅力+10', '5件：一般攻擊命中時使目標「脆弱」3秒（受所有傷害+20%，重複觸發刷新）'],",
          "    '白鳥': ['2件：額外命中+5', '3件：魅力+10', '5件：一般攻擊命中時使目標「脆弱」3秒（受所有來源傷害+10%，重複觸發刷新）'],",
        ],
        [
          "    '鐵衛': ['2件：AC-3、傷害減免+5', '3件：受到傷害減少20%', '5件：受到傷害時，額外對全體敵人造成一次必中的一般攻擊'],",
          "    '鐵衛': ['2件：AC-3、傷害減免+5', '3件：受到傷害減少20%', '5件：一般攻擊命中附加嘲諷 3 秒，使目標優先攻擊自身；受嘲諷目標的一般攻擊傷害-10%'],",
        ],
        [
          "    '麗人': ['2件：近距離傷害+3、近距離命中+3', '3件：近距離爆擊率+3%', '5件：每觸發一次攻擊未命中，額外命中+10可堆疊，直到一次物理攻擊命中歸零'],",
          "    '麗人': ['2件：近距離傷害+3、近距離命中+3', '3件：近距離爆擊率+3%', '5件：裝備近距離武器時，攻擊速度+20%'],",
        ],
        [
          "    '月光': ['2件：額外傷害+2、額外命中+3', '3件：ER+5、MR+10', '5件：ER 也能迴避魔法攻擊（怪物必中技能改為先判定 ER）'],",
          "    '月光': ['2件：額外傷害+2、額外命中+3', '3件：ER+5、MR+10', '5件：一般攻擊或技能造成傷害時，使目標「碎裂」3秒（AC-10，最多1層，重複觸發刷新）'],",
        ],
        [
          "    '暗影': ['2件：額外傷害+7', '3件：觸發迴避時恢復 2% HP', '5件：雙擊觸發的額外一般攻擊傷害加倍'],",
          "    '暗影': ['2件：額外傷害+7', '3件：裝備鋼爪、雙刀時，雙擊觸發機率+20%', '5件：雙擊觸發的額外一般攻擊傷害加倍'],",
        ],
        [
          "    '狂怒': ['2件：負重上限+500', '3件：最大HP+20%', '5件：HP每少10%，造成傷害+4%、受到傷害-4%（最多±20%，即HP低於50%時達上限）']",
          "    '狂怒': ['2件：負重上限+500', '3件：最大HP+20%', '5件：HP每少10%，造成傷害+3%、受到傷害-3%（最多±15%，即HP低於50%時達上限）']",
        ],
        ['// 脆弱（白鳥5）：受所有主要傷害來源 +20%', '// 脆弱（白鳥5）：受所有來源傷害 +10%'],
        [
          '    if (t && t.st) { if (t.st.fragile > 0) m *= 1.2; if (t.st.armorbreak > 0) m *= 1.58; }',
          '    if (t && t.st) { if (t.st.fragile > 0) m *= 1.1; if (t.st.armorbreak > 0) m *= 1.58; }',
        ],
        ['}   // 🔮 脆弱(白鳥5)+20%、🔧 破壞盔甲+58%；👑 精準目標（隊長或傭兵擇一）', '}   // 🔮 脆弱(白鳥5)+10%、🔧 破壞盔甲+58%；👑 精準目標（隊長或傭兵擇一）'],
      ];
      for (const [anchor, replacement] of replacements) {
        source = ctx.replaceOnce('js/01-drops-config.js', source, anchor, replacement, '席琳套裝文字／倍率');
      }
      return source;
    }
  );

  patchFile(
    ctx,
    'js/02-stats-recompute.js',
    [
      'p._setBeauty5 = _shN(\'麗人\') >= 5;           // 裝備近距離武器時攻擊速度 +20%',
      'delete p._beautyMissStack;',
      'p._setMoon5 = _shN(\'月光\') >= 5;             // 普攻／技能傷害附加碎裂 3 秒（AC-10）',
      'p._setShadow3 = _shN(\'暗影\') >= 3;            // 🔧 暗影 3/5：裝備鋼爪／雙刀時，雙擊觸發機率 +20%',
      'if (_beautyWpn && !_beautyWpn.isBow && !_beautyWpn.ranged) spdMult *= (1 / 1.2);',
    ],
    '七套席琳遺骸能力旗標',
    source => {
      const nl = source.includes('\r\n') ? '\r\n' : '\n';
      const replacements = [
        ['p._setRedLion5 = _shN(\'紅獅\') >= 5;          // 最終傷害 +20%', 'p._setRedLion5 = _shN(\'紅獅\') >= 5;          // 最終傷害 +10%'],
        [
          '    p._setIron5 = _shN(\'鐵衛\') >= 5;             // 🔧 受到傷害時，額外對全體敵人造成一次必中的一般攻擊（受擊處觸發）',
          '    p._setIron5 = _shN(\'鐵衛\') >= 5;             // 🔧 一般攻擊命中附加嘲諷 3 秒（怪物單體攻擊優先鎖定自身，且一般攻擊傷害 -10%）',
        ],
        [
          '    p._setBeauty5 = _shN(\'麗人\') >= 5;           // 🔧 每次攻擊未命中→額外命中+10可堆疊，直到一次物理命中歸零（getPhysicalDmg）' + nl +
          '    if (!p._setBeauty5) p._beautyMissStack = 0;  // 卸下套裝即清未命中堆疊',
          '    p._setBeauty5 = _shN(\'麗人\') >= 5;           // 裝備近距離武器時攻擊速度 +20%' + nl +
          '    delete p._beautyMissStack;                    // 清除舊版麗人 5/5 的未命中堆疊 runtime',
        ],
        [
          '    p._setMoon5 = _shN(\'月光\') >= 5;             // ER 可迴避魔法（applyMobMagic 套用）',
          '    p._setMoon5 = _shN(\'月光\') >= 5;             // 普攻／技能傷害附加碎裂 3 秒（AC-10）',
        ],
        [
          '    p._setShadow3 = _shN(\'暗影\') >= 3;            // 🔧 暗影 3/5：觸發迴避時恢復 2% HP（迴避處套用）',
          '    p._setShadow3 = _shN(\'暗影\') >= 3;            // 🔧 暗影 3/5：裝備鋼爪／雙刀時，雙擊觸發機率 +20%',
        ],
        ['5件 血量每少10%造傷+4%/受傷-4%(最多±20%)', '5件 血量每少10%造傷+3%/受傷-3%(最多±15%)'],
      ];
      for (const [anchor, replacement] of replacements) {
        source = ctx.replaceOnce('js/02-stats-recompute.js', source, anchor, replacement, '席琳套裝旗標');
      }
      const anchor = '    d.aspd = d.aspd * spdMult;   // 攻速倍率（加速/勇敢/餅乾/精通/裝備等）套入攻擊間隔；施法改由 castIntervalTicks 只讀職業／變身 cast';
      const block = [
        '    if (p._setBeauty5 && p.eq && p.eq.wpn) {',
        '        let _beautyWpn = DB.items[p.eq.wpn.id];',
        '        if (_beautyWpn && !_beautyWpn.isBow && !_beautyWpn.ranged) spdMult *= (1 / 1.2);   // 麗人 5/5：近距離武器攻速 +20%',
        '    }',
        anchor,
      ].join(nl);
      return ctx.replaceOnce('js/02-stats-recompute.js', source, anchor, block, '麗人近戰攻速');
    }
  );

  patchFile(
    ctx,
    'js/03-combat-core.js',
    [
      'function comboTriggerChance(owner, wpn, wpnRef) {',
      'if (owner && owner._setShadow3 && (tags.includes(\'鋼爪\') || tags.includes(\'雙刀\'))) chance += 20;',
      'if(!hit) return { dmg: 0, hit: false, heavy: false, crit: false, graze: false, crush: false, ranged: isRanged };',
      'moonShatterOnDamage(player, target, dmg);',
      'ironGuardTaunt(target, player)',
    ],
    '玩家七套戰鬥核心',
    source => {
      const nl = source.includes('\r\n') ? '\r\n' : '\n';
      source = ctx.replaceOnce(
        'js/03-combat-core.js',
        source,
        'function getPhysicalDmg(diceStr, target, wpn, arrowData, forceHeavy, forceHit, forceLand, forceCrit, wpnInst, forceGraze, probe) {   // 🔎 v3.5.87 probe=true：純探測模式（穿透波及命中判定用）——不寫 _beautyMissStack、不設 _vfxBig、不消耗潮濕 _wetUntil；回傳值照常',
        'function getPhysicalDmg(diceStr, target, wpn, arrowData, forceHeavy, forceHit, forceLand, forceCrit, wpnInst, forceGraze, probe) {',
        '麗人物理函式註解'
      );
      source = ctx.replaceOnce(
        'js/03-combat-core.js',
        source,
        '    let hitBonus = (isRanged ? player.d.rangedHit : player.d.meleeHit) + player.d.extraHit + (player._skillHitBonus || 0) + (player._setBeauty5 ? (player._beautyMissStack || 0) : 0);   // 🗼 范德之劍：施展衝擊之暈時本次技能近距離命中+1；🔮 麗人5/5：未命中堆疊命中',
        '    let hitBonus = (isRanged ? player.d.rangedHit : player.d.meleeHit) + player.d.extraHit + (player._skillHitBonus || 0);   // 🗼 范德之劍：施展衝擊之暈時本次技能近距離命中+1',
        '麗人命中移除'
      );
      source = ctx.replaceOnce(
        'js/03-combat-core.js',
        source,
        '    if(!hit) { if (player._setBeauty5 && !probe) player._beautyMissStack = (player._beautyMissStack || 0) + 10; return { dmg: 0, hit: false, heavy: false, crit: false, graze: false, crush: false, ranged: isRanged }; }   // 🔮 麗人5/5：未命中→額外命中+10可堆疊（🔎 探測不堆疊）' + nl +
        '    if (player._setBeauty5 && player._beautyMissStack && !probe) player._beautyMissStack = 0;   // 🔮 麗人5/5：物理命中→堆疊歸零（🔎 探測不歸零）',
        '    if(!hit) return { dmg: 0, hit: false, heavy: false, crit: false, graze: false, crush: false, ranged: isRanged };',
        '麗人命中堆疊移除'
      );
      source = ctx.replaceOnce(
        'js/03-combat-core.js',
        source,
        '    _outDmg = Math.max(1, Math.floor(_outDmg * fragileMult(target)));   // 🔮 脆弱（白鳥5）：受所有來源傷害 +20%',
        '    _outDmg = Math.max(1, Math.floor(_outDmg * fragileMult(target)));   // 🔮 脆弱（白鳥5）：受所有來源傷害 +10%',
        '白鳥倍率註解'
      );
      source = ctx.replaceOnce(
        'js/03-combat-core.js',
        source,
        '    _outDmg = Math.max(1, Math.floor(_outDmg * rlFuryMult()));   // 🔮 紅獅5/5(×1.2)＋😡狂怒5/5：最終傷害（普攻及所有走本函式的物理攻擊：反擊/居合/看破/連擊/連射/穿透/魔擊/物理技能）',
        '    _outDmg = Math.max(1, Math.floor(_outDmg * rlFuryMult()));   // 🔮 紅獅5/5(×1.1)＋😡狂怒5/5：最終傷害（普攻及所有走本函式的物理攻擊：反擊/居合/看破/連擊/連射/穿透/魔擊/物理技能）',
        '紅獅倍率註解'
      );
      const comboAnchor = '// 雙擊（鋼爪/雙刀）：依武器 comboRate% 機率發動，追加一次「額外一般攻擊」，獨立判定命中、傷害＝完整一般攻擊（🔮 暗影5/5→額外攻擊再×1.5）；本身不再觸發雙擊/穿透等（不遞迴）。fullDmg=false（爆擊精通沿用）保留舊倍率×0.5（暗影5/5×1.0）';
      const comboBlock = [
        '// 雙擊（鋼爪/雙刀）：暗影 3/5 裝備鋼爪／雙刀時，於武器基礎機率額外 +20%。',
        'function comboTriggerChance(owner, wpn, wpnRef) {',
        '    if (!wpn || wpn.eff !== \'combo\') return 0;',
        '    let chance = Math.max(0, Number(wpn.comboRate) || 0);',
        '    let ref = wpnRef || (owner && owner.eq && owner.eq.wpn);',
        '    let tags = ref && typeof getWeaponTags === \'function\' ? getWeaponTags(ref.id) : [];',
        '    if (owner && owner._setShadow3 && (tags.includes(\'鋼爪\') || tags.includes(\'雙刀\'))) chance += 20;',
        '    return Math.min(100, chance);',
        '}',
        '// 雙擊（鋼爪/雙刀）：依武器雙擊機率追加一次「額外一般攻擊」，獨立判定命中、傷害＝完整一般攻擊（暗影5/5→額外攻擊傷害加倍）；本身不再觸發雙擊/穿透等（不遞迴）。fullDmg=false（爆擊精通沿用）保留舊倍率×0.5（暗影5/5×1.0）',
      ].join(nl);
      source = ctx.replaceOnce('js/03-combat-core.js', source, comboAnchor, comboBlock, '暗影雙擊機率');
      source = removeNamedFunction('js/03-combat-core.js', source, 'ironGuardSweep');
      for (const comment of [
        '    // 🔮 鐵衛 5/5：改由「受到傷害時」觸發（見 enemyPhysicalAttack / applyMobMagic），不再於反擊時觸發',
        '    // 🔮 鐵衛 5/5：改由「受到傷害時」觸發（見 enemyPhysicalAttack / applyMobMagic），不再於居合時觸發',
        '// 🔮 鐵衛 5/5：受到傷害時，額外對全體敵人造成一次「必中」的一般攻擊（每 tick 最多觸發一次，避免連續受擊洗版）',
      ]) {
        source = ctx.replaceOnce('js/03-combat-core.js', source, comment + nl, '', '舊鐵衛說明移除');
      }
      source = ctx.patchNamedFunction('js/03-combat-core.js', source, 'qiguPlayerAttack', block => {
        let next = ctx.replaceOnce(
          'js/03-combat-core.js',
          block,
          "    target.justHit = (ele !== 'none') ? ele : 'magic';",
          "    target.justHit = (ele !== 'none') ? ele : 'magic';\n" +
          "    if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, target, dmg);",
          '奇古獸碎裂'
        );
        return ctx.replaceOnce(
          'js/03-combat-core.js',
          next,
          "    if (player.dead) return;   // ☠️ v3.5.87 反射可反殺施放者：死後中止收尾（不結算擊殺/特效 proc·比照 js/04 playerAttack）",
          "    if (player.dead) return;   // ☠️ v3.5.87 反射可反殺施放者：死後中止收尾（不結算擊殺/特效 proc·比照 js/04 playerAttack）\n" +
          "    if (target.curHp > 0 && player._setIron5 && typeof ironGuardTaunt === 'function' && ironGuardTaunt(target, player)) logCombat(`<span class=\"font-bold\" style=\"color:#93c5fd;text-shadow:0 0 6px #3b82f6;\">【鐵衛 5/5】</span>嘲諷 <span class=\"${getMobColor(target.lv)}\">${target.n}</span>！（3 秒）`, 'player-special');",
          '奇古獸鐵衛嘲諷'
        );
      });
      return source;
    }
  );

  patchFile(
    ctx,
    'js/04-combat-attack.js',
    [
      'moonShatterOnDamage(player, target, result.dmg);',
      'moonShatterOnDamage(player, exT, _pierceDmg);',
      'comboTriggerChance(player, wpn, player.eq && player.eq.wpn)',
      'return Math.min(0.15, Math.max(0, Math.floor(miss * 10 + 1e-9) * 0.03));',
      'function rlFuryMult() { return (player && player._setRedLion5 ? 1.1 : 1.0) * (1 + furyRageRatio()); }',
      'function allyRlFuryMult(ally) { return (ally && ally._setRedLion5 ? 1.1 : 1.0) * (1 + allyFuryRageRatio(ally)); }',
      "let ironTarget = (typeof ironGuardTauntTarget === 'function') ? ironGuardTauntTarget(mob) : null;",
      "if (isBasicAttack && typeof ironGuardTauntWeakensAttack === 'function' && ironGuardTauntWeakensAttack(mob)) totalDmg = Math.floor(totalDmg * 0.9);",
    ],
    '七套席琳玩家／受擊戰鬥掛點',
    source => {
      const nl = source.includes('\r\n') ? '\r\n' : '\n';
      source = ctx.replaceOnce(
        'js/04-combat-attack.js',
        source,
        '    let _sureHit = !!player._darkEvadeSure;   // 🔧 迴避精通：下一次一般攻擊必中（🔮 麗人5/5 已改為「未命中堆疊命中」，不再走必中）',
        '    let _sureHit = !!player._darkEvadeSure;   // 🔧 迴避精通：下一次一般攻擊必中',
        '麗人一般攻擊註解'
      );
      source = ctx.replaceOnce(
        'js/04-combat-attack.js',
        source,
        '    let result = getPhysicalDmg(dice, target, wpn, arrowData, false, false, _sureHit, _sureCrit);   // 🔮 麗人 5/5：必中（可自然重擊/爆擊）；🔧 迴避精通：必中且必爆',
        '    let result = getPhysicalDmg(dice, target, wpn, arrowData, false, false, _sureHit, _sureCrit);   // 🔧 迴避精通：必中且必爆',
        '麗人物理命中註解'
      );
      source = ctx.replaceOnce(
        'js/04-combat-attack.js',
        source,
        '                    //   🔎 v3.5.87 探測模式（末參 probe=true）：只借命中骰·不污染 _beautyMissStack/_vfxBig/不白耗潮濕（實際傷害用主目標的 _pierceDmg）',
        '                    //   🔎 v3.5.87 探測模式（末參 probe=true）：只借命中骰·不污染 runtime 視覺狀態／不白耗潮濕（實際傷害用主目標的 _pierceDmg）',
        '麗人探測註解'
      );
      source = ctx.replaceOnce(
        'js/04-combat-attack.js',
        source,
        '        if (player.dead) { player._flameSlashFire = false; return; }   // ⚡ v3.5.89 早退前先消耗一次性旗標：燃燒擊砍在扣血前就設起，若直接 return 會殘留到復活後的下一擊（憑空再噴一次火屬性）',
        '        if (player.dead) { player._flameSlashFire = false; return; }   // ⚡ v3.5.89 早退前先消耗一次性旗標：燃燒擊砍在扣血前就設起，若直接 return 會殘留到復活後的下一擊（憑空再噴一次火屬性）' + nl +
        '        if (target.curHp > 0 && player._setIron5 && typeof ironGuardTaunt === \'function\' && ironGuardTaunt(target, player)) logCombat(`<span class="font-bold" style="color:#93c5fd;text-shadow:0 0 6px #3b82f6;">【鐵衛 5/5】</span>嘲諷 <span class="${getMobColor(target.lv)}">${target.n}</span>！（3 秒）`, \'player-special\');',
        '玩家鐵衛嘲諷'
      );
      source = ctx.replaceOnce(
        'js/04-combat-attack.js',
        source,
        '        // 🔮 麗人 5/5：已改為「未命中→額外命中+10可堆疊，命中歸零」（見 getPhysicalDmg），不再於重擊後給必中' + nl +
        '        if (player._setWhiteBird5 && target.curHp > 0) { if (!target.st) target.st = newMobStatus(); target.st.fragile = 30; }   // 🔮 白鳥 5/5：脆弱 3 秒（重複觸發刷新）',
        '        if (player._setWhiteBird5 && target.curHp > 0) { if (!target.st) target.st = newMobStatus(); target.st.fragile = 30; }   // 🔮 白鳥 5/5：脆弱 3 秒（重複觸發刷新）' + nl +
        '        if (typeof moonShatterOnDamage === \'function\') moonShatterOnDamage(player, target, result.dmg);',
        '玩家普攻碎裂'
      );
      source = ctx.replaceOnce(
        'js/04-combat-attack.js',
        source,
        '                    exT.curHp -= _pierceDmg;',
        '                    exT.curHp -= _pierceDmg;' + nl +
        '                    if (typeof moonShatterOnDamage === \'function\') moonShatterOnDamage(player, exT, _pierceDmg);',
        '穿透碎裂'
      );
      source = ctx.replaceOnce(
        'js/04-combat-attack.js',
        source,
        '    // 雙擊（鋼爪/雙刀）：發動攻擊即依武器 comboRate% 機率追加一次完整一般攻擊（不論主攻擊命中與否）' + nl +
        "    if (wpn && Math.random() * 100 < (player._forceComboRate != null ? player._forceComboRate : (wpn.eff === 'combo' ? (wpn.comboRate || 0) : 0))) procCombo(target, true);",
        '    // 雙擊（鋼爪/雙刀）：發動攻擊即依武器機率判定；暗影 3/5 持鋼爪／雙刀時額外 +20%（不論主攻擊命中與否）' + nl +
        '    if (wpn && Math.random() * 100 < (player._forceComboRate != null ? player._forceComboRate : comboTriggerChance(player, wpn, player.eq && player.eq.wpn))) procCombo(target, true);',
        '玩家暗影雙擊'
      );
      source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'dragonStrikeProc', block =>
        ctx.replaceOnce(
          'js/04-combat-attack.js',
          block,
          '        m.curHp -= dmg;',
          '        m.curHp -= dmg;\n' +
          '        if (typeof moonShatterOnDamage === \'function\') moonShatterOnDamage(player, m, dmg);',
          '龍之衝擊碎裂'
        )
      );
      source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'dragonSlayStrikeProc', block =>
        ctx.replaceOnce(
          'js/04-combat-attack.js',
          block,
          '        m.curHp -= dmg;',
          '        m.curHp -= dmg;\n' +
          '        if (typeof moonShatterOnDamage === \'function\') moonShatterOnDamage(player, m, dmg);',
          '滅龍斬擊碎裂'
        )
      );
      source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'stormBuffTick', block =>
        ctx.replaceOnce(
          'js/04-combat-attack.js',
          block,
          "        d = illusionMagicDmg(d, true, _illusionIdx === 0); t.curHp -= d; t.justHit = (sk.ele && sk.ele !== 'none') ? sk.ele : 'magic'; mobWake(t);",
          "        d = illusionMagicDmg(d, true, _illusionIdx === 0); t.curHp -= d; t.justHit = (sk.ele && sk.ele !== 'none') ? sk.ele : 'magic'; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, t, d); mobWake(t);",
          '持續法術碎裂'
        )
      );

      const ratioReplacements = [
        [
          '// 😡 狂怒 5/5 戰意比例：HP 每少 10% → 0.04（造傷+4%/受傷-4%），最多 0.20（HP≤50% 達上限）。未裝狂怒5→0。',
          '// 😡 狂怒 5/5 戰意比例：HP 每少 10% → 0.03（造傷+3%/受傷-3%），最多 0.15（HP≤50% 達上限）。未裝狂怒5→0。',
        ],
        [
          '    return Math.min(0.20, Math.max(0, Math.floor(miss * 10 + 1e-9) * 0.04));   // +1e-9：吸收浮點誤差（如 1-0.9=0.0999…→floor 應得 1），確保「每少 10% 血」邊界正確',
          '    return Math.min(0.15, Math.max(0, Math.floor(miss * 10 + 1e-9) * 0.03));   // +1e-9：吸收浮點誤差（如 1-0.9=0.0999…→floor 應得 1），確保「每少 10% 血」邊界正確',
        ],
        [
          '    return Math.min(0.20, Math.max(0, Math.floor(miss * 10 + 1e-9) * 0.04));',
          '    return Math.min(0.15, Math.max(0, Math.floor(miss * 10 + 1e-9) * 0.03));',
        ],
        [
          'function rlFuryMult() { return (player && player._setRedLion5 ? 1.2 : 1.0) * (1 + furyRageRatio()); }',
          'function rlFuryMult() { return (player && player._setRedLion5 ? 1.1 : 1.0) * (1 + furyRageRatio()); }',
        ],
        [
          'function allyRlFuryMult(ally) { return (ally && ally._setRedLion5 ? 1.2 : 1.0) * (1 + allyFuryRageRatio(ally)); }',
          'function allyRlFuryMult(ally) { return (ally && ally._setRedLion5 ? 1.1 : 1.0) * (1 + allyFuryRageRatio(ally)); }',
        ],
        [
          '// 🔮 紅獅5/5(最終傷害×1.2) ＋ 😡 狂怒5/5(每少10%血造傷+4%·最多+20%) 的「玩家最終傷害」共用乘數（套用於所有原本掛 _setRedLion5 的點，無套裝時＝1.0）',
          '// 🔮 紅獅5/5(最終傷害×1.1) ＋ 😡 狂怒5/5(每少10%血造傷+3%·最多+15%) 的「玩家最終傷害」共用乘數（套用於所有原本掛 _setRedLion5 的點，無套裝時＝1.0）',
        ],
        [
          '// 🆕 v2.6.18 [傭兵能力補完·中影響] 傭兵版最終傷害共用乘數＝🔴紅獅5(×1.2) × (1+😡狂怒5造傷)。對稱玩家 rlFuryMult()，套用於所有傭兵攻擊最終傷害輸出點（讀 ally.curHp·無套裝＝1.0）。原本傭兵只在部分魔法點吃紅獅5、物理全無→本版統一補齊紅獅5＋狂怒5。',
          '// 🆕 v2.6.18 [傭兵能力補完·中影響] 傭兵版最終傷害共用乘數＝🔴紅獅5(×1.1) × (1+😡狂怒5造傷)。對稱玩家 rlFuryMult()，套用於所有傭兵攻擊最終傷害輸出點（讀 ally.curHp·無套裝＝1.0）。',
        ],
        [
          '    if (ally && ally._setFury5) m *= (1 - allyFuryRageRatio(ally));   // 😡 狂怒 5/5：依失血最多 -20%',
          '    if (ally && ally._setFury5) m *= (1 - allyFuryRageRatio(ally));   // 😡 狂怒 5/5：依失血最多 -15%',
        ],
        [
          '          if (player._setFury5) _drMult *= (1 - furyRageRatio());        // 😡 狂怒 5/5：依失血最多 -20%',
          '          if (player._setFury5) _drMult *= (1 - furyRageRatio());        // 😡 狂怒 5/5：依失血最多 -15%',
        ],
        [
          '          if (player._setFury5) _drMult *= (1 - furyRageRatio());                                                // 😡 狂怒 5/5：依失血最多 -20%',
          '          if (player._setFury5) _drMult *= (1 - furyRageRatio());                                                // 😡 狂怒 5/5：依失血最多 -15%',
        ],
        [
          '    totalDmg = Math.floor(totalDmg * allyBuffDmgReduceMult(ally));   // 🆕 v2.6.12 #5a：傭兵聖結界-30%/龍裔-15%/狂怒5-20%（讀傭兵自身 buff/套裝）',
          '    totalDmg = Math.floor(totalDmg * allyBuffDmgReduceMult(ally));   // 🆕 v2.6.12 #5a：傭兵聖結界-30%/龍裔-15%/狂怒5-15%（讀傭兵自身 buff/套裝）',
        ],
        [
          '        dmg = Math.floor(dmg * allyBuffDmgReduceMult(ally));   // 🆕 v2.6.12 #5a：傭兵聖結界-30%/龍裔-15%/狂怒5-20%（受魔法傷害）',
          '        dmg = Math.floor(dmg * allyBuffDmgReduceMult(ally));   // 🆕 v2.6.12 #5a：傭兵聖結界-30%/龍裔-15%/狂怒5-15%（受魔法傷害）',
        ],
        [
          '        dmg = Math.max(1, Math.floor(dmg * rlFuryMult()));   // 🔮 紅獅5/5(×1.2)＋😡狂怒5/5(失血造傷·最多+20%) 最終傷害',
          '        dmg = Math.max(1, Math.floor(dmg * rlFuryMult()));   // 🔮 紅獅5/5(×1.1)＋😡狂怒5/5(失血造傷·最多+15%) 最終傷害',
        ],
      ];
      for (const [anchor, replacement] of ratioReplacements) {
        source = ctx.replaceOnce('js/04-combat-attack.js', source, anchor, replacement, '紅獅／狂怒倍率');
      }

      source = ctx.patchNamedFunction('js/04-combat-attack.js', source, '_enemyPhysicalAttackInner', block => {
        let next = ctx.replaceOnce(
          'js/04-combat-attack.js',
          block,
          '        if (player._setShadow3) { player.hp = Math.min(player.mhp, player.hp + Math.floor(player.mhp * 0.02)); }   // 🔧 暗影 3/5：觸發迴避恢復 2% HP\n',
          '',
          '玩家暗影迴避回血移除'
        );
        next = ctx.replaceOnce(
          'js/04-combat-attack.js',
          next,
          '        totalDmg = Math.floor(totalDmg * mobRageDmgMult(mob));   // 🔥 HP<門檻：一般攻擊／連擊最終傷害倍率',
          '        totalDmg = Math.floor(totalDmg * mobRageDmgMult(mob));   // 🔥 HP<門檻：一般攻擊／連擊最終傷害倍率\n' +
          '        if (isBasicAttack && typeof ironGuardTauntWeakensAttack === \'function\' && ironGuardTauntWeakensAttack(mob)) totalDmg = Math.floor(totalDmg * 0.9);   // 🔮 鐵衛 5/5：受嘲諷目標的一般攻擊傷害 -10%',
          '玩家受鐵衛嘲諷減傷'
        );
        return ctx.replaceOnce(
          'js/04-combat-attack.js',
          next,
          '        if (player._setIron5 && totalDmg > 0 && player.hp > 0) ironGuardSweep();   // 🔮 鐵衛 5/5：受到（物理）傷害時，對全體必中反擊（每 tick 節流）\n',
          '',
          '玩家鐵衛舊橫掃移除'
        );
      });
      source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'enemyAttackChooseVictim', block =>
        ctx.replaceOnce(
          'js/04-combat-attack.js',
          block,
          '    let allies = (player.allies || []).filter(a => a && !a._downed && (a.curHp || 0) > 0);',
          '    let allies = (player.allies || []).filter(a => a && !a._downed && (a.curHp || 0) > 0);\n' +
          "    let ironTarget = (typeof ironGuardTauntTarget === 'function') ? ironGuardTauntTarget(mob) : null;\n" +
          '    if (ironTarget === player) { enemyPhysicalAttack(mob, idx, 0, null, null, true); return; }\n' +
          '    if (ironTarget) { enemyAttackAlly(mob, ironTarget, true); return; }',
          '鐵衛一般攻擊鎖定'
        )
      );
      source = ctx.patchNamedFunction('js/04-combat-attack.js', source, '_enemyAttackAllyInner', block => {
        let next = ctx.replaceOnce(
          'js/04-combat-attack.js',
          block,
          '            if (ally._setShadow3) ally.curHp = Math.min(ally.mhp || 1, (ally.curHp || 0) + Math.floor((ally.mhp || 1) * 0.02));   // 🔮 暗影3/5：迴避恢復 2% HP\n',
          '',
          '傭兵暗影迴避回血移除'
        );
        next = ctx.replaceOnce(
          'js/04-combat-attack.js',
          next,
          '    totalDmg = Math.floor(totalDmg * mobRageDmgMult(mob));   // 🔥 HP<門檻：攻擊傭兵也套用狂暴傷害',
          '    totalDmg = Math.floor(totalDmg * mobRageDmgMult(mob));   // 🔥 HP<門檻：攻擊傭兵也套用狂暴傷害\n' +
          '    if (isBasicAttack && typeof ironGuardTauntWeakensAttack === \'function\' && ironGuardTauntWeakensAttack(mob)) totalDmg = Math.floor(totalDmg * 0.9);   // 🔮 鐵衛 5/5：受嘲諷目標的一般攻擊傷害 -10%',
          '傭兵受鐵衛嘲諷減傷'
        );
        return ctx.replaceOnce(
          'js/04-combat-attack.js',
          next,
          '    if (ally._setIron5 && ally.eq && ally.eq.wpn && ally._ironSweepTick !== state.ticks) { ally._ironSweepTick = state.ticks; allyIronGuardSweep(ally, \'受擊\'); }   // 🆕 v2.6.14 #5c：鐵衛5/5 受擊橫掃（每 tick 節流）\n',
          '',
          '傭兵鐵衛物理橫掃移除'
        );
      });
      source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'castMobMagic', block =>
        ctx.replaceOnce(
          'js/04-combat-attack.js',
          block,
          '    if (!allies.length && !pets.length && !sumIn && !guardIn) { applyMobMagic(mob, sk); return; }',
          "    let ironTarget = (typeof ironGuardTauntTarget === 'function') ? ironGuardTauntTarget(mob) : null;\n" +
          '    if (ironTarget === player) { applyMobMagic(mob, sk); return; }\n' +
          '    if (ironTarget) { applyMobMagicToAlly(mob, sk, ironTarget); return; }\n' +
          '    if (!allies.length && !pets.length && !sumIn && !guardIn) { applyMobMagic(mob, sk); return; }',
          '鐵衛單體魔法鎖定'
        )
      );
      source = ctx.patchNamedFunction('js/04-combat-attack.js', source, '_applyMobMagicToAllyInner', block => {
        let next = ctx.replaceOnce(
          'js/04-combat-attack.js',
          block,
          '        if (!_asleepA && ally._setMoon5 && roll(1, 100) <= effResistPct((d.er || 0))) { logCombat(`<span class="font-bold" style="color:#c4b5fd;">【月光 5/5】</span>協力·${ally._allyName} 迴避掉 <span class="${getMobColor(mob.lv)}">${mob.n}</span> 的 ${sk.skn || \'魔法\'}。`, \'evade\', \'enemy\'); return; }   // 🔮 月光5：ER 也能閃魔法\n',
          '',
          '傭兵月光魔法迴避移除'
        );
        return ctx.replaceOnce(
          'js/04-combat-attack.js',
          next,
          '        if (ally._setIron5 && ally.eq && ally.eq.wpn && ally._ironSweepTick !== state.ticks) { ally._ironSweepTick = state.ticks; allyIronGuardSweep(ally, \'受擊\'); }   // 🆕 v2.6.14 #5c：鐵衛5/5 受擊橫掃\n',
          '',
          '傭兵鐵衛魔法橫掃移除'
        );
      });
      source = ctx.patchNamedFunction('js/04-combat-attack.js', source, '_applyMobMagicInner', block => {
        const oldMoon = [
          '        // 🔮 月光 5/5：ER 也能迴避魔法攻擊（必中技能改為先判定 ER）',
          '        if (!_asleepM && player._setMoon5 && roll(1, 100) <= effResistPct(player.d.er)) {',
          '            logCombat(`<span class="font-bold" style="color:#c4b5fd;">【月光 5/5】</span>你迴避掉 <span class="${getMobColor(mob.lv)}">${mob.n}</span> 施放的 ${sk.skn || \'魔法\'}。`, \'evade\');',
          '            return;',
          '        }',
          '',
        ].join('\n');
        let next = ctx.replaceOnce('js/04-combat-attack.js', block, oldMoon, '', '玩家月光魔法迴避移除');
        return ctx.replaceOnce(
          'js/04-combat-attack.js',
          next,
          '        if (player._setIron5 && dmg > 0 && player.hp > 0) ironGuardSweep();   // 🔮 鐵衛 5/5：受到（魔法）傷害時亦觸發（每 tick 節流）\n',
          '',
          '玩家鐵衛魔法橫掃移除'
        );
      });
      return source;
    }
  );

  patchFile(
    ctx,
    'js/06-status-allies.js',
    [
      'fragile:0, shatter:0, armorbreak:0',
      'function moonShatterOnDamage(owner, target, dmg) {',
      "shatter:'碎裂'",
      "'fragile','shatter','armorbreak'",
      'comboTriggerChance(ally, wpn, ally.eq && ally.eq.wpn)',
      'moonShatterOnDamage(ally, t, totalDmg);',
      'moonShatterOnDamage(ally, m, _d);',
      'moonShatterOnDamage(ally, t, dmg);',
      'ironGuardTaunt(t, ally)',
    ],
    '傭兵七套戰鬥掛點與碎裂狀態',
    source => {
      const nl = source.includes('\r\n') ? '\r\n' : '\n';
      source = ctx.replaceOnce(
        'js/06-status-allies.js',
        source,
        '             blind:0, blindVal:0, weaken:0, disease:0, vacuum:0, broken:0, slow:0, mrhalf:0, magicseal:0, armorbreak:0, confuse:0, panic:0, guardbreak:0, terror:0, doom:0, strawCurse:0, muddywater:0, bind:0 };',
        '             blind:0, blindVal:0, weaken:0, disease:0, vacuum:0, broken:0, slow:0, mrhalf:0, magicseal:0, fragile:0, shatter:0, armorbreak:0, confuse:0, panic:0, guardbreak:0, terror:0, doom:0, strawCurse:0, muddywater:0, bind:0 };',
        '碎裂狀態初始化'
      );
      const oldMobAc = 'function mobEffAC(m, actor) { let _weakOk = (m.weakExpose > 0) && ((actor && actor !== player) ? allyHasMastery(actor, \'k_weakness\') : hasMastery(\'k_weakness\')); return (m.ac || 0) + ((m.st && m.st.disease > 0) ? 8 : 0) + ((m.st && (m.st.confuse > 0 || m.st.panic > 0)) ? 5 : 0) + ((m.st && m.st.guardbreak > 0) ? 10 : 0) + (_weakOk ? 3 * Math.min(5, m.weakExpose) : 0) - ((m._acGuardEnd > state.ticks) ? (m._acGuardVal || 0) : 0); }   // 🔮 混亂/恐慌：AC+5；🐉 護衛毀滅：AC+10；🐉 弱點精通：每層弱點曝光 AC+3（更易被命中·讀「攻擊者」精通：傭兵傳 actor→吃傭兵自身精通、玩家/召喚無 actor→吃玩家精通）   // 🗼 鋼鐵防護：暫時降低 AC';
      const newMobAc = 'function mobEffAC(m, actor) { let _weakOk = (m.weakExpose > 0) && ((actor && actor !== player) ? allyHasMastery(actor, \'k_weakness\') : hasMastery(\'k_weakness\')); return (m.ac || 0) + ((m.st && m.st.disease > 0) ? 8 : 0) + ((m.st && (m.st.confuse > 0 || m.st.panic > 0)) ? 5 : 0) + ((m.st && m.st.guardbreak > 0) ? 10 : 0) + (_weakOk ? 3 * Math.min(5, m.weakExpose) : 0) - ((m.st && m.st.shatter > 0) ? 10 : 0) - ((m._acGuardEnd > state.ticks) ? (m._acGuardVal || 0) : 0); }   // 🔮 月光碎裂：AC-10；混亂/恐慌：AC+5；🐉 護衛毀滅：AC+10；🐉 弱點精通：每層弱點曝光 AC+3（更易被命中·讀「攻擊者」精通：傭兵傳 actor→吃傭兵自身精通、玩家/召喚無 actor→吃玩家精通）   // 🗼 鋼鐵防護：暫時降低 AC';
      const shatterBlock = [
        newMobAc,
        'function moonShatterOnDamage(owner, target, dmg) {',
        '    if (!owner || !owner._setMoon5 || !target || target._dead || (target.curHp || 0) <= 0 || !(dmg > 0)) return false;',
        '    if (!target.st) target.st = newMobStatus();',
        '    let firstApply = !(target.st.shatter > 0);',
        '    target.st.shatter = 30;   // 月光 5/5：碎裂 3 秒，最多 1 層、重複傷害刷新',
        '    return firstApply;',
        '}',
      ].join(nl);
      source = ctx.replaceOnce('js/06-status-allies.js', source, oldMobAc, shatterBlock, '月光碎裂狀態函式');
      source = ctx.replaceOnce(
        'js/06-status-allies.js',
        source,
        "magicseal:'魔法封印', armorbreak:'破甲', fragile:'脆弱', confuse:'混亂'",
        "magicseal:'魔法封印', fragile:'脆弱', shatter:'碎裂', armorbreak:'破甲', confuse:'混亂'",
        '碎裂狀態名稱'
      );
      source = ctx.replaceOnce(
        'js/06-status-allies.js',
        source,
        '// 🔮 脆弱（白鳥5）：受所有傷害+20%；🐉 護衛毀滅/恐懼/死神；🌊 污濁（污濁之水·頭目回血減半）；🕸️ v3.7.75 束縛',
        '// 🔮 脆弱（白鳥5）：受所有傷害+10%；月光碎裂：AC-10；🐉 護衛毀滅/恐懼/死神；🌊 污濁（污濁之水·頭目回血減半）；🕸️ v3.7.75 束縛',
        '碎裂狀態名稱註解'
      );
      source = ctx.replaceOnce(
        'js/06-status-allies.js',
        source,
        "'magicseal','fragile','armorbreak','confuse','panic','guardbreak','terror','doom','muddywater','bind'].forEach(k => {   // 🔮 含脆弱、🔧 含破壞盔甲",
        "'magicseal','fragile','shatter','armorbreak','confuse','panic','guardbreak','terror','doom','muddywater','bind'].forEach(k => {   // 🔮 含脆弱、月光碎裂、🔧 含破壞盔甲",
        '碎裂狀態倒數'
      );
      source = ctx.patchNamedFunction('js/06-status-allies.js', source, 'allyQiguAttack', block =>
        ctx.replaceOnce(
          'js/06-status-allies.js',
          block,
          "    if (typeof reflectWallOnDamage === 'function') reflectWallOnDamage(t, dmg, 'magic', ally);   // 🌑 v3.4.14 血壁空間：奇古獸普攻主擊＝魔法反射（鏡像玩家 qiguPlayerAttack）",
          "    if (typeof reflectWallOnDamage === 'function') reflectWallOnDamage(t, dmg, 'magic', ally);   // 🌑 v3.4.14 血壁空間：奇古獸普攻主擊＝魔法反射（鏡像玩家 qiguPlayerAttack）\n" +
          '    if (t.curHp > 0 && ally._setIron5 && typeof ironGuardTaunt === \'function\' && ironGuardTaunt(t, ally)) logCombat(`<span class="font-bold" style="color:#93c5fd;text-shadow:0 0 6px #3b82f6;">【協力·${ally._allyName}·鐵衛 5/5】</span>嘲諷 <span class="${getMobColor(t.lv)}">${t.n}</span>！（3 秒）`, \'player-special\');',
          '傭兵奇古獸鐵衛嘲諷'
        )
      );
      source = ctx.patchNamedFunction('js/06-status-allies.js', source, 'allyAttackOnce', block => {
        let next = ctx.replaceOnce(
          'js/06-status-allies.js',
          block,
          "        t.curHp -= dmg; t.justHit = 'magic'; mobWake(t);",
          "        t.curHp -= dmg; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(ally, t, dmg); t.justHit = 'magic'; mobWake(t);",
          '傭兵法師普攻碎裂'
        );
        next = ctx.replaceOnce(
          'js/06-status-allies.js',
          next,
          "        if (typeof reflectWallOnDamage === 'function') reflectWallOnDamage(t, dmg, 'magic', ally);   // 🌑 v3.4.14 血壁空間：法師光箭普攻主擊＝魔法反射（普攻主擊反射·玩家傭兵一致）",
          "        if (typeof reflectWallOnDamage === 'function') reflectWallOnDamage(t, dmg, 'magic', ally);   // 🌑 v3.4.14 血壁空間：法師光箭普攻主擊＝魔法反射（普攻主擊反射·玩家傭兵一致）\n" +
          '        if (t.curHp > 0 && ally._setIron5 && typeof ironGuardTaunt === \'function\' && ironGuardTaunt(t, ally)) logCombat(`<span class="font-bold" style="color:#93c5fd;text-shadow:0 0 6px #3b82f6;">【協力·${ally._allyName}·鐵衛 5/5】</span>嘲諷 <span class="${getMobColor(t.lv)}">${t.n}</span>！（3 秒）`, \'player-special\');',
          '傭兵法師普攻鐵衛嘲諷'
        );
        next = ctx.replaceOnce(
          'js/06-status-allies.js',
          next,
          '        let hitB = (isRanged ? (d.rangedHit||0) : (d.meleeHit||0)) + (d.extraHit||0) + (ally._setBeauty5 ? (ally._beautyMissStack || 0) : 0);   // 🔮 v2.6.21 麗人5/5：未命中堆疊命中（鏡像玩家 js/03:763·取代舊「重擊→必中」）',
          '        let hitB = (isRanged ? (d.rangedHit||0) : (d.meleeHit||0)) + (d.extraHit||0);',
          '傭兵主攻麗人堆疊移除'
        );
        next = ctx.replaceOnce(
          'js/06-status-allies.js',
          next,
          "            if (wpn && Math.random() * 100 < (ally._forceComboRate != null ? ally._forceComboRate : (wpn.eff === 'combo' ? (wpn.comboRate || 0) : 0))) allyComboAttack(ally, t, true);",
          '            if (wpn && Math.random() * 100 < (ally._forceComboRate != null ? ally._forceComboRate : comboTriggerChance(ally, wpn, ally.eq && ally.eq.wpn))) allyComboAttack(ally, t, true);',
          '傭兵被迴避暗影雙擊'
        );
        const oldMiss = "            else { if (ally._setBeauty5) ally._beautyMissStack = (ally._beautyMissStack || 0) + 10;   /* 🔮 v2.6.21 麗人5/5：未命中→命中堆疊+10（鏡像玩家 786） */ if (typeof vfxMiss === 'function') vfxMiss(t); logCombat(`<span class=\"text-sky-300 font-bold\">【協力·${ally._allyName}】</span>的攻擊未命中。`, 'miss'); allyWeaponProcs(ally, t, { hit: false, dmg: 0 }); if (wpn && Math.random() * 100 < (ally._forceComboRate != null ? ally._forceComboRate : (wpn.eff === 'combo' ? (wpn.comboRate || 0) : 0))) allyComboAttack(ally, t, true); return; }";
        const newMiss = "            else { if (typeof vfxMiss === 'function') vfxMiss(t); logCombat(`<span class=\"text-sky-300 font-bold\">【協力·${ally._allyName}】</span>的攻擊未命中。`, 'miss'); allyWeaponProcs(ally, t, { hit: false, dmg: 0 }); if (wpn && Math.random() * 100 < (ally._forceComboRate != null ? ally._forceComboRate : comboTriggerChance(ally, wpn, ally.eq && ally.eq.wpn))) allyComboAttack(ally, t, true); return; }";
        next = ctx.replaceOnce('js/06-status-allies.js', next, oldMiss, newMiss, '傭兵未命中麗人／暗影改制');
        next = ctx.replaceOnce(
          'js/06-status-allies.js',
          next,
          '        if (ally._setBeauty5 && ally._beautyMissStack) ally._beautyMissStack = 0;   // 🔮 v2.6.21 麗人5/5：命中（含擦傷/粉碎）→堆疊歸零（鏡像玩家 787）\n',
          '',
          '傭兵麗人命中歸零移除'
        );
        next = ctx.replaceOnce(
          'js/06-status-allies.js',
          next,
          '        t.curHp -= dmg; t.justHit = getWpnEle(ally.eq ? ally.eq.wpn : null, wpn, ally); mobWake(t);',
          '        t.curHp -= dmg; t.justHit = getWpnEle(ally.eq ? ally.eq.wpn : null, wpn, ally); if (typeof moonShatterOnDamage === \'function\') moonShatterOnDamage(ally, t, dmg); mobWake(t);',
          '傭兵物理普攻碎裂'
        );
        next = ctx.replaceOnce(
          'js/06-status-allies.js',
          next,
          '        allyWeaponProcs(ally, t, { hit: true, dmg: dmg });            // 🔧 普攻判定特效：瑪那回魔/共鳴/魔擊/月光爆裂',
          '        if (t.curHp > 0 && ally._setIron5 && typeof ironGuardTaunt === \'function\' && ironGuardTaunt(t, ally)) logCombat(`<span class="font-bold" style="color:#93c5fd;text-shadow:0 0 6px #3b82f6;">【協力·${ally._allyName}·鐵衛 5/5】</span>嘲諷 <span class="${getMobColor(t.lv)}">${t.n}</span>！（3 秒）`, \'player-special\');\n' +
          '        allyWeaponProcs(ally, t, { hit: true, dmg: dmg });            // 🔧 普攻判定特效：瑪那回魔/共鳴/魔擊/月光爆裂',
          '傭兵物理普攻鐵衛嘲諷'
        );
        return ctx.replaceOnce(
          'js/06-status-allies.js',
          next,
          "        if (wpn && Math.random() * 100 < (ally._forceComboRate != null ? ally._forceComboRate : (wpn.eff === 'combo' ? (wpn.comboRate || 0) : 0))) allyComboAttack(ally, t, true);     // 雙擊：命中後依 comboRate% 追加一次完整一般攻擊",
          '        if (wpn && Math.random() * 100 < (ally._forceComboRate != null ? ally._forceComboRate : comboTriggerChance(ally, wpn, ally.eq && ally.eq.wpn))) allyComboAttack(ally, t, true);     // 雙擊：命中後依武器／套裝機率追加一次完整一般攻擊',
          '傭兵命中暗影雙擊'
        );
      });
      source = ctx.patchNamedFunction('js/06-status-allies.js', source, 'allyCastMagic', block => {
        let next = ctx.replaceOnce(
          'js/06-status-allies.js',
          block,
          '        t.curHp -= totalDmg;',
          '        t.curHp -= totalDmg;\n' +
          '        if (typeof moonShatterOnDamage === \'function\') moonShatterOnDamage(ally, t, totalDmg);',
          '傭兵傷害魔法碎裂'
        );
        return ctx.replaceOnce(
          'js/06-status-allies.js',
          next,
          "                        m.curHp -= _d; if (typeof terrorVisageOnDamage === 'function') terrorVisageOnDamage(m, _d, 'magic'); m.justHit = 'magic'; mobWake(m);",
          "                        m.curHp -= _d; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(ally, m, _d); if (typeof terrorVisageOnDamage === 'function') terrorVisageOnDamage(m, _d, 'magic'); m.justHit = 'magic'; mobWake(m);",
          '傭兵魔爆碎裂'
        );
      });
      source = ctx.patchNamedFunction('js/06-status-allies.js', source, 'allyStrikeRoll', block => {
        let next = ctx.replaceOnce(
          'js/06-status-allies.js',
          block,
          '    let hitB = (isRanged ? (d.rangedHit||0) : (d.meleeHit||0)) + (d.extraHit||0) + (ally._setBeauty5 ? (ally._beautyMissStack || 0) : 0);   // 🔮 v2.6.21 麗人5/5：未命中堆疊命中（鏡像玩家 js/03:763）',
          '    let hitB = (isRanged ? (d.rangedHit||0) : (d.meleeHit||0)) + (d.extraHit||0);',
          '傭兵物理樞紐麗人移除'
        );
        const oldBeauty = [
          '    // 🔎 v3.5.90 opts.probe＝純探測（穿透波及的命中判定）：不寫 _beautyMissStack——鏡像玩家 js/03 getPhysicalDmg 第 11 參 probe。',
          '    //    未加閘時：探測未命中→傭兵白賺 +10 命中堆疊；探測命中→把辛苦累積的堆疊清成 0（該次並不造成獨立傷害）。穿透精通全體波及時每隻怪各污染一次。',
          '    if (!hit) { if (ally._setBeauty5 && !opts.probe) ally._beautyMissStack = (ally._beautyMissStack || 0) + 10; return { hit: false, dmg: 0, heavy: false, crit: false }; }   // 🔮 v2.6.21 麗人5/5：未命中→命中堆疊+10（鏡像玩家 786）',
          '    if (ally._setBeauty5 && ally._beautyMissStack && !opts.probe) ally._beautyMissStack = 0;   // 🔮 v2.6.21 麗人5/5：命中（含forceHit/擦傷/粉碎）→堆疊歸零（鏡像玩家 787）',
        ].join('\n');
        return ctx.replaceOnce(
          'js/06-status-allies.js',
          next,
          oldBeauty,
          '    if (!hit) return { hit: false, dmg: 0, heavy: false, crit: false };',
          '傭兵物理樞紐麗人堆疊移除'
        );
      });
      source = removeNamedFunction('js/06-status-allies.js', source, 'allyIronGuardSweep');
      source = ctx.replaceOnce(
        'js/06-status-allies.js',
        source,
        '// 🔮 鐵衛 5/5（傭兵）：觸發反擊/居合時，額外對全體敵人各做一次一般攻擊（各自正常命中判定）' + nl,
        '',
        '傭兵舊鐵衛說明移除'
      );
      source = ctx.replaceOnce(
        'js/06-status-allies.js',
        source,
        "        allyIronGuardSweep(ally, '反擊');   // 🔮 鐵衛 5/5（傭兵）" + nl,
        '',
        '傭兵反擊舊鐵衛橫掃移除'
      );
      source = ctx.replaceOnce(
        'js/06-status-allies.js',
        source,
        "        allyIronGuardSweep(ally, '居合');   // 🔮 鐵衛 5/5（傭兵）" + nl,
        '',
        '傭兵居合舊鐵衛橫掃移除'
      );
      source = ctx.patchNamedFunction('js/06-status-allies.js', source, 'allyWarriorAct', block =>
        ctx.replaceOnce(
          'js/06-status-allies.js',
          block,
          "m.curHp -= dmg; m.justHit = 'magic'; mobWake(m);",
          "m.curHp -= dmg; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(ally, m, dmg); m.justHit = 'magic'; mobWake(m);",
          '傭兵咆哮碎裂'
        )
      );
      const oneLineHooks = [
        ['allyStormTick', "        t.curHp -= dmg; t.justHit = (sk.ele && sk.ele !== 'none') ? sk.ele : 'magic'; mobWake(t);", "        t.curHp -= dmg; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(ally, t, dmg); t.justHit = (sk.ele && sk.ele !== 'none') ? sk.ele : 'magic'; mobWake(t);"],
        ['allyCastCrush', '    t.curHp -= dmg; t.justHit = getWpnEle(ally.eq ? ally.eq.wpn : null, wpn, ally); mobWake(t);', "    t.curHp -= dmg; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(ally, t, dmg); t.justHit = getWpnEle(ally.eq ? ally.eq.wpn : null, wpn, ally); mobWake(t);"],
        ['allyCastSlaughter', '        t.curHp -= dmg; t.justHit = getWpnEle(ally.eq ? ally.eq.wpn : null, wpn, ally); total += dmg; mobWake(t);', "        t.curHp -= dmg; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(ally, t, dmg); t.justHit = getWpnEle(ally.eq ? ally.eq.wpn : null, wpn, ally); total += dmg; mobWake(t);"],
        ['allyCastMpDmg', "    t.curHp -= dmg; t.justHit = 'magic'; mobWake(t);", "    t.curHp -= dmg; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(ally, t, dmg); t.justHit = 'magic'; mobWake(t);"],
      ];
      for (const [name, anchor, replacement] of oneLineHooks) {
        source = ctx.patchNamedFunction('js/06-status-allies.js', source, name, block =>
          ctx.replaceOnce('js/06-status-allies.js', block, anchor, replacement, `${name} 碎裂`)
        );
      }
      return source;
    }
  );

  patchFile(
    ctx,
    'js/07-skills-cast.js',
    [
      'moonShatterOnDamage(player, t, d);',
      'moonShatterOnDamage(player, m, d);',
      'moonShatterOnDamage(player, _t, dmg);',
      'moonShatterOnDamage(player, ht, dmg);',
      'moonShatterOnDamage(player, t, res.dmg);',
      'moonShatterOnDamage(player, t, totalDmg);',
      'moonShatterOnDamage(player, m, _d);',
    ],
    '玩家技能月光碎裂掛點',
    source => {
      source = ctx.patchNamedFunction('js/07-skills-cast.js', source, 'cubeTick', block => {
        let next = ctx.replaceOnce(
          'js/07-skills-cast.js',
          block,
          "                t.curHp -= d; t.justHit = (c.ele && c.ele !== 'none') ? c.ele : 'magic'; mobWake(t);",
          "                t.curHp -= d; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, t, d); t.justHit = (c.ele && c.ele !== 'none') ? c.ele : 'magic'; mobWake(t);",
          '單體立方碎裂'
        );
        return ctx.replaceOnce(
          'js/07-skills-cast.js',
          next,
          "m.curHp -= d; m.justHit = (c.ele && c.ele !== 'none') ? c.ele : 'magic'; mobWake(m);",
          "m.curHp -= d; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, m, d); m.justHit = (c.ele && c.ele !== 'none') ? c.ele : 'magic'; mobWake(m);",
          '全體立方碎裂'
        );
      });
      source = ctx.patchNamedFunction('js/07-skills-cast.js', source, 'castSkillInner', block => {
        const replacements = [
          [
            '        _t.curHp -= dmg; _t.justHit = getWpnEle(player.eq.wpn, wpn); mobWake(_t);',
            "        _t.curHp -= dmg; _t.justHit = getWpnEle(player.eq.wpn, wpn); if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, _t, dmg); mobWake(_t);",
            '會心一擊碎裂',
          ],
          [
            '                ht.curHp -= dmg; ht.justHit = getWpnEle(player.eq.wpn, wpn); total += dmg; mobWake(ht);',
            "                ht.curHp -= dmg; ht.justHit = getWpnEle(player.eq.wpn, wpn); if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, ht, dmg); total += dmg; mobWake(ht);",
            '屠宰者碎裂',
          ],
          [
            "m.curHp -= dmg; m.justHit = 'magic'; m._spellHurt = true; mobWake(m);",
            "m.curHp -= dmg; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, m, dmg); m.justHit = 'magic'; m._spellHurt = true; mobWake(m);",
            '咆哮碎裂',
          ],
          [
            "            t.curHp -= dmg; t.justHit = sk.weaponDmg ? getWpnEle(player.eq.wpn, player.eq.wpn ? DB.items[player.eq.wpn.id] : null) : 'magic'; if (!sk.weaponDmg) t._spellHurt = true; mobWake(t);",
            "            t.curHp -= dmg; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, t, dmg); t.justHit = sk.weaponDmg ? getWpnEle(player.eq.wpn, player.eq.wpn ? DB.items[player.eq.wpn.id] : null) : 'magic'; if (!sk.weaponDmg) t._spellHurt = true; mobWake(t);",
            '特殊技能碎裂',
          ],
          [
            '                t.curHp -= res.dmg;',
            "                t.curHp -= res.dmg;\n                if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, t, res.dmg);",
            '物理技能碎裂',
          ],
          [
            '                    t.curHp -= totalDmg;',
            "                    t.curHp -= totalDmg;\n                    if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, t, totalDmg);",
            '傷害魔法碎裂',
          ],
          [
            '                    d = Math.max(1, Math.floor(d * rlFuryMult()));   // 🔮 紅獅5/5(×1.2)＋😡狂怒5/5：攻擊技能最終傷害',
            '                    d = Math.max(1, Math.floor(d * rlFuryMult()));   // 🔮 紅獅5/5(×1.1)＋😡狂怒5/5：攻擊技能最終傷害',
            '攻擊技能紅獅註解',
          ],
          [
            "_d = illusionMagicDmg(_d, true, i === 0); m.curHp -= _d; if (typeof terrorVisageOnDamage === 'function') terrorVisageOnDamage(m, _d, 'magic');",
            "_d = illusionMagicDmg(_d, true, i === 0); m.curHp -= _d; if (typeof moonShatterOnDamage === 'function') moonShatterOnDamage(player, m, _d); if (typeof terrorVisageOnDamage === 'function') terrorVisageOnDamage(m, _d, 'magic');",
            '魔爆碎裂',
          ],
        ];
        let next = block;
        const nl = block.includes('\r\n') ? '\r\n' : '\n';
        for (const [rawAnchor, rawReplacement, label] of replacements) {
          const anchor = rawAnchor.replace(/\n/g, nl);
          const replacement = rawReplacement.replace(/\n/g, nl);
          next = ctx.replaceOnce('js/07-skills-cast.js', next, anchor, replacement, label);
        }
        return next;
      });
      return source;
    }
  );

  patchFile(
    ctx,
    'js/09-vfx-render.js',
    ["'fragile','shatter','armorbreak'"],
    '月光碎裂狀態顯示',
    source => {
      source = ctx.replaceOnce(
        'js/09-vfx-render.js',
        source,
        "'fragile','armorbreak'",
        "'fragile','shatter','armorbreak'",
        '碎裂狀態徽章'
      );
      return ctx.replaceOnce(
        'js/09-vfx-render.js',
        source,
        '// 🔮 含脆弱、🔧 破甲(黑妖破壞盔甲)',
        '// 🔮 含脆弱、碎裂、🔧 破甲(黑妖破壞盔甲)',
        '碎裂狀態徽章註解'
      );
    }
  );

  // Shines v3.8.26 新增飛翼雙刀時漏列 WEAPON_TAGS；若不補上，暗影 3/5 會把它視為無分類武器。
  patchFile(
    ctx,
    'js/10-ui-tabs.js',
    ["relic_wing_chaos_blades:['雙刀']"],
    '飛翼雙刀武器分類',
    source => {
      const nl = source.includes('\r\n') ? '\r\n' : '\n';
      return ctx.replaceOnce(
        'js/10-ui-tabs.js',
        source,
        "    relic_sr_kettle_maul:['雙手鈍器'], relic_sr_kama_blade:['單手劍','武士刀'], relic_sr_ushioni_horn:['矛']",
        "    relic_sr_kettle_maul:['雙手鈍器'], relic_sr_kama_blade:['單手劍','武士刀'], relic_sr_ushioni_horn:['矛']," + nl +
        "    relic_wing_chaos_blades:['雙刀']   // 🔌 修正 Shines v3.8.26 遺漏：暗影 3/5 應辨識此武器為雙刀",
        '飛翼雙刀標籤'
      );
    }
  );

  for (const [file, functionName, anchor] of [
    [
      'js/22-pets.js',
      'enemyAttackPet',
      '    dmg = Math.floor(Math.max(1, dmg) * (typeof teamDmgReduceMult === \'function\' ? teamDmgReduceMult(true) : 1) * petMasteryTakenMult() * petArmorDmgReduceMult(p));   // 👑 夥伴精通：受到傷害 −50%；🏺 寵物專用盔甲：受傷 ×(1−petDmgReduce)',
    ],
    [
      'js/23-summons.js',
      'enemyAttackSummon',
      '    dmg = Math.max(1, Math.floor(dmg * (typeof teamDmgReduceMult === \'function\' ? teamDmgReduceMult(true) : 1)));   // 🔮 化身對寵物／召喚物保留受傷減免；鋼鐵防護只作用於施法者自身 AC',
    ],
    [
      'js/31-castle-guards.js',
      'enemyAttackGuard',
      '    dmg = Math.max(1, Math.floor(dmg * (typeof teamDmgReduceMult === \'function\' ? teamDmgReduceMult(true) : 1)));',
    ],
  ]) {
    patchFile(
      ctx,
      file,
      ["ironGuardTauntWeakensAttack(mob)) dmg = Math.floor(dmg * 0.9);"],
      `${functionName} 鐵衛嘲諷減傷`,
      source => {
        const nl = source.includes('\r\n') ? '\r\n' : '\n';
        return ctx.patchNamedFunction(file, source, functionName, block =>
          ctx.replaceOnce(
            file,
            block,
            anchor,
            anchor + '\n' +
            "    if (typeof ironGuardTauntWeakensAttack === 'function' && ironGuardTauntWeakensAttack(mob)) dmg = Math.floor(dmg * 0.9);   // 🔮 鐵衛 5/5：受嘲諷目標的一般攻擊傷害 -10%",
            `${functionName} 鐵衛減傷`
          )
        );
      }
    );
  }

  patchFile(
    ctx,
    'js/32-threat.js',
    [
      'const IRON_GUARD_TAUNT_TICKS = 30;',
      'function ironGuardTaunt(m, ent) {',
      'function ironGuardTauntTarget(m) {',
      'function ironGuardTauntWeakensAttack(m) { return !!_ironGuardTauntState(m); }',
      'if (taunt && taunt.key === threatKey(ent)) return 1000000000;',
      'if (m._ironGuardTaunt) delete m._ironGuardTaunt;',
    ],
    '鐵衛嘲諷仇恨狀態',
    source => {
      const nl = source.includes('\r\n') ? '\r\n' : '\n';
      const anchor = '// ---------- 四、歸因（快照差分·per-mob） ----------';
      const block = [
        '// 鐵衛 5/5：一般攻擊命中後，目標鎖定攻擊者 3 秒；到期後回到正常仇恨選敵。',
        'const IRON_GUARD_TAUNT_TICKS = 30;',
        'function _ironGuardTauntState(m) {',
        '    let taunt = m && m._ironGuardTaunt;',
        '    if (!taunt) return null;',
        '    if ((taunt.until || 0) <= _threatNow()) { delete m._ironGuardTaunt; return null; }',
        '    return taunt;',
        '}',
        'function ironGuardTaunt(m, ent) {',
        '    if (!m || m._dead || (m.curHp || 0) <= 0 || !ent) return false;',
        '    let now = _threatNow(), key = threatKey(ent), old = _ironGuardTauntState(m);',
        '    let firstApply = !old || old.key !== key;',
        '    m._ironGuardTaunt = { key:key, until:now + IRON_GUARD_TAUNT_TICKS };',
        '    if (THREAT_ENABLED) {',
        '        if (!m._threat) { m._threat = Object.create(null); m._threatT = now; }',
        '        else _threatDecayMob(m, now);',
        '        let highest = 0;',
        '        for (let k in m._threat) highest = Math.max(highest, Number(m._threat[k]) || 0);',
        '        m._threat[key] = Math.max(Number(m._threat[key]) || 0, highest + THREAT_K);',
        '    }',
        '    return firstApply;',
        '}',
        'function ironGuardTauntTarget(m) {',
        '    let taunt = _ironGuardTauntState(m);',
        "    if (!taunt || typeof player === 'undefined' || !player) return null;",
        "    if (taunt.key === 'P') return !player.dead && (player.hp || 0) > 0 ? player : null;",
        '    return (player.allies || []).find(a => a && !a._downed && (a.curHp || 0) > 0 && threatKey(a) === taunt.key) || null;',
        '}',
        'function ironGuardTauntWeakensAttack(m) { return !!_ironGuardTauntState(m); }',
        '',
        anchor,
      ].join(nl);
      source = ctx.replaceOnce('js/32-threat.js', source, anchor, block, '鐵衛嘲諷狀態');
      source = ctx.replaceOnce(
        'js/32-threat.js',
        source,
        '    if (!THREAT_ENABLED || !(baseWeight > 0)) return baseWeight;' + nl +
        '    return baseWeight * THREAT_K + threatOf(m, threatKey(ent));',
        '    if (!THREAT_ENABLED || !(baseWeight > 0)) return baseWeight;' + nl +
        '    let taunt = _ironGuardTauntState(m);' + nl +
        '    if (taunt && taunt.key === threatKey(ent)) return 1000000000;   // 其他選敵管線也必定把嘲諷者視為最高仇恨' + nl +
        '    return baseWeight * THREAT_K + threatOf(m, threatKey(ent));',
        '鐵衛嘲諷權重'
      );
      return ctx.replaceOnce(
        'js/32-threat.js',
        source,
        '    for (let m of mapState.mobs) { if (m) { if (m._threat) delete m._threat; if (m._threatT != null) delete m._threatT; } }',
        '    for (let m of mapState.mobs) { if (m) { if (m._threat) delete m._threat; if (m._threatT != null) delete m._threatT; if (m._ironGuardTaunt) delete m._ironGuardTaunt; } }',
        '嘲諷存檔剝除'
      );
    }
  );
}
