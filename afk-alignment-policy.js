/*
 * afk-alignment-policy.js — 本站一般怪物性向成長政策。
 *
 * 不改 PP 的 PVP／血盟／攻城判定，只在核心確定要套用原本「一般怪物 +1」時，
 * 把該次增量換成怪物等級、雙層隨機與目前性向分段共同決定的結果。
 * 離線引擎同樣走 killMob → pvpOnKillMob，因此線上／離線只維護這一份公式。
 */
(function () {
  'use strict';

  var POLICY_ID = 'alignmentpolicy';
  var VERSION = 'level-random-sqrt-band-v1';

  function enabled() {
    return !(window.AFK_TOGGLES && !window.AFK_TOGGLES.enabled(POLICY_ID));
  }

  if (window.AFK_TOGGLES) window.AFK_TOGGLES.register({
    id: POLICY_ID,
    name: '怪物性向成長',
    desc: '一般怪物依等級與隨機除數增加性向；性向越高，增加量越低',
    group: '遊戲玩法',
    def: true
  });

  function unitRandom(rand) {
    var value;
    try { value = Number((typeof rand === 'function' ? rand : Math.random)()); } catch (e) { value = Math.random(); }
    if (!Number.isFinite(value)) value = Math.random();
    return Math.max(0, Math.min(0.999999999, value));
  }

  function randomInt(min, max, rand) {
    min = Math.ceil(Number(min) || 0);
    max = Math.floor(Number(max) || min);
    if (max < min) max = min;
    return min + Math.floor(unitRandom(rand) * (max - min + 1));
  }

  function normalizeLevel(level) {
    return Math.max(1, Math.floor(Number(level) || 1));
  }

  function divisorRange(level) {
    level = normalizeLevel(level);
    var root = Math.sqrt(level);
    var min = Math.max(1, Math.ceil(root / 2));
    var max = Math.max(min, Math.floor(root));
    return { min: min, max: max };
  }

  function alignmentRate(alignment) {
    alignment = Math.round(Number(alignment) || 0);
    if (alignment < 1000) return 1;
    if (alignment < 10000) return 0.5;
    return 0.25;
  }

  function calculateGain(level, alignment, rand) {
    level = normalizeLevel(level);
    var magnitudeMax = Math.min(50, level);
    var sign = unitRandom(rand) < 0.5 ? -1 : 1;
    var magnitude = randomInt(1, magnitudeMax, rand);
    var raw = level + sign * magnitude;
    var range = divisorRange(level);
    var divisor = randomInt(range.min, range.max, rand);
    var base = raw <= 0 ? 1 : Math.max(1, Math.floor(raw / divisor));
    var rate = alignmentRate(alignment);
    var gain = Math.max(1, Math.floor(base * rate));
    return {
      level: level,
      sign: sign,
      magnitude: magnitude,
      raw: raw,
      divisorMin: range.min,
      divisorMax: range.max,
      divisor: divisor,
      base: base,
      rate: rate,
      gain: gain
    };
  }

  function currentAlignment() {
    var current = (typeof player !== 'undefined' && player) ? player.alignmentValue : 0;
    return (typeof pvpClampAlignment === 'function') ? pvpClampAlignment(current) : Math.round(Number(current) || 0);
  }

  function ordinaryMonsterKill(mob) {
    if (!mob || mob.trollPlayer || mob.pledgeEnemy || mob.siegeEnemy || mob.race === '血盟') return false;
    try {
      if (typeof isSiegeArea === 'function' && typeof mapState !== 'undefined' && mapState && isSiegeArea(mapState.current)) return false;
    } catch (e) { return false; }
    return true;
  }

  var originalKill = (typeof pvpOnKillMob === 'function') ? pvpOnKillMob : window.pvpOnKillMob;
  if (typeof originalKill !== 'function') {
    console.warn('[AFK-alignment-policy] 找不到 pvpOnKillMob，性向政策未安裝。');
    return;
  }

  function wrappedPvpOnKillMob(mob) {
    if (!enabled() || !ordinaryMonsterKill(mob)) return originalKill.apply(this, arguments);

    var originalChange = (typeof pvpChangeAlignment === 'function') ? pvpChangeAlignment : window.pvpChangeAlignment;
    if (typeof originalChange !== 'function') return originalKill.apply(this, arguments);

    var replaced = false;
    function policyChange(delta) {
      if (!replaced && Number(delta) === 1) {
        replaced = true;
        var result = calculateGain(mob.lv, currentAlignment());
        return originalChange.call(this, result.gain);
      }
      return originalChange.apply(this, arguments);
    }

    window.pvpChangeAlignment = policyChange;
    try {
      return originalKill.apply(this, arguments);
    } finally {
      if (window.pvpChangeAlignment === policyChange) window.pvpChangeAlignment = originalChange;
    }
  }

  wrappedPvpOnKillMob.__afkAlignmentPolicy = true;
  wrappedPvpOnKillMob.__afkAlignmentOriginal = originalKill;
  window.pvpOnKillMob = wrappedPvpOnKillMob;
  window.AFK_ALIGNMENT_POLICY = {
    installed: true,
    version: VERSION,
    calculateGain: calculateGain,
    divisorRange: divisorRange,
    alignmentRate: alignmentRate
  };
  console.info('[AFK-alignment-policy] hooks OK (' + VERSION + ')');
})();
