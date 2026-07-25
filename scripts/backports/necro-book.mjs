import { existsSync, readFileSync, readdirSync } from 'node:fs';

const ITEM_LINE = '        "relic_necro_book":         { n: "死靈之書",           type: "arm", slot: "shield", armguard: { stat: "none", base: 0, th: [0, 0, 0] }, relic: true, noEnhance: true, ac: 0, necroBook: true, killTeamHealPct: 1, req: "mage", p: 10000, gachaWeight: 0, d: "【遺物】以亡者皮骨裝訂的禁書，書頁會在敵人倒下時自行翻動，喚回仍不願安息的骸骨。" },';

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
  source = transform(source);
  if (!contracts.every(contract => source.includes(contract))) {
    throw new Error(`[${file}] ${label} 套用後契約仍不完整。`);
  }
  ctx.writePatched(file, source, label);
}

export function patchNecromancyBook(ctx) {
  patchFile(ctx, 'js/00-data.js', [ITEM_LINE], '死靈之書物品資料', source => {
    if (source.includes('"relic_necro_book"')) {
      throw new Error('[js/00-data.js] 已存在 relic_necro_book，但定義與核准版本不同。');
    }
    const anchor = '        "relic_sky_god_avatar":     { n: "天空之神的化身",';
    const pos = source.indexOf(anchor);
    if (pos < 0 || source.indexOf(anchor, pos + anchor.length) >= 0) {
      throw new Error('[js/00-data.js] 天空之神物品錨點不存在或不唯一。');
    }
    const end = source.indexOf('\n', pos);
    if (end < 0) throw new Error('[js/00-data.js] 天空之神物品行結尾不存在。');
    return source.slice(0, end + 1) + ITEM_LINE + (source.includes('\r\n') ? '\r\n' : '\n') + source.slice(end + 1);
  });

  const necroDrop = "['死亡的司祭(思克巴)','relic_necro_book']";
  const necroWeight = '"死靈之書":10';
  patchFile(ctx, 'js/01-drops-config.js', [necroDrop, necroWeight], '死靈之書掉落與重量', source => {
    if (source.includes("'relic_necro_book'") || source.includes(necroWeight)) {
      throw new Error('[js/01-drops-config.js] 死靈之書掉落或重量只套用一部分。');
    }
    const block = [
      '// 🔌 Shines v3.8.27 選配回移：死靈之書（0.0001%）',
      "[['死亡的司祭(思克巴)','relic_necro_book']]",
      '    .forEach(r => (MOB_DROPS[r[0]] = MOB_DROPS[r[0]] || []).push([r[1], 0.0001]));',
      'Object.assign(ITEM_WEIGHTS, {"死靈之書":10});',
    ].join(source.includes('\r\n') ? '\r\n' : '\n');
    const anchor = 'Object.assign(ITEM_WEIGHTS, {"古代地龍鱗盔甲":250,';
    return ctx.replaceOnce('js/01-drops-config.js', source, anchor, block + (source.includes('\r\n') ? '\r\n' : '\n') + anchor, '死靈之書掉落');
  });

  const runtime = readFileSync('scripts/backports/necro-summons-runtime.txt', 'utf8');
  const summonContracts = [
    'const NECRO_SKELETON_TIERS = [',
    'function necroBookOnKill(mob) {',
    'function necroSkeletonTick() {',
    'function _sumDeriveAny(s, owner) {',
    'if (s && s._necroSkeleton) return _necroSkeletonDerive(s, owner);',
    'return summonV2List().concat(necroSkeletonList()).filter(',
    '    necroSkeletonTick();',
    "&& !(skId === 'sk_zombie' && necroBookPassiveEnabled(player))",
    "+ '#N:' + necro.map(",
    "let title = regular.length ? (SUMMON_V2_TITLES[skId] || '召喚物') : '骷髏隨從';",
  ];
  patchFile(ctx, 'js/23-summons.js', summonContracts, '死靈之書召喚核心', source => {
    if (summonContracts.some(contract => source.includes(contract))) {
      throw new Error('[js/23-summons.js] 死靈之書召喚核心只套用一部分，拒絕猜測合併。');
    }
    source = insertAfterNamedFunction('js/23-summons.js', source, '_zmbDerive', runtime);
    source = ctx.patchNamedFunction('js/23-summons.js', source, '_sumDeriveAny', block => {
      let next = ctx.replaceOnce('js/23-summons.js', block, 'function _sumDeriveAny(s) {', 'function _sumDeriveAny(s, owner) {', '召喚衍生函式 owner');
      next = ctx.replaceOnce('js/23-summons.js', next, "    if (s.skId === 'sk_zombie') return _zmbDerive(s);", "    if (s && s._necroSkeleton) return _necroSkeletonDerive(s, owner);\n    if (s.skId === 'sk_zombie') return _zmbDerive(s, owner);", '骷髏衍生分流');
      return ctx.replaceOnce('js/23-summons.js', next, '    return _sumDerive(s);', '    return _sumDerive(s, owner);', '一般召喚 owner');
    });
    source = ctx.patchNamedFunction('js/23-summons.js', source, 'summonRenderList', block =>
      ctx.replaceOnce('js/23-summons.js', block, 'return summonV2List().filter(', 'return summonV2List().concat(necroSkeletonList()).filter(', '骷髏渲染清單'));
    source = ctx.patchNamedFunction('js/23-summons.js', source, 'summonV2Tick', block => {
      let next = ctx.replaceOnce('js/23-summons.js', block,
        "    if (typeof player === 'undefined' || !player || !player.cls) return;\n    const skId = summonV2ActiveSk();\n    const list = player.summonsV2 || [];",
        "    if (typeof player === 'undefined' || !player || !player.cls) return;\n    necroSkeletonTick();\n    const skId = summonV2ActiveSk();\n    let list = player.summonsV2 || [];\n    // 死靈之書使造屍術改為擊殺觸發的骷髏復生：清掉換裝前殘留的人形殭屍，且不走耗 MP 自動重施。\n    if (necroBookPassiveEnabled(player) && list.some(s => s && s.skId === 'sk_zombie')) {\n        player.summonsV2 = [];\n        player._summonV2On = false;\n        player.buffs.sk_zombie = 0;\n        list = player.summonsV2;\n        renderSummonPanel(true);\n    }",
        '骷髏 tick 與舊殭屍清理');
      return ctx.replaceOnce('js/23-summons.js', next,
        '    if (player._summonV2On && !alive.length && summonV2Knows(skId)',
        "    if (player._summonV2On && !alive.length && summonV2Knows(skId) && !(skId === 'sk_zombie' && necroBookPassiveEnabled(player))",
        '死靈之書禁止耗 MP 重施');
    });
    source = ctx.patchNamedFunction('js/23-summons.js', source, 'summonTeamSignature', block => {
      let next = ctx.replaceOnce('js/23-summons.js', block,
        '        const list = summonV2List().filter(s => s && !s._downed && (s.hp || 0) > 0);',
        '        const list = summonV2List().filter(s => s && !s._downed && (s.hp || 0) > 0);\n        const necro = necroSkeletonList().filter(s => s && !s._downed && (s.hp || 0) > 0);',
        '骷髏隊伍簽章清單');
      return ctx.replaceOnce('js/23-summons.js', next,
        "            + '#M:' +",
        "            + '#N:' + necro.map(s => [s.uid, s._necroOwnerKey, s.lv || 1, Math.round((s.hp || 0) / Math.max(1, s.mhp || 1) * 20)].join(':')).join('|')\n            + '#M:' +",
        '骷髏隊伍簽章內容');
    });
    source = ctx.patchNamedFunction('js/23-summons.js', source, 'renderSummonTeamHTML', block => {
      let next = ctx.replaceOnce('js/23-summons.js', block,
        '        const list = summonV2List().filter(s => s && !s._downed && (s.hp || 0) > 0);',
        '        const regular = summonV2List().filter(s => s && !s._downed && (s.hp || 0) > 0);\n        const necro = necroSkeletonList().filter(s => s && !s._downed && (s.hp || 0) > 0);\n        const list = regular.concat(necro);',
        '骷髏隊伍面板清單');
      next = ctx.replaceOnce('js/23-summons.js', next,
        '            const hpPct = Math.max(0, Math.min(100, Math.floor((s.hp || 0) / Math.max(1, s.mhp || 1) * 100)));',
        "            const hpPct = Math.max(0, Math.min(100, Math.floor((s.hp || 0) / Math.max(1, s.mhp || 1) * 100)));\n            let owner = s._necroSkeleton ? _necroOwnerByKey(s._necroOwnerKey) : null;\n            let label = s._necroSkeleton && owner && owner !== player ? `${owner._allyName}·${s.form}` : s.form;",
        '骷髏隊伍擁有者標籤');
      next = ctx.replaceOnce('js/23-summons.js', next,
        '<span class="text-purple-300 font-bold shrink-0 overflow-hidden text-ellipsis whitespace-nowrap" style="width:5.5rem;">${s.form}</span>',
        '<span class="text-purple-300 font-bold shrink-0 overflow-hidden text-ellipsis whitespace-nowrap" style="width:7rem;" title="${label} Lv.${s.lv || 1}">${label}</span>',
        '骷髏隊伍名稱欄');
      next = ctx.replaceOnce('js/23-summons.js', next,
        "        }).join('');\n        return `<div",
        "        }).join('');\n        let title = regular.length ? (SUMMON_V2_TITLES[skId] || '召喚物') : '骷髏隨從';\n        return `<div",
        '骷髏隊伍標題');
      next = ctx.replaceOnce('js/23-summons.js', next,
        "${SUMMON_V2_TITLES[skId] || '召喚物'}${list.length ? `（${list.length}）` : ''}",
        "${title}${list.length ? `（${list.length}）` : ''}",
        '骷髏隊伍標題文字');
      return ctx.replaceOnce('js/23-summons.js', next,
        '<button onclick="summonV2Recast()" class="btn w-full text-xs font-bold" style="padding:3px 0;background:linear-gradient(135deg,#4c1d95,#6d28d9);border:1px solid #7c3aed;color:#ddd6fe;border-radius:4px;">重新施放</button>',
        '${regular.length ? \'<button onclick="summonV2Recast()" class="btn w-full text-xs font-bold" style="padding:3px 0;background:linear-gradient(135deg,#4c1d95,#6d28d9);border:1px solid #7c3aed;color:#ddd6fe;border-radius:4px;">重新施放</button>\' : \'\'}',
        '骷髏不顯示重新施放');
    });
    return source;
  });

  const attackContracts = [
    "if (typeof necroSkeletonList === 'function') sums = sums.concat(necroSkeletonList().filter(",
    "if (typeof necroDismissAll === 'function') necroDismissAll();",
    'else if (sums.length && typeof enemyAttackSummon',
    'else if (sumIn && sums.length && typeof applyMobMagicToSummon',
  ];
  patchFile(ctx, 'js/04-combat-attack.js', attackContracts, '死靈骷髏受擊與死亡清理', source => {
    source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'enemyAttackChooseVictim', block => {
      let next = block;
      if (!next.includes("necroSkeletonList")) {
        const line = next.split('\n').find(x => x.includes('let sums = (typeof summonV2List'));
        next = ctx.replaceOnce('js/04-combat-attack.js', next, line, line + "\n    if (typeof necroSkeletonList === 'function') sums = sums.concat(necroSkeletonList().filter(s => s && !s._downed && (s.hp || 0) > 0));   // 🏺 Shines v3.8.12 骷髏復生實體", '一般攻擊骷髏池');
      }
      if (!next.includes('else if (sums.length && typeof enemyAttackSummon')) {
        next = ctx.replaceOnce('js/04-combat-attack.js', next,
          "    else if (pets.length && typeof enemyAttackPet === 'function') enemyAttackPet(mob, pets[pets.length - 1]);",
          "    else if (pets.length && typeof enemyAttackPet === 'function') enemyAttackPet(mob, pets[pets.length - 1]);\n    else if (sums.length && typeof enemyAttackSummon === 'function') enemyAttackSummon(mob, sums[sums.length - 1]);",
          '一般攻擊召喚 fallback');
      }
      return next;
    });
    source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'killPlayer', block => {
      if (block.includes('necroDismissAll')) return block;
      const line = block.split('\n').find(x => x.includes('if (player.summonsV2 && player.summonsV2.length)'));
      return ctx.replaceOnce('js/04-combat-attack.js', block, line, line + "\n    if (typeof necroDismissAll === 'function') necroDismissAll();   // 🏺 Shines v3.8.12 骷髏復生實體同樣於玩家死亡時全數消散", '死亡清除骷髏');
    });
    source = ctx.patchNamedFunction('js/04-combat-attack.js', source, 'castMobMagic', block => {
      let next = block;
      if (!next.includes('necroSkeletonList')) {
        const line = next.split('\n').find(x => x.includes('let sums = (typeof summonV2List'));
        next = ctx.replaceOnce('js/04-combat-attack.js', next, line, line + "\n    if (typeof necroSkeletonList === 'function') sums = sums.concat(necroSkeletonList().filter(s => s && !s._downed && (s.hp || 0) > 0));   // 🏺 Shines v3.8.12 骷髏復生實體", '魔法攻擊骷髏池');
      }
      if (!next.includes('else if (sumIn && sums.length && typeof applyMobMagicToSummon')) {
        next = ctx.replaceOnce('js/04-combat-attack.js', next,
          "    else if (pets.length && typeof applyMobMagicToPet === 'function') applyMobMagicToPet(mob, sk, pets[pets.length - 1]);",
          "    else if (pets.length && typeof applyMobMagicToPet === 'function') applyMobMagicToPet(mob, sk, pets[pets.length - 1]);\n    else if (sumIn && sums.length && typeof applyMobMagicToSummon === 'function') applyMobMagicToSummon(mob, sk, sums[sums.length - 1]);",
          '魔法攻擊召喚 fallback');
      }
      return next;
    });
    return source;
  });

  patchFile(ctx, 'js/05-kill-progression.js', ["if (typeof necroBookOnKill === 'function') necroBookOnKill(mob);"], '死靈之書擊殺掛點', source =>
    ctx.patchNamedFunction('js/05-kill-progression.js', source, 'killMob', block =>
      ctx.replaceOnce('js/05-kill-progression.js', block,
        "    if (typeof pvpOnKillMob === 'function') pvpOnKillMob(mob);",
        "    if (typeof pvpOnKillMob === 'function') pvpOnKillMob(mob);\n    if (typeof necroBookOnKill === 'function') necroBookOnKill(mob);   // 🏺 Shines v3.8.12：全隊 1% 回復＋骷髏復生（建築由函式內排除）",
        '死靈擊殺掛點')));

  const allyContracts = [
    's && !s._noHeal && !s._downed',
    "necroBookEquipped(ally) && ally.summon && ally.summon.skId === 'sk_zombie'",
    "!(s === 'sk_zombie' && typeof necroBookEquipped === 'function' && necroBookEquipped(ally))",
  ];
  patchFile(ctx, 'js/06-status-allies.js', allyContracts, '死靈骷髏治療與傭兵召喚規則', source => {
    source = ctx.patchNamedFunction('js/06-status-allies.js', source, 'healBeneficiaries', block =>
      ctx.replaceOnce('js/06-status-allies.js', block, 's && !s._downed && (s.hp || 0) > 0', 's && !s._noHeal && !s._downed && (s.hp || 0) > 0', '骷髏禁止一般治療'));
    source = ctx.patchNamedFunction('js/06-status-allies.js', source, 'allyMaintainBuffs', block => {
      let next = ctx.replaceOnce('js/06-status-allies.js', block,
        '    if (!_block && ally.skills && ally.skills.length) {\n        let _live =',
        "    if (!_block && ally.skills && ally.skills.length) {\n        if (typeof necroBookEquipped === 'function' && necroBookEquipped(ally) && ally.summon && ally.summon.skId === 'sk_zombie') {\n            ally.summon = null;\n            ally.buffs.sk_zombie = 0;\n        }\n        let _live =",
        '傭兵清除舊殭屍');
      return ctx.replaceOnce('js/06-status-allies.js', next,
        "d && d.type === 'buff' && d.summon && _mercAutoOn(ally, s)",
        "d && d.type === 'buff' && d.summon && !(s === 'sk_zombie' && typeof necroBookEquipped === 'function' && necroBookEquipped(ally)) && _mercAutoOn(ally, s)",
        '傭兵死靈不耗 MP 召殭屍');
    });
    return source;
  });

  patchFile(ctx, 'js/07-skills-cast.js', ["sid === 'sk_zombie' && typeof necroBookEquipped"], '死靈之書禁止造屍耗魔', source =>
    ctx.patchNamedFunction('js/07-skills-cast.js', source, 'autoActions', block =>
      ctx.replaceOnce('js/07-skills-cast.js', block,
        "            if(sk.summon && typeof _petInWild === 'function'",
        "            if(sid === 'sk_zombie' && typeof necroBookEquipped === 'function' && necroBookEquipped(player)) return;   // 🏺 Shines v3.8.12：造屍術改為擊殺觸發的骷髏復生，不施法、不消耗 MP\n            if(sk.summon && typeof _petInWild === 'function'",
        '死靈自動施法閘')));

  const uiContracts = [
    "if (sid === 'sk_zombie' && typeof necroDismissOwner",
    "let skillDisplayName = (sid === 'sk_zombie'",
    "if (d.necroBook) out.push('骷髏復生",
    'if (d.killTeamHealPct) out.push(`亡者餽贈',
    "let name = (it.sid === 'sk_zombie'",
    '_summons = _summons.concat(necroSkeletonList()',
  ];
  patchFile(ctx, 'js/10-ui-tabs.js', uiContracts, '死靈之書技能與隊伍介面', source => {
    source = ctx.patchNamedFunction('js/10-ui-tabs.js', source, 'onSummonToggle', block =>
      ctx.replaceOnce('js/10-ui-tabs.js', block,
        "        if (typeof summonV2DismissAll === 'function'",
        "        if (sid === 'sk_zombie' && typeof necroDismissOwner === 'function') necroDismissOwner(player);\n        if (typeof summonV2DismissAll === 'function'",
        '取消骷髏復生'));
    source = ctx.patchNamedFunction('js/10-ui-tabs.js', source, 'renderSkillSelects', block => {
      let next = ctx.replaceOnce('js/10-ui-tabs.js', block,
        '        let sk = DB.skills[sid];',
        "        let sk = DB.skills[sid];\n        let skillDisplayName = (sid === 'sk_zombie' && player.eq && player.eq.shield && player.eq.shield.id === 'relic_necro_book') ? '骷髏復生' : sk.n;",
        '骷髏復生顯示名稱');
      next = next.replaceAll('>${sk.n}</option>', '>${skillDisplayName}</option>');
      return ctx.replaceOnce('js/10-ui-tabs.js', next, '>${sk.n}</span>${__sumSel}</label>', '>${skillDisplayName}</span>${__sumSel}</label>', '骷髏復生勾選名稱');
    });
    source = ctx.patchNamedFunction('js/10-ui-tabs.js', source, 'relicPurposeLabels', block =>
      ctx.replaceOnce('js/10-ui-tabs.js', block,
        "    if (d.wearerEle) out.push(`${eleName(d.wearerEle)}之化身（自身轉為${eleName(d.wearerEle)}屬性，承受傷害套用屬性剋制）`);",
        "    if (d.wearerEle) out.push(`${eleName(d.wearerEle)}之化身（自身轉為${eleName(d.wearerEle)}屬性，承受傷害套用屬性剋制）`);\n    if (d.necroBook) out.push('骷髏復生（造屍術改為不消耗MP；敵人被擊敗時自動召喚1隻骷髏，全隊場上最多6隻；已達上限時完全恢復HP最低的骷髏）');\n    if (d.killTeamHealPct) out.push(`亡者餽贈（擊殺敵人時，全體玩家、傭兵、召喚物、寵物與護衛恢復${d.killTeamHealPct}%最大HP）`);",
        '死靈遺物說明'));
    source = ctx.patchNamedFunction('js/10-ui-tabs.js', source, '_allyAutoBuffChips', block =>
      ctx.replaceOnce('js/10-ui-tabs.js', block,
        "        let on = (typeof _mercAutoOn === 'function') ? _mercAutoOn(a, it.sid) : false;\n        return `<label",
        "        let on = (typeof _mercAutoOn === 'function') ? _mercAutoOn(a, it.sid) : false;\n        let name = (it.sid === 'sk_zombie' && a.eq && a.eq.shield && a.eq.shield.id === 'relic_necro_book') ? '骷髏復生' : it.n;\n        return `<label",
        '傭兵骷髏復生名稱').replaceAll('${it.n}', '${name}'));
    source = ctx.patchNamedFunction('js/10-ui-tabs.js', source, 'renderSquadPanel', block => {
      const line = block.split('\n').find(x => x.includes('let _summons = (typeof summonV2List'));
      return ctx.replaceOnce('js/10-ui-tabs.js', block, line,
        line + "\n    if (typeof necroSkeletonList === 'function' && player && player.cls) _summons = _summons.concat(necroSkeletonList().filter(s => s && !s._downed && (s.hp || 0) > 0));",
        '隊伍面板骷髏清單');
    });
    return source;
  });

  const icon = 'assets/icons/armors/死靈之書.png';
  const anim = 'assets/anim/骷髏召喚物';
  if (!existsSync(icon) || !existsSync(anim)) {
    throw new Error('[assets] 死靈之書圖示或骷髏召喚物動畫缺失。');
  }
  const animFiles = readdirSync(anim, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length;
  if (animFiles !== 393) throw new Error(`[${anim}] 動畫資產應為 393 檔，實際 ${animFiles}。`);
  ctx.markAlready();
}
