import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

const [
  dataSource, configSource, statsSource, coreSource, attackSource, allySource, skillSource, vfxSource, threatSource,
  equipSource, worldSource, warehouseSource, saveSource, craftSource, petSource, wikiSource, manifestSource,
] = await Promise.all([
  readFile(join(ROOT, 'js/00-data.js'), 'utf8'),
  readFile(join(ROOT, 'js/01-drops-config.js'), 'utf8'),
  readFile(join(ROOT, 'js/02-stats-recompute.js'), 'utf8'),
  readFile(join(ROOT, 'js/03-combat-core.js'), 'utf8'),
  readFile(join(ROOT, 'js/04-combat-attack.js'), 'utf8'),
  readFile(join(ROOT, 'js/06-status-allies.js'), 'utf8'),
  readFile(join(ROOT, 'js/07-skills-cast.js'), 'utf8'),
  readFile(join(ROOT, 'js/09-vfx-render.js'), 'utf8'),
  readFile(join(ROOT, 'js/32-threat.js'), 'utf8'),
  readFile(join(ROOT, 'js/08-items-equip.js'), 'utf8'),
  readFile(join(ROOT, 'js/11-world-map.js'), 'utf8'),
  readFile(join(ROOT, 'js/12-npc-quests.js'), 'utf8'),
  readFile(join(ROOT, 'js/13-shop-save.js'), 'utf8'),
  readFile(join(ROOT, 'js/14-craft-pandora.js'), 'utf8'),
  readFile(join(ROOT, 'js/22-pets.js'), 'utf8'),
  readFile(join(ROOT, 'afk-wiki.js'), 'utf8'),
  readFile(join(ROOT, 'assets-manifest.json'), 'utf8'),
]);
assert.ok(statsSource.includes('ed.bossEncounterPct') && statsSource.includes('ed.corrosiveJellySkin') && statsSource.includes('ed.charmOnHit'), '五件遺物能力未接入 stats 重算');
assert.ok(coreSource.includes('Math.random() < _normalBossChance'), '山羊惡魔雙足未接入一般地圖頭目率');
assert.ok(attackSource.includes('enemyPhysicalAttack(mob, idx, 0, null, null, true)'), '怪物一般攻擊未標記 basic attack');
assert.equal((attackSource.match(/corrosiveJellySkinOnBasicHit\(mob, (?:player|ally)\)/g) || []).length, 2, '腐蝕果凍外皮須同時接入玩家與傭兵受擊');
assert.ok(attackSource.includes('player._forceComboRate != null'), '飛翼雙連未接入玩家強制雙擊');
assert.ok(allySource.includes('ally._forceComboRate != null') && allySource.includes('function allyFlywingDouble'), '飛翼雙連未完整接入傭兵');
assert.ok(skillSource.includes('function relicCharmOnHit') && skillSource.includes('function relicFlywingDouble'), '五件遺物技能函式缺失');
assert.ok(configSource.includes("5件：最終傷害+10%") && configSource.includes("受所有來源傷害+10%"), '紅獅／白鳥新版數值未就位');
assert.ok(statsSource.includes("spdMult *= (1 / 1.2)") && statsSource.includes("delete p._beautyMissStack"), '麗人近戰攻速或舊 runtime 清理未就位');
assert.ok(coreSource.includes('function comboTriggerChance(owner, wpn, wpnRef)') && !coreSource.includes('function ironGuardSweep('), '暗影雙擊或舊鐵衛橫掃移除不完整');
assert.ok(!attackSource.includes('player._setShadow3) { player.hp') && !attackSource.includes('player._setMoon5 && roll('), '暗影回血或月光魔法閃避舊規則仍殘留');
assert.ok(!allySource.includes('function allyIronGuardSweep(') && !allySource.includes('ally._beautyMissStack ='), '傭兵舊鐵衛／麗人規則仍殘留');
assert.equal((coreSource.match(/moonShatterOnDamage\(/g) || []).length, 1, '玩家核心月光碎裂掛點數量錯誤');
assert.equal((attackSource.match(/moonShatterOnDamage\(/g) || []).length, 5, '玩家戰鬥月光碎裂掛點數量錯誤');
assert.equal((allySource.match(/moonShatterOnDamage\(/g) || []).length, 10, '傭兵月光碎裂掛點數量錯誤');
assert.equal((skillSource.match(/moonShatterOnDamage\(/g) || []).length, 9, '玩家技能月光碎裂掛點數量錯誤');
assert.ok(vfxSource.includes("'fragile','shatter','armorbreak'"), '碎裂狀態未接入戰場顯示');
assert.ok(vfxSource.includes('function playSpellFx(skn, mob, caster)') && vfxSource.includes("'|' + _casterKey"), '法術特效未按施法者分流');
assert.ok(vfxSource.includes("_partyMemberRect(caster)") && vfxSource.includes("_pmCasterRect() : null"), '法術特效未保留傭兵／玩家座標退路');
assert.ok((allySource.match(/playSpellFx\(sk\.n, t, ally\)/g) || []).length === 2 &&
  allySource.includes('playSpellFx(sp.skn, t, ally)') &&
  allySource.includes("playSpellFx(sp.skn || '冰裂術', t, ally)") &&
  allySource.includes("playSpellFx(_pd.skn || '熾焰地裂術', _dt, ally)"), '傭兵施法路徑未完整傳入施法者');
assert.ok(threatSource.includes('const IRON_GUARD_TAUNT_TICKS = 30;') && threatSource.includes('return 1000000000;'), '鐵衛嘲諷狀態或仇恨鎖定未就位');
assert.ok(configSource.includes('function invAddOrStack(e)') && configSource.includes('let ex = _invStackFind(e, false);'), '背包統一堆疊入口未就位');
assert.ok(attackSource.includes('invAddOrStack({ id: id, uid: uid(), cnt: 1, en: en'), '血盟掉落未接入統一堆疊');
assert.ok(equipSource.includes('invAddOrStack({ id:resultId, uid:uid(), cnt:1, en:_tEn'), '靈魂之球產物未接入統一堆疊');
assert.ok(worldSource.includes('    invAddOrStack(snap);'), '阿卡塔贖回未接入統一堆疊');
assert.ok(warehouseSource.includes("function _whStackFind(arr, it){ return (!it.gw) ?"), '倉庫仍禁止同強化值物品堆疊');
assert.ok(!saveSource.includes('if ((it.en || 0) !== 0) { out.push(it); return; }') && saveSource.includes('不同來源不分堆'), '載入合併仍跳過強化品');
assert.equal((craftSource.match(/    invAddOrStack\(inst\);/g) || []).length, 2, '兩個客製製作入口未完整接入統一堆疊');
assert.equal((petSource.match(/invMergeBack\(_back\)/g) || []).length, 3, '寵物放生／換裝／卸裝退回堆疊掛點不完整');
assert.ok(petSource.includes('if (!invMergeBack(_pg)) player.inv.push(_pg);'), '舊寵物裝備遷移未接入退回堆疊');
assert.ok(wikiSource.includes('紅獅5件＝物理攻擊×1.1') &&
  wikiSource.includes("['碎裂', '怪防禦變差（AC −10）") &&
  wikiSource.includes('狂怒5件依失血最多 −15%'), '小百科戰鬥機制仍是舊套裝規則');
assert.ok(wikiSource.includes('麗人3件近戰+3%、疾風3件遠程+3%') &&
  wikiSource.includes('裝備近距離武器時攻擊速度 +20%') &&
  !wikiSource.includes('月光5件才連魔法/必中技能') &&
  !wikiSource.includes('狂怒 5/5 最多 −20%'), '小百科其他段落仍殘留舊套裝效果');
assert.ok(wikiSource.includes('裝備遺物<b>死靈之書</b>') && wikiSource.includes('骷髏復生'), '小百科缺少死靈之書說明');
assert.ok(wikiSource.includes('每名未倒地傭兵讓每件物品的掉落機率增加 <b>60%</b>') &&
  wikiSource.includes('×2.8') && wikiSource.includes('×5.2') &&
  !wikiSource.includes('帶滿 7 名傭兵＝<b>×8</b>'), '小百科傭兵獎勵政策被上游規則覆蓋');
assert.ok(existsSync(join(ROOT, 'assets/icons/items/無限火藥爆裂矢.png')), '無限火藥爆裂矢圖示檔缺失');
assert.ok(JSON.parse(manifestSource).some(row => row[0] === 'assets/icons/items/無限火藥爆裂矢.png'), '無限火藥爆裂矢未進資源清單');
assert.ok(dataSource.includes('img: "assets/icons/items/無限火藥爆裂矢.png"'), '無限火藥爆裂矢仍會被武器類型導向錯誤圖示路徑');

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(req.url.split('?')[0]);
    if (pathname === '/') pathname = '/index.html';
    const file = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();

const systemChrome = platform() === 'win32'
  ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
     'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)
  : null;
const browser = await chromium.launch(systemChrome ? { executablePath: systemChrome } : {});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto(`http://127.0.0.1:${address.port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const necro = await page.evaluate(() => {
    const bad = [];
    const expect = (condition, message) => { if (!condition) bad.push(message); };

    expect(DB.items.relic_necro_book && DB.items.relic_necro_book.necroBook === true, '死靈之書物品定義缺失');
    expect((MOB_DROPS['死亡的司祭(思克巴)'] || []).some(row => row[0] === 'relic_necro_book' && row[1] === 0.0001), '死靈之書掉落或機率錯誤');
    expect(ITEM_WEIGHTS['死靈之書'] === 10, '死靈之書重量錯誤');
    expect(typeof ANIM_MANIFEST === 'object' && ANIM_MANIFEST['assets/anim/骷髏召喚物'], '骷髏召喚物動畫未進 manifest');

    state.running = false;
    player.cls = 'mage';
    player.name = '死靈測試';
    player.lv = 80;
    player.dead = false;
    player.hp = 500;
    player.mhp = 1000;
    player.mp = 500;
    player.mmp = 500;
    player.eq = player.eq || {};
    player.eq.shield = { id: 'relic_necro_book', en: 0 };
    player.skills = ['sk_zombie'];
    player.grantedSkills = [];
    player.config = { autoBuffSkills: { sk_zombie: true } };
    player.buffs = Object.assign({}, player.buffs || {}, { sk_zombie: 0 });
    player.summonsV2 = [];
    player.allies = [];
    player.d = Object.assign({}, player.d || {}, { magicDmg: 0, cha: 8 });
    let checkbox = document.getElementById('auto-sk-sk_zombie');
    if (checkbox) checkbox.checked = true;

    necroDismissAll();
    const mob = { n: '死靈測試怪', race: '動物', lv: 1, curHp: 0 };
    const tiers = [
      [24, 20, 80], [31, 30, 160], [41, 40, 240],
      [51, 50, 320], [61, 60, 400], [71, 70, 480],
    ];
    tiers.forEach(([lv, wantLv, wantHp]) => {
      const tier = _necroTierForOwner({ lv });
      expect(tier && tier.lv === wantLv && tier.hp === wantHp, `骷髏 ${lv} 級階梯錯誤`);
    });

    for (let i = 0; i < 6; i++) necroBookOnKill(mob);
    let list = necroSkeletonList();
    expect(list.length === 6, `擊殺六隻後骷髏數應為 6，實際 ${list.length}`);
    expect(list.every(s => s._noHeal && s._necroSkeleton && s._necroOwnerKey === 'player'), '骷髏旗標或擁有者錯誤');
    expect(list.every(s => s.lv === 70 && s.mhp === 480), 'Lv80 玩家應召喚 Lv70/HP480 骷髏');
    const derived = _necroSkeletonDerive(list[0], player);
    expect(derived.flat > 0 && derived.dice > 0 && derived.aspd === 10 && derived.hit > 0, '骷髏戰鬥衍生值錯誤');

    list[0].hp = 1;
    const hpBefore = player.hp;
    necroBookOnKill(mob);
    expect(list.length === 6, '超過上限後不得生成第七隻骷髏');
    expect(list[0].hp === list[0].mhp, '達上限後未補滿最低 HP 骷髏');
    expect(player.hp === hpBefore + 10, `亡者餽贈應恢復主角最大 HP 1%，實際 ${player.hp - hpBefore}`);

    player.summonsV2 = [list[0]];
    expect(!healBeneficiaries().includes(list[0]), '骷髏不應接受一般治療或 HoT');
    player.summonsV2 = [];

    const mpBefore = player.mp;
    autoActions();
    expect(player.mp === mpBefore, '裝備死靈之書時自動造屍仍消耗 MP');

    let physicalVictim = null;
    const oldEnemyAttackSummon = enemyAttackSummon;
    const oldRandom = Math.random;
    try {
      enemyAttackSummon = (_mob, summon) => { physicalVictim = summon; };
      Math.random = () => 0.999999;
      enemyAttackChooseVictim({ n: '選敵測試', lv: 1, curHp: 10, dmg: [1, 1], hit: 1 }, 0);
    } finally {
      enemyAttackSummon = oldEnemyAttackSummon;
      Math.random = oldRandom;
    }
    expect(physicalVictim && physicalVictim._necroSkeleton, '怪物一般攻擊選敵池未包含骷髏');

    necroDismissAll();
    player.eq.shield = null;
    const ally = {
      _slot: '2', _allyName: '死靈傭兵', cls: 'mage', lv: 65,
      curHp: 600, mhp: 1000, mp: 300, mmp: 300, _downed: false,
      eq: { shield: { id: 'relic_necro_book', en: 0 } },
      skills: ['sk_zombie'], grantedSkills: [],
      config: { autoBuffSkills: { sk_zombie: true } },
      buffs: { sk_zombie: 0 }, d: { magicDmg: 0, cha: 8 },
    };
    player.allies = [ally];
    necroBookOnKill(mob);
    list = necroSkeletonList();
    expect(list.length === 1 && list[0]._necroOwnerKey === 'ally:2', '傭兵死靈之書未生成歸屬正確的骷髏');
    expect(list[0].lv === 60 && list[0].mhp === 400, 'Lv65 傭兵骷髏階梯錯誤');

    player.dead = true;
    necroSkeletonTick();
    expect(necroSkeletonList().length === 0, '主角死亡後骷髏未清空');

    const labels = relicPurposeLabels(DB.items.relic_necro_book);
    expect(labels.some(x => x.includes('骷髏復生')) && labels.some(x => x.includes('亡者餽贈')), '死靈之書介面說明不完整');
    return bad;
  });

  assert.deepEqual(necro, [], necro.join('\n'));

  const relicBatch = await page.evaluate(() => {
    const bad = [];
    const expect = (condition, message) => { if (!condition) bad.push(message); };
    const itemCases = [
      ['relic_wing_chaos_blades', '飛翼的混沌雙刀', '混沌的司祭(飛翼)', 30],
      ['relic_corrosive_jelly_skin', '腐蝕的果凍外皮', '象牙塔果凍怪', 10],
      ['relic_goat_demon_feet', '山羊惡魔的雙足', '巴列斯', 10],
      ['relic_succubus_queen_kiss', '斯克巴女皇的魅惑之吻', '暗黑思克巴女皇', 5],
      ['relic_spider_queen_footprints', '蜘蛛女王的足跡', '傲慢的潔尼斯女王', 15],
    ];
    itemCases.forEach(([id, name, mob, weight]) => {
      expect(DB.items[id] && DB.items[id].n === name, `${name} 物品定義缺失`);
      expect((MOB_DROPS[mob] || []).some(row => row[0] === id && row[1] === 0.0001), `${name} 掉落或機率錯誤`);
      expect(ITEM_WEIGHTS[name] === weight, `${name} 重量錯誤`);
    });
    expect(DB.items.relic_wing_chaos_blades.darkCritMorph === 'flywing_double', '飛翼雙刀技能替換旗標錯誤');
    expect(DB.items.relic_corrosive_jelly_skin.corrosiveJellySkin === true, '腐蝕外皮旗標錯誤');
    expect(DB.items.relic_goat_demon_feet.bossEncounterPct === 3, '山羊雙足頭目率應為 3%');
    expect(DB.items.relic_succubus_queen_kiss.charmOnHit === true, '魅惑之吻命中迷魅旗標錯誤');
    expect(DB.items.relic_spider_queen_footprints.extraHit === 1, '蜘蛛足跡額外命中錯誤');

    const jellyMob = {};
    const jellyDefender = { d: { corrosiveJellySkin: true } };
    for (let i = 0; i < 6; i++) corrosiveJellySkinOnBasicHit(jellyMob, jellyDefender);
    expect(jellyMob._corrosiveJellyAtkDown === 15, `腐蝕減攻上限應為 15，實際 ${jellyMob._corrosiveJellyAtkDown}`);
    expect(corrosiveJellySkinOnBasicHit(jellyMob, jellyDefender) === false, '腐蝕減攻達上限後仍繼續疊加');

    state.running = false;
    player.dead = false;
    player.cls = 'mage';
    player.lv = 80;
    player.mastery = 'm_summon';
    player.charmed = null;
    player.buffs = {};
    player.d = Object.assign({}, player.d || {}, { charmOnHit: true });
    const charmMob = {
      uid: 'relic-charm-test', n: '魅惑測試怪', lv: 1, curHp: 100, hp: 100,
      dmg: [1, 4], atkSpd: 2, hit: 1, boss: false, noCharm: false,
    };
    mapState.mobs = [charmMob];
    const oldRenderMobs = renderMobs;
    try {
      renderMobs = () => {};
      expect(relicCharmOnHit(charmMob) === true, '魅惑之吻命中後未成功自動迷魅');
      expect(player.charmed && player.charmed.n === '迷魅：魅惑測試怪', '魅惑之吻未建立迷魅僕人');
      expect(mapState.mobs[0] === null, '被魅惑目標未離開敵方場地');
      const bossMob = { ...charmMob, uid: 'relic-charm-boss', boss: true, curHp: 100 };
      player.charmed = null;
      mapState.mobs = [bossMob];
      expect(relicCharmOnHit(bossMob) === false, '魅惑之吻不應對頭目生效');
    } finally {
      renderMobs = oldRenderMobs;
    }

    const oldPlayerAttack = playerAttack;
    const oldGetAutoCastInterval = getAutoCastInterval;
    const oldCalcStats = calcStats;
    const oldUpdateUI = updateUI;
    try {
      const seen = [];
      player.mp = 20;
      player.dead = false;
      player.cds = player.cds || {};
      player.cds.atkSk = 0;
      delete player._forceComboRate;
      playerAttack = () => { seen.push(player._forceComboRate); };
      getAutoCastInterval = () => 7;
      calcStats = () => {};
      updateUI = () => {};
      const target = { curHp: 100, _dead: false };
      expect(relicFlywingDouble(target) === true, '飛翼雙連施放失敗');
      expect(player.mp === 8, `飛翼雙連應消耗 12 MP，剩餘 ${player.mp}`);
      expect(seen.length === 2 && seen.every(value => value === 100), '飛翼雙連應執行兩次且兩次皆強制雙擊');
      expect(player._forceComboRate == null, '飛翼雙連結束後未還原強制雙擊狀態');
      expect(player.cds.atkSk === 7, '飛翼雙連未設定攻擊技能冷卻');
    } finally {
      playerAttack = oldPlayerAttack;
      getAutoCastInterval = oldGetAutoCastInterval;
      calcStats = oldCalcStats;
      updateUI = oldUpdateUI;
    }

    const oldAllyAttackOnce = allyAttackOnce;
    try {
      const ally = { _allyName: '飛翼傭兵', mp: 20, _downed: false };
      const target = { curHp: 100, _dead: false };
      const seen = [];
      allyAttackOnce = owner => { seen.push(owner._forceComboRate); };
      expect(allyFlywingDouble(ally, target) === true, '傭兵飛翼雙連施放失敗');
      expect(ally.mp === 8, `傭兵飛翼雙連應消耗 12 MP，剩餘 ${ally.mp}`);
      expect(seen.length === 2 && seen.every(value => value === 100), '傭兵飛翼雙連未執行兩次強制雙擊');
      expect(ally._forceComboRate == null, '傭兵飛翼雙連結束後未還原狀態');
    } finally {
      allyAttackOnce = oldAllyAttackOnce;
    }
    return bad;
  });

  assert.deepEqual(relicBatch, [], relicBatch.join('\n'));

  const setRework = await page.evaluate(() => {
    const bad = [];
    const expect = (condition, message) => { if (!condition) bad.push(message); };
    const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;

    expect(SHERINE_SET_TEXT['紅獅'][2].includes('+10%'), '紅獅 5/5 說明不是最終傷害 +10%');
    expect(SHERINE_SET_TEXT['白鳥'][2].includes('+10%'), '白鳥 5/5 說明不是全來源傷害 +10%');
    expect(SHERINE_SET_TEXT['麗人'][2].includes('攻擊速度+20%'), '麗人 5/5 說明不是近戰攻速 +20%');
    expect(SHERINE_SET_TEXT['狂怒'][2].includes('+3%') && SHERINE_SET_TEXT['狂怒'][2].includes('±15%'), '狂怒 5/5 說明數值錯誤');

    state.running = false;
    state.ticks = 100;
    player.dead = false;
    player.hp = 500;
    player.mhp = 1000;
    delete player.curHp;
    player.mastery = null;
    player.buffs = {};
    player.allies = [];

    const fragileTarget = { curHp: 100, ac: 50, weakExpose: 0, st: newMobStatus() };
    fragileTarget.st.fragile = 10;
    expect(near(fragileMult(fragileTarget), 1.1), `白鳥脆弱倍率應為 1.1，實際 ${fragileMult(fragileTarget)}`);

    const comboWpn = DB.items.relic_wing_chaos_blades;
    const comboOwner = { _setShadow3: true, eq: { wpn: { id: 'relic_wing_chaos_blades' } } };
    const expectedCombo = Math.min(100, (Number(comboWpn.comboRate) || 0) + 20);
    expect(comboTriggerChance(comboOwner, comboWpn, comboOwner.eq.wpn) === expectedCombo, '暗影 3/5 未在雙刀基礎雙擊率上增加 20%');
    comboOwner._setShadow3 = false;
    expect(comboTriggerChance(comboOwner, comboWpn, comboOwner.eq.wpn) === (Number(comboWpn.comboRate) || 0), '未裝暗影 3/5 時雙擊率被額外增加');

    const moonOwner = { _setMoon5: true };
    const moonTarget = { curHp: 100, ac: 50, weakExpose: 0, st: newMobStatus() };
    expect(moonShatterOnDamage(moonOwner, moonTarget, 12) === true, '月光 5/5 首次傷害未套用碎裂');
    expect(moonTarget.st.shatter === 30, `碎裂應持續 30 ticks，實際 ${moonTarget.st.shatter}`);
    expect(mobEffAC(moonTarget, player) === 40, `碎裂應使 AC 50 降至 40，實際 ${mobEffAC(moonTarget, player)}`);
    moonTarget.st.shatter = 1;
    expect(moonShatterOnDamage(moonOwner, moonTarget, 5) === false && moonTarget.st.shatter === 30, '重複傷害應刷新碎裂但不得疊層');

    const tauntMob = { uid: 'iron-taunt-test', curHp: 100, hp: 100 };
    state.ticks = 200;
    expect(ironGuardTaunt(tauntMob, player) === true, '鐵衛 5/5 首次嘲諷套用失敗');
    expect(ironGuardTauntTarget(tauntMob) === player, '鐵衛嘲諷未優先鎖定施加者');
    expect(ironGuardTauntWeakensAttack(tauntMob) === true, '鐵衛嘲諷未啟用一般攻擊 -10%');
    state.ticks = 229;
    expect(ironGuardTauntTarget(tauntMob) === player, '鐵衛嘲諷未維持完整 3 秒');
    state.ticks = 230;
    expect(ironGuardTauntTarget(tauntMob) === null && ironGuardTauntWeakensAttack(tauntMob) === false, '鐵衛嘲諷 3 秒後未失效');

    player._setFury5 = true;
    player._setRedLion5 = true;
    expect(near(furyRageRatio(), 0.15), `狂怒玩家滿層應為 0.15，實際 ${furyRageRatio()}`);
    expect(near(rlFuryMult(), 1.265), `紅獅與狂怒玩家乘數應為 1.265，實際 ${rlFuryMult()}`);
    const furyAlly = { curHp: 500, mhp: 1000, _setFury5: true, _setRedLion5: true, buffs: {} };
    expect(near(allyFuryRageRatio(furyAlly), 0.15), `狂怒傭兵滿層應為 0.15，實際 ${allyFuryRageRatio(furyAlly)}`);
    expect(near(allyRlFuryMult(furyAlly), 1.265), `紅獅與狂怒傭兵乘數應為 1.265，實際 ${allyRlFuryMult(furyAlly)}`);
    expect(near(allyBuffDmgReduceMult(furyAlly), 0.85), `狂怒傭兵滿層受傷乘數應為 0.85，實際 ${allyBuffDmgReduceMult(furyAlly)}`);

    return bad;
  });

  assert.deepEqual(setRework, [], setRework.join('\n'));

  const itemStacking = await page.evaluate(() => {
    const bad = [];
    const expect = (condition, message) => { if (!condition) bad.push(message); };
    let seq = 0;
    const make = (overrides = {}) => Object.assign({
      id: 'stack_contract_item',
      uid: `stack-${++seq}`,
      cnt: 1,
      en: 7,
      bless: false,
      anc: false,
      attr: false,
      seteff: false,
      lock: false,
      junk: false,
    }, overrides);

    player.inv = [];
    invAddOrStack(make({ cnt: 2, source: 'drop' }));
    invAddOrStack(make({ cnt: 3, source: 'craft' }));
    expect(player.inv.length === 1 && player.inv[0].cnt === 5, '同能力 +7 物品未跨來源合併');
    invAddOrStack(make({ en: 8 }));
    invAddOrStack(make({ bless: true }));
    invAddOrStack(make({ anc: 'eternal' }));
    invAddOrStack(make({ attr: 'fr3' }));
    invAddOrStack(make({ seteff: '暗影' }));
    invAddOrStack(make({ attrMagic: 'sk_test', attrMagicStar: 2 }));
    invAddOrStack(make({ attrMagic: 'sk_test', attrMagicStar: 3 }));
    expect(player.inv.length === 8, `不同強化／詞綴被誤併，應為 8 格，實際 ${player.inv.length}`);

    player.inv = [];
    invAddOrStack(make({ junk: true }));
    invAddOrStack(make());
    expect(player.inv.length === 1 && player.inv[0].cnt === 2 && player.inv[0].junk === true, '新取得物品未併入同簽章廢品疊');
    invAddOrStack(make({ lock: true }));
    expect(player.inv[0].cnt === 3 && player.inv[0].lock === true && player.inv[0].junk === false, '鎖定來源合併後未擴散保護或清除廢品');

    player.inv = [make({ junk: true })];
    expect(invMergeBack(make()) === false && player.inv.length === 1, '退回裝備不應併入廢品疊');
    player.inv = [make()];
    expect(invMergeBack(make({ cnt: 2, lock: true })) === true, '退回裝備未併入相同 +7 堆疊');
    expect(player.inv[0].cnt === 3 && player.inv[0].lock === true, '退回鎖定裝備的數量或保護狀態錯誤');

    const wh7 = make({ cnt: 2 });
    expect(_whStackFind([wh7], make()) === wh7, '倉庫未找到相同 +7 堆疊');
    expect(_whStackFind([wh7], make({ en: 8 })) == null, '倉庫誤併不同強化值');
    expect(_whStackFind([wh7], make({ gw: ['str'] })) == null, '倉庫誤併巨靈願望戒指');

    player.inv = [];
    invAddOrStack(make({ gw: ['str'] }));
    invAddOrStack(make({ gw: ['dex'] }));
    expect(player.inv.length === 2, '不同願望的巨靈戒指被誤併');

    player.inv = [
      make({ cnt: 2, junk: true }),
      make({ cnt: 3, lock: true }),
      make({ en: 8 }),
      make({ gw: ['str'] }),
      make({ gw: ['dex'] }),
    ];
    consolidateInventory();
    const merged7 = player.inv.find(item => item.en === 7 && !item.gw);
    expect(player.inv.length === 4, `載入合併後應為 4 格，實際 ${player.inv.length}`);
    expect(merged7 && merged7.cnt === 5 && merged7.lock === true && merged7.junk === false, '載入時同 +7 堆疊的數量或保護狀態錯誤');
    expect(player.inv.some(item => item.en === 8 && !item.gw), '不同強化值在載入合併時遺失');
    expect(player.inv.filter(item => item.gw).length === 2, '巨靈願望戒指在載入合併時遺失或誤併');

    return bad;
  });

  assert.deepEqual(itemStacking, [], itemStacking.join('\n'));

  const powderArrowIcon = await page.evaluate(async () => {
    const item = DB.items.relic_powder_arrow;
    const url = item && getIconUrl(item);
    if (url !== 'assets/icons/items/無限火藥爆裂矢.png') return { url, loaded: false };
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      return { url, loaded: image.naturalWidth > 0 && image.naturalHeight > 0 };
    } catch {
      return { url, loaded: false };
    }
  });
  assert.deepEqual(powderArrowIcon, {
    url: 'assets/icons/items/無限火藥爆裂矢.png',
    loaded: true,
  }, '無限火藥爆裂矢圖示路徑或圖片解碼失敗');

  const mercSpellVfx = await page.evaluate(() => {
    const bad = [];
    const expect = (condition, message) => { if (!condition) bad.push(message); };
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
    const mobList = document.getElementById('mob-list');
    const battleView = document.getElementById('battle-view');
    if (!mobList || !battleView) return ['找不到戰鬥畫面測試節點'];

    mobList.innerHTML = '<div class="mob-target" data-uid="merc-vfx-target"><div class="mob-img-inner"><img alt=""></div></div>';
    mobList.getBoundingClientRect = () => rect(0, 0, 700, 242);
    battleView.getBoundingClientRect = () => rect(0, 0, 700, 500);
    const targetBox = mobList.querySelector('.mob-img-inner');
    targetBox.getBoundingClientRect = () => rect(320, 60, 100, 112);

    const ally1 = { _slot: 'vfx-a' };
    const ally2 = { _slot: 'vfx-b' };
    const oldPartyRect = _partyMemberRect;
    const oldPlayerRect = _pmCasterRect;
    try {
      _partyMemberRect = who => who === ally1 ? rect(80, 360, 50, 80) : who === ally2 ? rect(260, 360, 50, 80) : rect(500, 360, 50, 80);
      _pmCasterRect = () => rect(500, 360, 50, 80);
      window.__vfxOff = false;
      state.ff = false;
      _vfxClearAll();
      Object.keys(_spellFxActive).forEach(key => delete _spellFxActive[key]);

      const mob = { uid: 'merc-vfx-target', e: 'none' };
      playSpellFx('光箭', mob, ally1);
      playSpellFx('光箭', mob, ally2);
      playSpellFx('光箭', mob);
      const spells = Array.from(document.querySelectorAll('#vfx-layer .vfx-spell'));
      const keys = spells.map(el => el.dataset.fxkey);
      expect(spells.length === 3, `同技能同目標的兩名傭兵與玩家應同時顯示 3 個特效，實際 ${spells.length}`);
      expect(keys.some(key => key.endsWith('|ally:vfx-a')), '第一名傭兵特效去重鍵缺失');
      expect(keys.some(key => key.endsWith('|ally:vfx-b')), '第二名傭兵特效去重鍵缺失');
      expect(keys.some(key => key.endsWith('|player')), '玩家特效去重鍵缺失');
      const origins = spells.map(el => Number.parseFloat(el.style.left)).filter(Number.isFinite);
      expect(origins.length === 3 && new Set(origins.map(Math.round)).size === 3, '玩家與兩名傭兵的投射物起點沒有分開');
      const beforeDuplicate = spells.length;
      playSpellFx('光箭', mob, ally1);
      expect(document.querySelectorAll('#vfx-layer .vfx-spell').length === beforeDuplicate, '同一傭兵的同一法術未正確去重');
    } finally {
      _partyMemberRect = oldPartyRect;
      _pmCasterRect = oldPlayerRect;
      _vfxClearAll();
      Object.keys(_spellFxActive).forEach(key => delete _spellFxActive[key]);
    }
    return bad;
  });
  assert.deepEqual(mercSpellVfx, [], mercSpellVfx.join('\n'));

  const wikiPage = await browser.newPage();
  const wikiErrors = [];
  wikiPage.on('pageerror', error => wikiErrors.push(error.message));
  try {
    async function wikiText(tab, cls) {
      const url = `http://127.0.0.1:${address.port}/index.html?view=wiki&tab=${tab}${cls ? `&cls=${cls}` : ''}`;
      await wikiPage.goto(url, { waitUntil: 'domcontentloaded' });
      await wikiPage.waitForSelector('#m-wiki-body');
      return wikiPage.locator('#m-wiki-body').innerText();
    }
    const combatText = await wikiText('combat');
    assert.ok(combatText.includes('紅獅5件＝物理攻擊×1.1') &&
      combatText.includes('脆弱') && combatText.includes('+10%') &&
      combatText.includes('碎裂') && combatText.includes('AC −10') &&
      combatText.includes('麗人3件近戰+3%') &&
      combatText.includes('裝備近距離武器時攻擊速度 +20%') &&
      !combatText.includes('月光5件才連魔法/必中技能'), '戰鬥機制頁未完整渲染新版套裝規則');

    const sherineText = await wikiText('sherine');
    assert.ok(sherineText.includes('最終傷害+10%') &&
      sherineText.includes('攻擊速度+20%') &&
      sherineText.includes('雙擊觸發機率+20%') &&
      sherineText.includes('最多±15%'), '席琳頁未渲染新版七套規則');

    const magicText = await wikiText('magic', 'mage');
    assert.ok(magicText.includes('死靈之書') &&
      magicText.includes('骷髏復生') &&
      magicText.includes('不耗 MP') &&
      magicText.includes('最多 6 隻'), '職業魔法頁未渲染死靈之書機制');

    const allyText = await wikiText('ally');
    assert.ok(allyText.includes('60%') && allyText.includes('×2.8') &&
      allyText.includes('×5.2') && allyText.includes('金幣不加乘') &&
      !allyText.includes('×8'), '傭兵頁未保留本站獎勵政策');
    assert.deepEqual(wikiErrors, [], `小百科頁面執行錯誤：\n${wikiErrors.join('\n')}`);
  } finally {
    await wikiPage.close();
  }

  assert.deepEqual(pageErrors, [], `頁面執行錯誤：\n${pageErrors.join('\n')}`);
  console.log('✅ Shines backports：傭兵法術動畫、小百科、圖示、死靈之書、五件遺物、七套席琳套裝與物品堆疊契約通過');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
