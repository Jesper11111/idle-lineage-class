import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('js/05-kill-progression.js', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function partyActiveMemberCount()');
const end = source.indexOf('// 任務道具的主玩家與隊員分流', start);
assert.ok(start >= 0 && end > start, '找不到傭兵經驗政策函式區塊');
const bonusStart = source.indexOf('function partyExpBonusPct()');
const bonusEnd = source.indexOf('// =====', bonusStart);
assert.ok(bonusStart >= 0 && bonusEnd > bonusStart, '找不到既有組隊經驗加成函式');

const context = vm.createContext({ Math, Number, player: { cls: 'knight', allies: [] } });
vm.runInContext(source.slice(start, end) + '\n' + source.slice(bonusStart, bonusEnd), context, { filename: 'js/05-kill-progression.js' });

function setParty(cls, alive, downed = 0) {
  context.player = {
    cls,
    allies: [
      ...Array.from({ length: alive }, (_, i) => ({ uid: `alive-${i}`, _downed: false })),
      ...Array.from({ length: downed }, (_, i) => ({ uid: `down-${i}`, _downed: true }))
    ]
  };
}

function evaluate(cls, alive, doll = 0, downed = 0) {
  setParty(cls, alive, downed);
  return vm.runInContext(`({
    count: partyExpShareCount(),
    divisor: partyExpShareDivisor(),
    leadership: partyRoyalLeadershipPct(),
    shared: Math.floor(partyExpSharedRaw(100)),
    player: partyPlayerExpGain(100, ${Number(doll)})
  })`, context);
}

const nonRoyalExpected = [100, 74, 60, 50, 44, 40, 36, 33];
for (let alive = 0; alive <= 7; alive += 1) {
  const got = evaluate('knight', alive);
  assert.equal(got.count, alive + 1, `非王族 ${alive} 名：實際成員數`);
  assert.ok(Math.abs(got.divisor - (1 + alive * 0.4)) < 1e-12, `非王族 ${alive} 名：有效分母`);
  assert.equal(got.leadership, 0, `非王族 ${alive} 名：不應有統率`);
  assert.equal(got.shared, nonRoyalExpected[alive], `非王族 ${alive} 名：100 經驗加權份額`);
  assert.equal(got.player, nonRoyalExpected[alive], `非王族 ${alive} 名：本人經驗`);
}

const royalSharedExpected = [100, 77, 64, 56, 50, 46, 43, 41];
const royalPlayerExpected = [100, 100, 103, 107, 111, 116, 121, 127];
for (let alive = 0; alive <= 7; alive += 1) {
  const got = evaluate('royal', alive);
  assert.ok(Math.abs(got.divisor - (1 + alive * 0.4)) < 1e-12, `王族 ${alive} 名：有效分母`);
  assert.equal(got.leadership, alive * 30, `王族 ${alive} 名：本人統率`);
  assert.equal(got.shared, royalSharedExpected[alive], `王族 ${alive} 名：傭兵／寵物基礎份額`);
  assert.equal(got.player, royalPlayerExpected[alive], `王族 ${alive} 名：本人經驗`);
}

const royalFullWithDoll = evaluate('royal', 7, 10);
assert.equal(royalFullWithDoll.player, 139, '王族帶滿＋10% 娃娃應取得 139 經驗');
assert.ok(royalFullWithDoll.player >= 110, '王族帶滿保底須包含娃娃效果');
setParty('royal', 7);
const forcedFloor = vm.runInContext(`(() => {
  const original = partyExpSharedRaw;
  partyExpSharedRaw = () => 1;
  try { return partyPlayerExpGain(100, 10); }
  finally { partyExpSharedRaw = original; }
})()`, context);
assert.equal(forcedFloor, 110, '即使加權結果不足，王族帶滿仍須保底 100＋10% 娃娃');

const royalWithDowned = evaluate('royal', 5, 0, 2);
assert.equal(royalWithDowned.count, 6, '倒地傭兵不計入存活成員數');
assert.equal(royalWithDowned.leadership, 150, '倒地傭兵不提供統率');
assert.equal(royalWithDowned.player, 116, '5 名未倒地＋2 名倒地應等同 5 名隊伍');

const policy = readFileSync('afk-merc-policy.js', 'utf8');
for (const expected of [
  "version: 'weighted-exp04-royal30-drop60-town-refresh-on-pp-v3.8.34'",
  'expMercWeight: 0.4',
  'royalLeaderExpPerMercPct: 30',
  'royalLeaderExpMaxPct: 210',
  'royalFullPartySoloFloor: true'
]) assert.ok(policy.includes(expected), `政策中繼資料缺少：${expected}`);

const wiki = readFileSync('afk-wiki.js', 'utf8');
assert.ok(wiki.includes('<b>經驗採 0.4 權重分配</b>'), '小百科未說明 0.4 權重經驗');
assert.ok(wiki.includes('王族隊長本人</b>另依每名未倒地傭兵 <b>+30%</b>'), '小百科未說明王族統率');
assert.ok(!wiki.includes('<b>經驗不再拆分</b>'), '小百科仍殘留 PP 完整經驗說明');

console.log('✅ 傭兵經驗政策：0.4 權重、王族 +30%/名（最高 +210%）、帶滿含娃娃單練保底與倒地排除均通過。');
