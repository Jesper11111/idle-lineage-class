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

const [statsSource, coreSource, attackSource, allySource, skillSource] = await Promise.all([
  readFile(join(ROOT, 'js/02-stats-recompute.js'), 'utf8'),
  readFile(join(ROOT, 'js/03-combat-core.js'), 'utf8'),
  readFile(join(ROOT, 'js/04-combat-attack.js'), 'utf8'),
  readFile(join(ROOT, 'js/06-status-allies.js'), 'utf8'),
  readFile(join(ROOT, 'js/07-skills-cast.js'), 'utf8'),
]);
assert.ok(statsSource.includes('ed.bossEncounterPct') && statsSource.includes('ed.corrosiveJellySkin') && statsSource.includes('ed.charmOnHit'), '五件遺物能力未接入 stats 重算');
assert.ok(coreSource.includes('Math.random() < _normalBossChance'), '山羊惡魔雙足未接入一般地圖頭目率');
assert.ok(attackSource.includes('enemyPhysicalAttack(mob, idx, 0, null, null, true)'), '怪物一般攻擊未標記 basic attack');
assert.equal((attackSource.match(/corrosiveJellySkinOnBasicHit\(mob, (?:player|ally)\)/g) || []).length, 2, '腐蝕果凍外皮須同時接入玩家與傭兵受擊');
assert.ok(attackSource.includes('player._forceComboRate != null'), '飛翼雙連未接入玩家強制雙擊');
assert.ok(allySource.includes('ally._forceComboRate != null') && allySource.includes('function allyFlywingDouble'), '飛翼雙連未完整接入傭兵');
assert.ok(skillSource.includes('function relicCharmOnHit') && skillSource.includes('function relicFlywingDouble'), '五件遺物技能函式缺失');

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
  assert.deepEqual(pageErrors, [], `頁面執行錯誤：\n${pageErrors.join('\n')}`);
  console.log('✅ Shines backports：死靈之書與五件遺物戰鬥契約通過');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
