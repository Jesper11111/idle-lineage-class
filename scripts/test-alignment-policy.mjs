import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('afk-alignment-policy.js', 'utf8');

function makeContext() {
  const context = {
    console: { info() {}, warn() {} },
    Math,
    Number,
    _applied: [],
    player: { cls: 'knight', alignmentValue: 0 },
    mapState: { current: 'field' },
    isSiegeArea: map => map === 'siege',
    pvpClampAlignment: value => Math.max(-32767, Math.min(32767, Math.round(Number(value) || 0))),
    AFK_TOGGLES: {
      on: true,
      register() {},
      enabled() { return this.on; }
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`
    function pvpChangeAlignment(delta) {
      _applied.push(delta);
      player.alignmentValue += delta;
      return delta;
    }
    function pvpOnKillMob(mob) {
      if (!mob || !player.cls) return;
      if (mob.pledgeEnemy || mob.siegeEnemy || mob.race === '血盟' || isSiegeArea(mapState.current)) return;
      if (mob.trollPlayer) {
        if ((mob._pvpAlignment || 0) >= 1000) pvpChangeAlignment(-10000);
        else if ((mob._pvpAlignment || 0) > -1000) pvpChangeAlignment(-5000);
        return;
      }
      pvpChangeAlignment(1);
    }
  `, context, { filename: 'mock-combat-core.js' });
  vm.runInContext(source, context, { filename: 'afk-alignment-policy.js' });
  return { context, applied: context._applied };
}

function rng(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function averageGain(api, level, alignment) {
  const range = api.divisorRange(level);
  const magnitudeMax = Math.min(50, level);
  let total = 0;
  let count = 0;
  for (const signRoll of [0.25, 0.75]) {
    for (let magnitude = 1; magnitude <= magnitudeMax; magnitude++) {
      const magnitudeRoll = (magnitude - 0.5) / magnitudeMax;
      for (let divisor = range.min; divisor <= range.max; divisor++) {
        const divisorRoll = (divisor - range.min + 0.5) / (range.max - range.min + 1);
        total += api.calculateGain(level, alignment, rng([signRoll, magnitudeRoll, divisorRoll])).gain;
        count++;
      }
    }
  }
  return total / count;
}

{
  const { context } = makeContext();
  const api = context.AFK_ALIGNMENT_POLICY;
  assert.equal(api.installed, true);
  assert.deepEqual({ ...api.divisorRange(1) }, { min: 1, max: 1 });
  assert.deepEqual({ ...api.divisorRange(80) }, { min: 5, max: 8 });
  assert.equal(api.alignmentRate(999), 1);
  assert.equal(api.alignmentRate(1000), 0.5);
  assert.equal(api.alignmentRate(9999), 0.5);
  assert.equal(api.alignmentRate(10000), 0.25);

  const zeroRaw = api.calculateGain(10, 0, rng([0, 0.999999, 0]));
  assert.equal(zeroRaw.raw, 0);
  assert.equal(zeroRaw.gain, 1, '原始值等於 0 必須固定 +1');

  const highRoll = api.calculateGain(80, 0, rng([0.9, 0.999999, 0]));
  assert.equal(highRoll.raw, 130);
  assert.equal(highRoll.divisor, 5);
  assert.equal(highRoll.gain, 26);
  assert.equal(api.calculateGain(80, 1000, rng([0.9, 0.999999, 0])).gain, 13);
  assert.equal(api.calculateGain(80, 10000, rng([0.9, 0.999999, 0])).gain, 6);
  assert.equal(averageGain(api, 80, 0).toFixed(2), '12.27');
  assert.equal(averageGain(api, 80, 1000).toFixed(2), '5.88');
  assert.equal(averageGain(api, 80, 10000).toFixed(2), '2.71');
}

{
  const { context, applied } = makeContext();
  const originalRandom = context.Math.random;
  context.Math.random = rng([0.9, 0.999999, 0]);
  context.pvpOnKillMob({ lv: 80, race: '不死' });
  context.Math.random = originalRandom;
  assert.deepEqual(applied, [26], '普通怪必須以政策增量取代核心 +1');

  context.pvpOnKillMob({ lv: 80, trollPlayer: true, _pvpAlignment: 1000 });
  assert.deepEqual(applied, [26, -10000], '玩家 NPC 扣性向規則不可被改寫');

  context.pvpOnKillMob({ lv: 80, pledgeEnemy: true });
  context.mapState.current = 'siege';
  context.pvpOnKillMob({ lv: 80 });
  assert.deepEqual(applied, [26, -10000], '血盟／攻城例外不可取得性向');

  context.mapState.current = 'field';
  context.AFK_TOGGLES.on = false;
  context.pvpOnKillMob({ lv: 80 });
  assert.deepEqual(applied, [26, -10000, 1], '關閉政策外掛時必須透明退回核心 +1');
}

const offline = readFileSync('afk-offline.js', 'utf8');
assert.match(offline, /killMob\(ki\);\s*\n\s*settleDeadMobs\(\);/, '離線快速一般怪必須共用 killMob 管線');
assert.match(offline, /killMob\(bi\); settleDeadMobs\(\); maybeSpawnMobs\(\);/, '離線快速頭目必須共用 killMob 管線');

console.log('✅ 性向政策：<=0 保底、隨機除數、三級倍率、PVP／攻城例外與離線共用管線均通過。');
