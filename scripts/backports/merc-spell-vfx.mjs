import { readFileSync } from 'node:fs';

export function patchMercSpellVfx(ctx) {
  const vfxFile = 'js/09-vfx-render.js';
  let vfx = readFileSync(vfxFile, 'utf8');
  const vfxContracts = [
    'function playSpellFx(skn, mob, caster) {',
    "let _casterKey = caster && caster !== player ? ('ally:' + String(caster._slot || caster.enSeed || 'unknown')) : 'player';",
    "let fxKey = skn + '|' + mob.uid + '|' + _casterKey;",
    "let _pr0 = (caster && typeof _partyMemberRect === 'function') ? _partyMemberRect(caster) : ((typeof _pmCasterRect === 'function') ? _pmCasterRect() : null);",
    "let pr = (caster && typeof _partyMemberRect === 'function') ? _partyMemberRect(caster) : ((typeof _pmCasterRect === 'function') ? _pmCasterRect() : null);",
  ];
  if (vfxContracts.every(contract => vfx.includes(contract))) {
    ctx.markAlready();
  } else {
    if (vfxContracts.some(contract => vfx.includes(contract))) {
      throw new Error(`[${vfxFile}] 傭兵法術特效施法者補丁只套用了一部分，拒絕猜測合併。`);
    }
    vfx = ctx.replaceOnce(vfxFile, vfx, 'function playSpellFx(skn, mob) {', 'function playSpellFx(skn, mob, caster) {', '法術特效施法者參數');
    vfx = ctx.replaceOnce(
      vfxFile,
      vfx,
      "        let fxKey = skn + '|' + mob.uid;",
      "        let _casterKey = caster && caster !== player ? ('ally:' + String(caster._slot || caster.enSeed || 'unknown')) : 'player';\n" +
        "        let fxKey = skn + '|' + mob.uid + '|' + _casterKey;",
      '法術特效按施法者去重'
    );
    vfx = ctx.replaceOnce(
      vfxFile,
      vfx,
      "            let _pr0 = (typeof _pmCasterRect === 'function') ? _pmCasterRect() : null;",
      "            let _pr0 = (caster && typeof _partyMemberRect === 'function') ? _partyMemberRect(caster) : ((typeof _pmCasterRect === 'function') ? _pmCasterRect() : null);",
      '方向型法術施法者座標'
    );
    vfx = ctx.replaceOnce(
      vfxFile,
      vfx,
      "            let pr = (typeof _pmCasterRect === 'function') ? _pmCasterRect() : null;   // 🧝 v3.0.49 玩家變身 sprite 顯示中→由 sprite 身上(胸口高度)發射",
      "            let pr = (caster && typeof _partyMemberRect === 'function') ? _partyMemberRect(caster) : ((typeof _pmCasterRect === 'function') ? _pmCasterRect() : null);   // 傭兵施法時由傭兵 sprite 發射；未傳施法者時維持玩家座標",
      '投射型法術施法者座標'
    );
    if (!vfxContracts.every(contract => vfx.includes(contract))) {
      throw new Error(`[${vfxFile}] 傭兵法術特效施法者補丁完成後契約仍不完整。`);
    }
    ctx.writePatched(vfxFile, vfx, '傭兵法術特效施法者座標');
  }

  const allyFile = 'js/06-status-allies.js';
  let ally = readFileSync(allyFile, 'utf8');
  const allyContracts = [
    "playSpellFx(sk.n, t, ally); } catch (e) {} }   // 🎬 傭兵傷害法術",
    'playSpellFx(sp.skn, t, ally);',
    "if (_ikOk && typeof playSpellFx === 'function') { try { playSpellFx(sk.n, t, ally); } catch (e) {} }",
    "playSpellFx(sp.skn || '冰裂術', t, ally);",
    "playSpellFx(_pd.skn || '熾焰地裂術', _dt, ally);",
  ];
  if (allyContracts.every(contract => ally.includes(contract))) {
    ctx.markAlready();
    return;
  }
  if (allyContracts.some(contract => ally.includes(contract))) {
    throw new Error(`[${allyFile}] 傭兵法術特效呼叫補丁只套用了一部分，拒絕猜測合併。`);
  }

  ally = ctx.patchNamedFunction(allyFile, ally, 'allyCastMagic', block => ctx.replaceOnce(
    allyFile,
    block,
    '        mobWake(t);\n' +
      "        if (typeof reflectWallOnDamage === 'function') reflectWallOnDamage(t, totalDmg, 'magic', ally);",
    '        mobWake(t);\n' +
      "        if (typeof playSpellFx === 'function') { try { playSpellFx(sk.n, t, ally); } catch (e) {} }   // 🎬 傭兵傷害法術：以傭兵 sprite 作為特效施法者\n" +
      "        if (typeof reflectWallOnDamage === 'function') reflectWallOnDamage(t, totalDmg, 'magic', ally);",
    '傭兵一般傷害法術動畫'
  ));
  const callPatches = [
    ['playSpellFx(sp.skn, t);', 'playSpellFx(sp.skn, t, ally);', '傭兵武器附魔動畫'],
    ['playSpellFx(sk.n, t);', 'playSpellFx(sk.n, t, ally);', '傭兵即死法術動畫'],
    ["playSpellFx(sp.skn || '冰裂術', t);", "playSpellFx(sp.skn || '冰裂術', t, ally);", '傭兵蕾雅魔杖動畫'],
    ["playSpellFx(_pd.skn || '熾焰地裂術', _dt);", "playSpellFx(_pd.skn || '熾焰地裂術', _dt, ally);", '傭兵雙屬性法術動畫'],
  ];
  for (const [before, after, label] of callPatches) {
    ally = ctx.replaceOnce(allyFile, ally, before, after, label);
  }
  if (!allyContracts.every(contract => ally.includes(contract))) {
    throw new Error(`[${allyFile}] 傭兵法術特效呼叫補丁完成後契約仍不完整。`);
  }
  ctx.writePatched(allyFile, ally, '傭兵法術動畫呼叫');
}
