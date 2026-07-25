import { existsSync, readFileSync } from 'node:fs';

const RELIC_ITEMS = [
  '        "relic_wing_chaos_blades":  { n: "飛翼的混沌雙刀",     type: "wpn", w2h: true, relic: true, noEnhance: true, eff: "combo", comboRate: 30, ignHardSkin: true, str: 2, dex: 1, dmgS: 16, dmgL: 11, hit: 15, dmgBonus: 16, darkCritMorph: "flywing_double", req: "dark", p: 10000, gachaWeight: 0, d: "【遺物】混沌司祭折翼後留下的雙刀，斬擊如殘翼同時掠過。雙擊 30；貫穿；力量 +2、敏捷 +1；裝備時會心一擊變為飛翼雙連：消耗 MP 12，立即進行兩次一般攻擊，兩次皆必定觸發雙擊。" },',
  '        "relic_corrosive_jelly_skin": { n: "腐蝕的果凍外皮",  type: "arm", slot: "gloves", relic: true, noEnhance: true, ac: 4, dr: 5, corrosiveJellySkin: true, req: "all", p: 10000, gachaWeight: 0, d: "【遺物】象牙塔果凍怪的腐蝕外皮仍在緩緩蠕動。傷害減免 +5；受到一般攻擊時，使攻擊者的一般攻擊力永久 -3，最多疊加 5 層，直到該目標死亡。" },',
  '        "relic_goat_demon_feet":    { n: "山羊惡魔的雙足",   type: "arm", slot: "boots", relic: true, noEnhance: true, ac: 11, str: 3, int: 3, moveSpeedPct: 33, mpR: 3, bossEncounterPct: 3, req: "knight,elf,dark,dragon", p: 10000, gachaWeight: 0, d: "【遺物】巴列斯踏碎地獄岩層的雙足，仍帶著炙熱蹄印。力量 +3、智力 +3、移動速度 +33%、MP 自然恢復量 +3；頭目遭遇機率變更為 3%。" },',
  '        "relic_succubus_queen_kiss": { n: "斯克巴女皇的魅惑之吻", type: "arm", slot: "shield", armguard: { stat: "none", base: 0, th: [0, 0, 0] }, relic: true, noEnhance: true, ac: 0, cha: 1, charmOnHit: true, req: "elf,mage", p: 10000, gachaWeight: 0, d: "【遺物】斯克巴女皇留下的吻痕，會在武器命中時低語。魅力 +1；迷魅術變為魅惑術：自身沒有迷魅怪物時，一般攻擊命中會自動嘗試迷魅目標；對頭目無效。" },',
  '        "relic_spider_queen_footprints": { n: "蜘蛛女王的足跡", type: "arm", slot: "boots", relic: true, noEnhance: true, ac: 8, immSlow: true, dr: 4, extraHit: 1, req: "all", p: 10000, gachaWeight: 0, d: "【遺物】傲慢的潔尼斯女王踏過的地面留下冰冷足跡。免疫緩速；傷害減免 +4；額外命中 +1。" },',
];

const RELIC_ICONS = [
  'assets/icons/weapons/飛翼的混沌雙刀.png',
  'assets/icons/armors/腐蝕的果凍外皮.png',
  'assets/icons/armors/山羊惡魔的雙足.png',
  'assets/icons/armors/斯克巴女皇的魅惑之吻.png',
  'assets/icons/armors/蜘蛛女王的足跡.png',
];

function insertAfterNamedFunction(file, source, name, insertion) {
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
      if (depth === 0) { close = index; break; }
    }
  }
  if (close < 0) throw new Error(`[${file}] ${name} 找不到函式結尾。`);
  const nl = source.includes('\r\n') ? '\r\n' : '\n';
  const body = insertion.replace(/\r\n/g, '\n').trim().replace(/\n/g, nl);
  return source.slice(0, close + 1) + nl + body + source.slice(close + 1);
}

function patchFile(ctx, file, contracts, label, transform) {
  let source = readFileSync(file, 'utf8');
  if (contracts.every(contract => source.includes(contract))) {
    ctx.markAlready();
    return;
  }
  if (contracts.some(contract => source.includes(contract))) {
    throw new Error(`[${file}] ${label} 只套用一部分，拒絕猜測合併。`);
  }
  source = transform(source);
  if (!contracts.every(contract => source.includes(contract))) {
    throw new Error(`[${file}] ${label} 套用後契約仍不完整。`);
  }
  ctx.writePatched(file, source, label);
}

export function patchRelicBatch25(ctx) {
  patchFile(ctx, 'js/00-data.js', RELIC_ITEMS, '五件遺物物品資料', source => {
    const anchor = '        "relic_necro_book":         { n: "死靈之書",';
    const pos = source.indexOf(anchor);
    if (pos < 0 || source.indexOf(anchor, pos + anchor.length) >= 0) {
      throw new Error('[js/00-data.js] 死靈之書物品錨點不存在或不唯一。');
    }
    const end = source.indexOf('\n', pos);
    if (end < 0) throw new Error('[js/00-data.js] 死靈之書物品行結尾不存在。');
    const nl = source.includes('\r\n') ? '\r\n' : '\n';
    return source.slice(0, end + 1) + RELIC_ITEMS.join(nl) + nl + source.slice(end + 1);
  });

  const dropContracts = [
    "['混沌的司祭(飛翼)','relic_wing_chaos_blades']",
    "['象牙塔果凍怪','relic_corrosive_jelly_skin']",
    "['巴列斯','relic_goat_demon_feet']",
    "['暗黑思克巴女皇','relic_succubus_queen_kiss']",
    "['傲慢的潔尼斯女王','relic_spider_queen_footprints']",
    '"飛翼的混沌雙刀":30',
    '"腐蝕的果凍外皮":10',
    '"山羊惡魔的雙足":10',
    '"斯克巴女皇的魅惑之吻":5',
    '"蜘蛛女王的足跡":15',
  ];
  patchFile(ctx, 'js/01-drops-config.js', dropContracts, '五件遺物掉落與重量', source => {
    const nl = source.includes('\r\n') ? '\r\n' : '\n';
    const block = [
      '// 🔌 Shines v3.8.26 選配回移：五件遺物（各 0.0001%）',
      "[['混沌的司祭(飛翼)','relic_wing_chaos_blades'],['象牙塔果凍怪','relic_corrosive_jelly_skin'],['巴列斯','relic_goat_demon_feet'],['暗黑思克巴女皇','relic_succubus_queen_kiss'],['傲慢的潔尼斯女王','relic_spider_queen_footprints']]",
      '    .forEach(r => (MOB_DROPS[r[0]] = MOB_DROPS[r[0]] || []).push([r[1], 0.0001]));',
      'Object.assign(ITEM_WEIGHTS, {"飛翼的混沌雙刀":30,"腐蝕的果凍外皮":10,"山羊惡魔的雙足":10,"斯克巴女皇的魅惑之吻":5,"蜘蛛女王的足跡":15});',
    ].join(nl);
    const anchor = 'Object.assign(ITEM_WEIGHTS, {"古代地龍鱗盔甲":250,';
    return ctx.replaceOnce('js/01-drops-config.js', source, anchor, block + nl + anchor, '五件遺物掉落');
  });

  const statsContracts = [
    'd.bossEncounterPct = 0; d.corrosiveJellySkin = false; d.charmOnHit = false;',
    'if(!_recomputingAlly && !p._allyName && ed.bossEncounterPct) d.bossEncounterPct = Math.max(d.bossEncounterPct, ed.bossEncounterPct);',
    'if(ed.corrosiveJellySkin) d.corrosiveJellySkin = true;',
    'if(ed.charmOnHit) d.charmOnHit = true;',
  ];
  patchFile(ctx, 'js/02-stats-recompute.js', statsContracts, '五件遺物能力重算', source => {
    const nl = source.includes('\r\n') ? '\r\n' : '\n';
    source = ctx.replaceOnce(
      'js/02-stats-recompute.js',
      source,
      '    d.moveSpeedPct = 0;  // 🏺 遺物 寄居蟹背殼：移動速度%（負=變慢→怪物重生變慢·js/03 重生延遲讀取·與加速buff相乘）',
      '    d.moveSpeedPct = 0;  // 🏺 遺物 寄居蟹背殼：移動速度%（負=變慢→怪物重生變慢·js/03 重生延遲讀取·與加速buff相乘）' + nl +
      '    d.bossEncounterPct = 0; d.corrosiveJellySkin = false; d.charmOnHit = false;   // 🏺 Shines v3.8.26 五件遺物',
      '五件遺物能力歸零'
    );
    return ctx.replaceOnce(
      'js/02-stats-recompute.js',
      source,
      '        if(!_recomputingAlly && !p._allyName && ed.moveSpeedPct) d.moveSpeedPct += ed.moveSpeedPct;   // 移速裝備只計主操作玩家；傭兵裝備不影響全隊接敵／補怪速度',
      '        if(!_recomputingAlly && !p._allyName && ed.moveSpeedPct) d.moveSpeedPct += ed.moveSpeedPct;   // 移速裝備只計主操作玩家；傭兵裝備不影響全隊接敵／補怪速度' + nl +
      '        if(!_recomputingAlly && !p._allyName && ed.bossEncounterPct) d.bossEncounterPct = Math.max(d.bossEncounterPct, ed.bossEncounterPct);   // 頭目遭遇率只計主操作玩家裝備' + nl +
      '        if(ed.corrosiveJellySkin) d.corrosiveJellySkin = true;' + nl +
      '        if(ed.charmOnHit) d.charmOnHit = true;',
      '五件遺物能力彙總'
    );
  });

  const bossContracts = [
    'let _normalBossChance = Math.max(0.01, Math.min(1, (((player && player.d && player.d.bossEncounterPct) || 1) / 100)));',
    'Math.random() < _normalBossChance',
  ];
  patchFile(ctx, 'js/03-combat-core.js', bossContracts, '山羊惡魔雙足頭目遭遇率', source => {
    const nl = source.includes('\r\n') ? '\r\n' : '\n';
    const anchor = "    let wantBoss = !npcClanBattle && !wcMassTauntBattle && (allowMultiBoss || !bossInBattle) && bossPool.length > 0 && (!_elderRoom || _elderBossOk) && (mapState.forceBoss || (siegeArea ? (!mapState.suppressSiegeBoss && Math.random() < 0.10) : (_elderRoom ? Math.random() < 0.05 : Math.random() < 0.01)));";
    const replacement =
      '    let _normalBossChance = Math.max(0.01, Math.min(1, (((player && player.d && player.d.bossEncounterPct) || 1) / 100)));' + nl +
      "    let wantBoss = !npcClanBattle && !wcMassTauntBattle && (allowMultiBoss || !bossInBattle) && bossPool.length > 0 && (!_elderRoom || _elderBossOk) && (mapState.forceBoss || (siegeArea ? (!mapState.suppressSiegeBoss && Math.random() < 0.10) : (_elderRoom ? Math.random() < 0.05 : Math.random() < _normalBossChance)));";
    return ctx.replaceOnce('js/03-combat-core.js', source, anchor, replacement, '一般地圖頭目遭遇率');
  });

  const attackContracts = [
    'function corrosiveJellySkinOnBasicHit(mob, defender) {',
    'function enemyPhysicalAttack(mob, idx, stunChance = 0, atkDmg = null, atkDb = null, isBasicAttack = false) {',
    'function enemyAttackAlly(mob, ally, isBasicAttack = false) {',
    "(isBasicAttack ? Math.max(0, Number(mob._corrosiveJellyAtkDown) || 0) : 0)",
    'if (isBasicAttack && totalDmg > 0) corrosiveJellySkinOnBasicHit(mob, player);',
    'if (isBasicAttack && totalDmg > 0) corrosiveJellySkinOnBasicHit(mob, ally);',
    "if (target.curHp > 0 && typeof relicCharmOnHit === 'function' && relicCharmOnHit(target)) return;",
    'player._forceComboRate != null',
  ];
  patchFile(ctx, 'js/04-combat-attack.js', attackContracts, '五件遺物一般攻擊掛點', source => {
    const nl = source.includes('\r\n') ? '\r\n' : '\n';
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      'function enemyPhysicalAttack(mob, idx, stunChance = 0, atkDmg = null, atkDb = null) {',
      'function enemyPhysicalAttack(mob, idx, stunChance = 0, atkDmg = null, atkDb = null, isBasicAttack = false) {',
      '玩家受擊一般攻擊旗標'
    );
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      '    try { return _enemyPhysicalAttackInner(mob, idx, stunChance, atkDmg, atkDb); }',
      '    try { return _enemyPhysicalAttackInner(mob, idx, stunChance, atkDmg, atkDb, isBasicAttack); }',
      '玩家受擊旗標傳遞'
    );
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      'function _enemyPhysicalAttackInner(mob, idx, stunChance = 0, atkDmg = null, atkDb = null) {',
      'function _enemyPhysicalAttackInner(mob, idx, stunChance = 0, atkDmg = null, atkDb = null, isBasicAttack = false) {',
      '玩家受擊內層旗標'
    );
    source = insertAfterNamedFunction('js/04-combat-attack.js', source, 'enemyPhysicalAttack', `
function corrosiveJellySkinOnBasicHit(mob, defender) {
    if (!mob || !defender || !defender.d || !defender.d.corrosiveJellySkin) return false;
    let before = Math.max(0, Number(mob._corrosiveJellyAtkDown) || 0);
    let after = Math.min(15, before + 3);
    if (after <= before) return false;
    mob._corrosiveJellyAtkDown = after;
    return true;
}`);
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      '        let dmgBonus = (atkDb != null ? atkDb : (mob.db || 0)) - (st.weaken > 0 ? 4 : 0)',
      '        let dmgBonus = (atkDb != null ? atkDb : (mob.db || 0)) - (isBasicAttack ? Math.max(0, Number(mob._corrosiveJellyAtkDown) || 0) : 0) - (st.weaken > 0 ? 4 : 0)',
      '玩家腐蝕減攻消費'
    );
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      '        player.hp -= totalDmg;',
      '        player.hp -= totalDmg;' + nl +
      '        if (isBasicAttack && totalDmg > 0) corrosiveJellySkinOnBasicHit(mob, player);',
      '玩家腐蝕受擊疊層'
    );
    source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'enemyAttackChooseVictim', block => {
      let next = block.replaceAll('enemyPhysicalAttack(mob, idx)', 'enemyPhysicalAttack(mob, idx, 0, null, null, true)');
      next = next.replaceAll('enemyAttackAlly(mob, a)', 'enemyAttackAlly(mob, a, true)');
      next = next.replaceAll('enemyAttackAlly(mob, allies[allies.length - 1])', 'enemyAttackAlly(mob, allies[allies.length - 1], true)');
      return next;
    });
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      'function enemyAttackAlly(mob, ally) {',
      'function enemyAttackAlly(mob, ally, isBasicAttack = false) {',
      '傭兵受擊一般攻擊旗標'
    );
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      '    try { return _enemyAttackAllyInner(mob, ally); }',
      '    try { return _enemyAttackAllyInner(mob, ally, isBasicAttack); }',
      '傭兵受擊旗標傳遞'
    );
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      'function _enemyAttackAllyInner(mob, ally) {',
      'function _enemyAttackAllyInner(mob, ally, isBasicAttack = false) {',
      '傭兵受擊內層旗標'
    );
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      '    let totalDmg = (heavy ? dc * ds : roll(dc, ds)) + ((mob.db || 0) - (st.weaken > 0 ? 4 : 0)',
      '    let totalDmg = (heavy ? dc * ds : roll(dc, ds)) + ((mob.db || 0) - (isBasicAttack ? Math.max(0, Number(mob._corrosiveJellyAtkDown) || 0) : 0) - (st.weaken > 0 ? 4 : 0)',
      '傭兵腐蝕減攻消費'
    );
    source = ctx.replaceOnce(
      'js/04-combat-attack.js',
      source,
      '    ally.curHp -= totalDmg;',
      '    ally.curHp -= totalDmg;' + nl +
      '    if (isBasicAttack && totalDmg > 0) corrosiveJellySkinOnBasicHit(mob, ally);',
      '傭兵腐蝕受擊疊層'
    );
    source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'playerAttack', block => {
      let next = ctx.replaceOnce(
        'js/04-combat-attack.js',
        block,
        '        if (target.curHp <= 0) killMob(mapState.targetIdx);',
        "        if (target.curHp > 0 && typeof relicCharmOnHit === 'function' && relicCharmOnHit(target)) return;" + '\n' +
        '        if (target.curHp <= 0) killMob(mapState.targetIdx);',
        '魅惑之吻命中掛點'
      );
      return ctx.replaceOnce(
        'js/04-combat-attack.js',
        next,
        "    if (wpn && wpn.eff === 'combo' && Math.random() * 100 < (wpn.comboRate || 0)) procCombo(target, true);",
        "    if (wpn && Math.random() * 100 < (player._forceComboRate != null ? player._forceComboRate : (wpn.eff === 'combo' ? (wpn.comboRate || 0) : 0))) procCombo(target, true);",
        '飛翼雙連強制雙擊'
      );
    });
    return source;
  });

  const skillContracts = [
    'function relicCharmOnHit(t) {',
    'function relicFlywingDouble(t) {',
    "if (_darkCritWpn && _darkCritWpn.darkCritMorph === 'flywing_double') return relicFlywingDouble(_t);",
    "if (player.d && player.d.charmOnHit) { logSys('裝備斯克巴女皇的魅惑之吻時，迷魅術會改為命中後自動施展。'); return; }",
  ];
  patchFile(ctx, 'js/07-skills-cast.js', skillContracts, '魅惑之吻與飛翼雙連技能', source => {
    source = insertAfterNamedFunction('js/07-skills-cast.js', source, 'rollDice', `
function relicCharmOnHit(t) {
    let p = player;
    if (!p || !p.d || !p.d.charmOnHit || p.charmed || !t || t.curHp <= 0 || t._dead || t.boss || t.noCharm) return false;
    if (!((hasMastery('m_summon') && (t.lv || 1) < p.lv) || abnormalMagicHit(t, 12))) return false;
    let idx = mapState.mobs.findIndex(m => m && m.uid === t.uid);
    if (idx === -1) return false;
    p.buffs = p.buffs || {};
    p.buffs.sk_charm = 3600;
    p.charmed = {
        skId:'sk_charm', n:'迷魅：' + t.n, dmgDice: t.dmg && t.dmg[1] ? t.dmg : [1,4],
        interval: Math.max(10, Math.floor((t.atkSpd || 2) * 10)), ele:'none', kind:'melee',
        hitBonus:(t.hit||0), proc:null, cd:10, endTick: state.ticks + 36000
    };
    logCombat(\`<span class="font-bold" style="color:#f0abfc;text-shadow:0 0 6px #d946ef;">【魅惑術】</span><span class="\${getMobColor(t.lv)}">\${t.n}</span> 成為你的僕人。\`, 'magic');
    if (typeof playSpellFx === 'function') { try { playSpellFx('迷魅術', t); } catch (e) {} }
    mapState.mobs[idx] = null;
    renderMobs();
    return true;
}
function relicFlywingDouble(t) {
    if (!t || t.curHp <= 0 || t._dead || (player.mp || 0) < 12) return false;
    player.mp -= 12;
    let prior = player._forceComboRate;
    player._forceComboRate = 100;
    let swings = 0;
    try {
        for (let i = 0; i < 2; i++) {
            if (!t || t._dead || t.curHp <= 0 || player.dead) break;
            playerAttack();
            swings++;
        }
    } finally {
        if (prior == null) delete player._forceComboRate; else player._forceComboRate = prior;
    }
    if (swings > 0) logCombat('<span class="font-bold" style="color:#c4b5fd;text-shadow:0 0 6px #8b5cf6;">【飛翼雙連】</span>殘翼交錯，連續斬出兩次一般攻擊！', 'player-special');
    player.cds.atkSk = getAutoCastInterval(player, false, player.cds.atkSk);
    calcStats(); updateUI();
    return swings > 0;
}`);
    source = ctx.patchNamedFunction('js/07-skills-cast.js', source, 'castSkillInner', block => {
      return ctx.replaceOnce(
        'js/07-skills-cast.js',
        block,
        '        if (player.cds.atkSk > 0) return false;   // ⚔️ v3.1.77 稽核中#11：比照其他攻擊技吃攻擊技冷卻（原分支位於冷卻閘之前＝唯一不受冷卻的 atk 技）',
        '        if (player.cds.atkSk > 0) return false;   // ⚔️ v3.1.77 稽核中#11：比照其他攻擊技吃攻擊技冷卻（原分支位於冷卻閘之前＝唯一不受冷卻的 atk 技）' + '\n' +
        '        let _darkCritWpn = player.eq.wpn ? DB.items[player.eq.wpn.id] : null;' + '\n' +
        "        if (_darkCritWpn && _darkCritWpn.darkCritMorph === 'flywing_double') return relicFlywingDouble(_t);",
        '飛翼雙連取代會心一擊'
      );
    });
    source = ctx.patchNamedFunction('js/07-skills-cast.js', source, 'manualCast', block =>
      ctx.replaceOnce(
        'js/07-skills-cast.js',
        block,
        "    } else if(sk.mEff === 'charm') {" + '\n' +
        "        if(!t) { logSys('沒有目標。'); return; }",
        "    } else if(sk.mEff === 'charm') {" + '\n' +
        "        if (player.d && player.d.charmOnHit) { logSys('裝備斯克巴女皇的魅惑之吻時，迷魅術會改為命中後自動施展。'); return; }" + '\n' +
        "        if(!t) { logSys('沒有目標。'); return; }",
        '魅惑之吻取代手動迷魅'
      ));
    return source;
  });

  const allyContracts = [
    'ally._forceComboRate != null',
    "let _wingDouble = !!(_dcWpn && _dcWpn.darkCritMorph === 'flywing_double');",
    'function allyFlywingDouble(ally, t) {',
    "if (wpn && wpn.darkCritMorph === 'flywing_double') return allyFlywingDouble(ally, t);",
  ];
  patchFile(ctx, 'js/06-status-allies.js', allyContracts, '飛翼雙連傭兵鏡像', source => {
    source = source.replaceAll(
      "wpn && wpn.eff === 'combo' && Math.random() * 100 < (wpn.comboRate || 0)",
      "wpn && Math.random() * 100 < (ally._forceComboRate != null ? ally._forceComboRate : (wpn.eff === 'combo' ? (wpn.comboRate || 0) : 0))"
    );
    source = ctx.patchNamedFunction('js/06-status-allies.js', source, 'allyDarkAct', block =>
      ctx.replaceOnce(
        'js/06-status-allies.js',
        block,
        "        if ((ally.mmp || 0) > 0 && (ally.mp || 0) >= (ally.mmp || 0)) { allyDarkCrit(ally, t); return true; }",
        "        let _dcWpn = (ally.eq && ally.eq.wpn) ? DB.items[ally.eq.wpn.id] : null;" + '\n' +
        "        let _wingDouble = !!(_dcWpn && _dcWpn.darkCritMorph === 'flywing_double');" + '\n' +
        "        if ((_wingDouble && (ally.mp || 0) >= 12) || (!_wingDouble && (ally.mmp || 0) > 0 && (ally.mp || 0) >= (ally.mmp || 0))) return allyDarkCrit(ally, t) !== false;",
        '飛翼傭兵施法條件'
      ));
    source = insertAfterNamedFunction('js/06-status-allies.js', source, 'allyCastMpDmg', `
function allyFlywingDouble(ally, t) {
    if (!ally || !t || t.curHp <= 0 || ally._downed || (ally.mp || 0) < 12) return false;
    ally.mp -= 12;
    let prior = ally._forceComboRate;
    ally._forceComboRate = 100;
    let swings = 0;
    try {
        for (let i = 0; i < 2; i++) {
            if (ally._downed || !t || t._dead || t.curHp <= 0) break;
            allyAttackOnce(ally);
            swings++;
        }
    } finally {
        if (prior == null) delete ally._forceComboRate; else ally._forceComboRate = prior;
    }
    if (swings > 0) logCombat(\`<span class="font-bold" style="color:#c4b5fd;text-shadow:0 0 6px #8b5cf6;">【協力·\${ally._allyName}·飛翼雙連】</span>揮出兩道殘翼般的斬擊！\`, 'player-special');
    return swings > 0;
}`);
    source = ctx.patchNamedFunction('js/06-status-allies.js', source, 'allyDarkCrit', block =>
      ctx.replaceOnce(
        'js/06-status-allies.js',
        block,
        "    let wpn = (ally.eq && ally.eq.wpn) ? DB.items[ally.eq.wpn.id] : null;",
        "    let wpn = (ally.eq && ally.eq.wpn) ? DB.items[ally.eq.wpn.id] : null;" + '\n' +
        "    if (wpn && wpn.darkCritMorph === 'flywing_double') return allyFlywingDouble(ally, t);",
        '飛翼傭兵技能分流'
      ));
    return source;
  });

  for (const icon of RELIC_ICONS) {
    if (!existsSync(icon)) {
      throw new Error(`[${icon}] 缺少核准的 Shines 圖示；請從固定來源提交資產後再執行。`);
    }
    ctx.markAlready();
  }
}
