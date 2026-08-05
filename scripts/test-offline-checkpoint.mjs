import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../afk-offline.js', import.meta.url), 'utf8');
const patcher = await readFile(new URL('./apply-offline-safety-patches.mjs', import.meta.url), 'utf8');

const checkpointStart = source.indexOf('    // 🔒 Jesper offline checkpoint commit gate v1');
const checkpointEnd = source.indexOf('    // ═══ 分段檢查點(宣告結束)', checkpointStart);
assert.ok(checkpointStart >= 0 && checkpointEnd > checkpointStart,
  '應能擷取離線 checkpoint commit gate');

const saveHookStart = source.indexOf("    if (typeof saveGame === 'function') {", source.indexOf('(function installOfflineHooks()'));
const saveHookEnd = source.indexOf("    if (typeof changeMap === 'function') {", saveHookStart);
assert.ok(saveHookStart >= 0 && saveHookEnd > saveHookStart,
  '應能擷取 close-flush saveGame 委派掛點');

function createHarness(saveResults = [true]) {
  let saveCalls = 0;
  let clock = 1000;
  const stamps = [];
  const histories = [];
  const context = {
    console,
    performance: { now: () => ++clock },
    timing: { closeTs: 100000 },
    done: 25,
    player: { dead: false },
    state: { running: true },
    TICK_MS: 100,
    _ckptLastMs: 0,
    _ckptN: 0,
    _ckptMs: 0,
    _saveSquelch: true,
    wallHoldsRestore() {},
    wallHoldsApply() {},
    stampCore(value) { stamps.push(value); },
    buildHistRec() { return { done: context.done }; },
    recordHistory(value) { histories.push(value); },
    stamp() {},
    saveGame() {
      const result = saveResults[Math.min(saveCalls, saveResults.length - 1)];
      saveCalls++;
      return result;
    },
  };
  context.window = context;
  vm.runInNewContext(
    `var _ckptNow = null;
${source.slice(checkpointStart, checkpointEnd)}
(function () {
${source.slice(saveHookStart, saveHookEnd)}
})();
window.__checkpointTest = {
  leave: function () { window.__fb5CloseFlush = true; try { return saveGame(); } finally { window.__fb5CloseFlush = false; } },
  direct: function () { return _ckptNow(); },
  setDone: function (value) { done = value; },
  committed: function () { return _ckptCommittedDone; },
  checkpointCount: function () { return _ckptN; }
};`,
    context,
    { filename: 'offline-checkpoint-unit.js' },
  );
  return {
    api: context.__checkpointTest,
    saveCalls: () => saveCalls,
    stamps,
    histories,
  };
}

{
  const h = createHarness([true]);
  assert.equal(h.api.leave(), true, '第一次 hidden close-flush 應完成 checkpoint');
  assert.equal(h.api.direct(), true, '同一輪 offline visibility handler 應視為已完成');
  assert.equal(h.api.leave(), true, '相同 done 的 pagehide 應由冪等 checkpoint 回成功');
  assert.equal(h.saveCalls(), 1, 'hidden → pagehide 同一進度只能做一次底層 full save');
  assert.deepEqual(h.stamps, [102500], '成功後只能推進一次離線錨點');
  assert.equal(h.api.checkpointCount(), 1);

  h.api.setDone(30);
  assert.equal(h.api.leave(), true, '兩個 lifecycle 事件間進度前進時應允許新 checkpoint');
  assert.equal(h.saveCalls(), 2);
  assert.deepEqual(h.stamps, [102500, 103000]);
  assert.equal(h.histories.length, 2);
}

{
  const h = createHarness([false, true]);
  assert.equal(h.api.leave(), false, '主存檔失敗時 checkpoint 必須回報失敗');
  assert.equal(h.stamps.length, 0, '存檔失敗不得先推進離線錨點');
  assert.equal(h.api.committed(), -1, '失敗進度不得被標記成已提交');
  assert.equal(h.api.leave(), true, '後續 pagehide／beforeunload 必須能重試同一進度');
  assert.equal(h.saveCalls(), 2);
  assert.equal(h.stamps.length, 1);
  assert.equal(h.api.committed(), 25);
}

assert.match(patcher, /CHECKPOINT_COMMIT_MARKER/,
  '上游同步後必須由離線安全 patcher 重套 checkpoint commit gate');
assert.match(patcher, /window\.__fb5CloseFlush && typeof _ckptNow === 'function'/,
  'patcher 必須保留 close-flush 委派');

{
  const cacheStart = source.indexOf("    if (typeof _saveUnwrap === 'function') {");
  const cacheEnd = source.indexOf('    // 2) _seedHash', cacheStart);
  assert.ok(cacheStart >= 0 && cacheEnd > cacheStart, '應能擷取存檔驗簽快取');
  let unwrapCalls = 0;
  const context = {
    Object,
    _saveUnwrap(raw) {
      unwrapCalls++;
      return { payload: raw.slice(0, 8), signed: true, ok: true };
    },
  };
  context.window = context;
  vm.runInNewContext(source.slice(cacheStart, cacheEnd), context, { filename: 'save-unwrap-budget.js' });
  const rawA = 'A'.repeat(1_000_000);
  const rawB = 'B'.repeat(1_000_000);
  const rawC = 'C'.repeat(1_000_000);
  context._saveUnwrap(rawA);
  context._saveUnwrap(rawB);
  context._saveUnwrap(rawC);
  assert.equal(unwrapCalls, 3);
  context._saveUnwrap(rawC);
  assert.equal(unwrapCalls, 3, '最近的大存檔仍應命中驗簽快取');
  context._saveUnwrap(rawA);
  assert.equal(unwrapCalls, 4,
    '三份 1MB 存檔超過總字數上限後，最舊版本必須被釋放而非長駐到第 8 份');
}

assert.match(patcher, /UW_CHAR_MAX = 2500000/,
  '上游同步後必須重套大存檔驗簽快取字數上限');

console.log('PASS offline checkpoint: lifecycle 去重、成功後推錨點、失敗可重試、大存檔快取有界');
