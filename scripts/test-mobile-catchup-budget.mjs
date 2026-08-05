import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const core = await readFile(new URL('../js/03-combat-core.js', import.meta.url), 'utf8');
const drops = await readFile(new URL('../js/01-drops-config.js', import.meta.url), 'utf8');
const patcher = await readFile(new URL('./apply-core-patches.mjs', import.meta.url), 'utf8');

const policyStart = core.indexOf('// ⏩ 補跑專用快速排程：桌機維持 80/8ms');
const policyEnd = core.indexOf('function _ffProgressEnsure()', policyStart);
assert.ok(policyStart >= 0 && policyEnd > policyStart, '應能擷取手機補算排程政策');
const policySource = core.slice(policyStart, policyEnd);

const gameLoopStart = core.indexOf('function gameLoop()');
const gameLoopEnd = core.indexOf('function resetCatchupForRoleSwitch()', gameLoopStart);
assert.ok(gameLoopStart >= 0 && gameLoopEnd > gameLoopStart, '應能擷取正式 gameLoop 與補跑排程器');
const gameLoopSchedulerSource = core.slice(gameLoopStart, gameLoopEnd);

const queueStart = drops.indexOf('function queueCatchupMs(ms)');
const queueEnd = drops.indexOf('// 統一啟動遊戲計時器', queueStart);
const resumeStart = drops.indexOf('function _perfNow()');
const resumeEnd = drops.indexOf('// 🧵', resumeStart);
assert.ok(queueStart >= 0 && queueEnd > queueStart && resumeStart >= 0 && resumeEnd > resumeStart,
  '應能擷取正式背景補跑 queue 與 lifecycle handler');
const backgroundResumeSource = drops.slice(queueStart, queueEnd) + '\n' + drops.slice(resumeStart, resumeEnd);

function evaluatePolicy({ mobile, inputPending = false } = {}) {
  let now = 0;
  const context = {
    performance: { now: () => now },
    Date,
    innerWidth: mobile ? 932 : 1280,
    matchMedia: () => ({ matches: !!mobile }),
    navigator: {
      userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' : 'Desktop',
      scheduling: { isInputPending: () => inputPending },
    },
    document: {
      body: { classList: { contains: () => false } },
    },
  };
  context.window = context;
  vm.runInNewContext(
    `${policySource}
globalThis.__testPolicy = window.__afkCatchupPolicy;
globalThis.__testShouldYield = _ffShouldYield;
globalThis.__setNow = function (value) { performance.now = function () { return value; }; };`,
    context,
    { filename: 'mobile-catchup-policy.js' },
  );
  return context;
}

function runScheduler({
  mobile = true,
  tickCost = 5,
  initialDebt = 1_000,
  maxCallbacks = 500,
  hiddenHeartbeats = 0,
  tickThrows = false,
  logThrows = false,
  saveCost = 0,
  timerOvershoot = 0,
} = {}) {
  let now = 0;
  const epochBase = 1_800_000_000_000;
  let timerSeq = 1;
  let callbacks = 0;
  let tickCalls = 0;
  let settleCalls = 0;
  let saveCalls = 0;
  let finishCalls = 0;
  let maxPending = 0;
  const delays = [];
  const timers = new Map();
  const documentState = { hidden: hiddenHeartbeats > 0, body: null };
  const context = {
    TICK_MS: 100,
    _loopLast: 0,
    _tickDebt: initialDebt,
    performance: { now: () => now },
    Date: { now: () => epochBase + now },
    innerWidth: mobile ? 390 : 1280,
    matchMedia: () => ({ matches: !!mobile }),
    navigator: {
      userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' : 'Desktop',
      scheduling: { isInputPending: () => false },
    },
    document: documentState,
    state: { running: true, ff: false, ffSmall: false, inTick: false },
    player: { dead: false, gold: 0, inv: [] },
    setTimeout(callback, delay) {
      const id = timerSeq++;
      const ms = Math.max(0, Number(delay) || 0);
      delays.push(ms);
      timers.set(id, { id, callback, due: now + ms });
      maxPending = Math.max(maxPending, timers.size);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    tick() {
      tickCalls++;
      now += tickCost;
      if (tickThrows) throw new Error('synthetic tick failure');
    },
    settleDeadMobs() { settleCalls++; },
    resetCatchupGainItemIndex() {},
    discardCatchupAutoSort() {},
    flushCatchupAutoSort() {},
    takeCatchupSaveRequest: () => false,
    _ffInventoryCounts: () => ({}),
    _vfxClearAll() {},
    flushTickRender() {},
    renderMobs() {},
    updateUI() {},
    renderTabs() {},
    saveGame() { saveCalls++; now += saveCost; return true; },
    logSys() { if (logThrows) throw new Error('synthetic log failure'); },
    DB: { items: {} },
    getItemColor: () => '',
    console: { error() {}, warn() {}, log() {} },
  };
  context.window = context;
  vm.runInNewContext(
    `${gameLoopSchedulerSource}
const __finishOriginal = _ffFinishCatchup;
_ffFinishCatchup = function () { globalThis.__finishCalls++; return __finishOriginal(); };
globalThis.__finishCalls = 0;
globalThis.__runGameLoop = gameLoop;
globalThis.__schedulerState = function () {
  return { debt: _tickDebt, loopLast: _loopLast, pending: _ffResumeTimer !== null,
    accActive: _ffAcc !== null, aborted: !!(_ffAcc && _ffAcc.aborted) };
};`,
    context,
    { filename: `production-catchup-${mobile ? 'mobile' : 'desktop'}-${tickCost}ms.js` },
  );

  function runNextTimer() {
    const next = [...timers.values()].sort((a, b) => a.due - b.due || a.id - b.id)[0];
    assert.ok(next, '應有下一個補跑 timer');
    timers.delete(next.id);
    now = Math.max(now, next.due + timerOvershoot);
    const beforeRegular = tickCalls;
    context.__runGameLoop();
    assert.equal(tickCalls, beforeRegular, 'resume timer 尚在時 regular interval 不得插隊');
    next.callback();
    callbacks++;
    const afterResume = tickCalls;
    context.__runGameLoop();
    assert.equal(tickCalls, afterResume, 'resume callback 後 regular interval 不得重複跑 tick');
  }

  context.__runGameLoop();
  if (hiddenHeartbeats > 0) {
    assert.equal(timers.size, 0, '背景補跑不得建立前景 timer');
    for (let i = 0; i < hiddenHeartbeats; i++) {
      now += 1_000;
      context.__runGameLoop();
      assert.equal(timers.size, 0, '背景 heartbeat 後不得殘留前景 timer');
    }
  } else {
    while (timers.size && callbacks < maxCallbacks) runNextTimer();
  }
  finishCalls = context.__finishCalls;
  return {
    state: context.__schedulerState(), now, callbacks, tickCalls, settleCalls, saveCalls,
    finishCalls, pendingTimers: timers.size, maxPending, delays,
  };
}

function runVisibilityOrdering(order, hiddenMs = 40_000) {
  let now = 100;
  let timerSeq = 1;
  let tickCalls = 0;
  const timers = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const addListener = (target, type, callback) => {
    const list = target.get(type) || [];
    list.push(callback);
    target.set(type, list);
  };
  const documentState = {
    hidden: false,
    visibilityState: 'visible',
    body: null,
    addEventListener(type, callback) { addListener(documentListeners, type, callback); },
  };
  const context = {
    TICK_MS: 100,
    _loopLast: now,
    _tickDebt: 1_000,
    _ffSavePending: false,
    performance: { now: () => now },
    Date: { now: () => 1_800_000_000_000 + now },
    innerWidth: 390,
    matchMedia: () => ({ matches: true }),
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile',
      scheduling: { isInputPending: () => false },
    },
    document: documentState,
    state: { running: true, ff: false, ffSmall: false, inTick: false },
    player: { cls: 'm_knight', dead: false, gold: 0, inv: [] },
    addEventListener(type, callback) { addListener(windowListeners, type, callback); },
    setTimeout(callback, delay) {
      const id = timerSeq++;
      timers.set(id, { id, callback, due: now + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    tick() { tickCalls++; now += 5; },
    settleDeadMobs() {},
    resetCatchupGainItemIndex() {},
    discardCatchupAutoSort() {},
    flushCatchupAutoSort() {},
    takeCatchupSaveRequest: () => false,
    _ffInventoryCounts: () => ({}),
    _vfxClearAll() {},
    flushTickRender() {},
    renderMobs() {},
    updateUI() {},
    renderTabs() {},
    saveGame: () => true,
    logSys() {},
    DB: { items: {} },
    getItemColor: () => '',
    console: { error() {}, warn() {}, log() {} },
  };
  context.window = context;
  vm.runInNewContext(
    `${gameLoopSchedulerSource}\n${backgroundResumeSource}
globalThis.__runGameLoop = gameLoop;
globalThis.__schedulerState = function () {
  return { debt: _tickDebt, loopLast: _loopLast, pending: _ffResumeTimer !== null,
    generation: _ffResumeGeneration, hiddenAt: _ffHiddenAt };
};`,
    context,
    { filename: `production-visibility-${order}.js` },
  );

  const fireDocument = (type) => (documentListeners.get(type) || []).forEach((callback) => callback());
  const fireWindow = (type, event = {}) => (windowListeners.get(type) || []).forEach((callback) => callback(event));

  context.__runGameLoop();
  assert.equal(timers.size, 1, `${order}: 前景補跑應先排一個 resume timer`);
  const stale = [...timers.values()][0];
  const beforeHidden = context.__schedulerState();
  const beforeHiddenTickCalls = tickCalls;

  documentState.hidden = true;
  documentState.visibilityState = 'hidden';
  fireDocument('visibilitychange');
  assert.equal(timers.size, 0, `${order}: hidden handler 必須取消舊 resume timer`);
  const cancelledGeneration = context.__schedulerState().generation;
  assert.ok(cancelledGeneration > beforeHidden.generation, `${order}: 取消 timer 必須使舊 callback token 失效`);

  now += hiddenMs;
  documentState.hidden = false;
  documentState.visibilityState = 'visible';
  if (order.startsWith('timer-first')) {
    stale.callback();   // 模擬 clearTimeout 前已排入 task queue 的最壞情況
    fireDocument('visibilitychange');
  } else {
    fireDocument('visibilitychange');
    stale.callback();   // 舊 callback 不得清掉 visibility handler 剛排的新 timer
  }

  const resumed = context.__schedulerState();
  assert.equal(resumed.debt, beforeHidden.debt + hiddenMs,
    `${order}: 回前景必須完整保留 ${hiddenMs}ms hidden elapsed`);
  assert.equal(timers.size, 1, `${order}: 回前景只能保留一個新 resume timer`);
  assert.equal(resumed.pending, true, `${order}: 舊 callback 不得清掉新的 resume timer handle`);
  assert.equal(tickCalls, beforeHiddenTickCalls, `${order}: lifecycle 競速不得額外執行或略過補跑 tick`);

  fireWindow('pagehide', { persisted: true });
  assert.equal(timers.size, 0, `${order}: pagehide 必須取消 bfcache 前的 resume timer`);
  assert.equal(context.__schedulerState().pending, false, `${order}: pagehide 後不得殘留 timer handle`);
  return resumed;
}

{
  const mobile = evaluatePolicy({ mobile: true });
  assert.deepEqual(
    JSON.parse(JSON.stringify(mobile.__testPolicy())),
    { mobile: true, budgetMs: 12, yieldMs: 48 },
    '手機補算必須採 12ms 工作／48ms 讓步，將持續 duty 壓到約 20%',
  );
  mobile.__setNow(11);
  assert.equal(mobile.__testShouldYield(0, true), false, '手機片段未滿 12ms 可繼續一個 tick');
  mobile.__setNow(12);
  assert.equal(mobile.__testShouldYield(0, true), true, '手機片段滿 12ms 必須立即讓步');
}

{
  const fast = runScheduler({ mobile: true, tickCost: 5, initialDebt: 5_000, saveCost: 4_000 });
  assert.ok(fast.callbacks < 500, '正常手機必須於 callback 上限內追平');
  assert.ok(fast.state.debt < 100, `正常手機補跑後債務應低於一個 tick，實際 ${fast.state.debt}ms`);
  assert.equal(fast.pendingTimers, 0, '追平後不得殘留 timer');
  assert.equal(fast.state.accActive, false, '追平後必須完成摘要收尾');
  assert.equal(fast.now - fast.state.loopLast, 0, '完成前必須重錨，排除補跑 housekeeping wall-time');
  assert.equal(fast.maxPending, 1, '任何時刻最多只能有一個續跑 timer');
  assert.ok(fast.delays.length > 0 && fast.delays.every((delay) => delay === 48),
    '手機續跑必須固定讓出 48ms，不得縮成 0ms tight loop');
  assert.equal(fast.settleCalls, fast.tickCalls, '每個 tick 必須且只能結算一次');
  assert.equal(fast.finishCalls, 1, '整段補跑只能收尾一次');
  assert.equal(fast.saveCalls, 1, '超過 3 秒的補跑只能存檔一次');
  assert.equal(fast.state.loopLast, fast.now, '4 秒大型存檔完成後必須重錨時鐘，不得把 save 成本回灌成新補跑');
  assert.equal(fast.state.debt, Math.max(0, 5_000 - fast.tickCalls * 100),
    '正常補跑只償還進入補跑前既有債務，運算／讓步／大型存檔 housekeeping 不得反向加債');
}

for (const tickCost of [60, 105]) {
  const slow = runScheduler({
    mobile: true, tickCost, initialDebt: 1_000, maxCallbacks: 100, timerOvershoot: 16,
  });
  assert.ok(slow.callbacks < 100, `單 tick ${tickCost}ms 的慢手機必須有限完成，不得永久補跑`);
  assert.equal(slow.pendingTimers, 0, `單 tick ${tickCost}ms 追平後不得殘留 timer`);
  assert.equal(slow.state.accActive, false, `單 tick ${tickCost}ms 追平後必須完成摘要收尾`);
  assert.equal(slow.maxPending, 1, `單 tick ${tickCost}ms 也不得重複排程`);
  assert.ok(slow.tickCalls >= slow.callbacks && slow.tickCalls <= slow.callbacks + 1,
    `手機每批最多一個 ${tickCost}ms tick；提示批次可不跑 tick，但不得強迫多 tick 長任務`);
  assert.ok(slow.delays.every((delay) => delay === 48), `單 tick ${tickCost}ms 仍須保留固定 48ms 讓步`);
  assert.equal(slow.state.debt, Math.max(0, 1_000 - slow.tickCalls * 100),
    `單 tick ${tickCost}ms 必須完整償還既有債務，不得讓運算或 timer lateness 製造永久回授`);
}

{
  const hidden = runScheduler({ mobile: true, tickCost: 20, initialDebt: 1_000, hiddenHeartbeats: 40 });
  assert.equal(hidden.pendingTimers, 0, '背景 heartbeat 不得建立前景 timer');
  assert.equal(hidden.finishCalls, 0, '背景摘要必須保留到回前景統一收尾');
  assert.equal(hidden.state.accActive, true, '背景 40 秒後仍須保留補跑摘要');
  assert.equal(hidden.state.debt, 1_000 + 40_000 - hidden.tickCalls * 100,
    '背景 heartbeat 的等待時間仍須全額入債；只有補跑 housekeeping 暫停遊戲鐘');
  assert.ok(hidden.state.debt > 30_000, '慢速背景 heartbeat 應留下待回前景補跑的真實債務');
}

for (const order of ['timer-first', 'visibility-first']) {
  runVisibilityOrdering(order);
}
runVisibilityOrdering('timer-first-long', 3_600_000);

for (const mobile of [true, false]) {
  const failed = runScheduler({
    mobile, tickCost: 105, initialDebt: 1_000, tickThrows: true, logThrows: true,
  });
  assert.equal(failed.tickCalls, 3, `${mobile ? '手機' : '桌機'}連續 tick 錯誤必須恰好三次後停止`);
  assert.equal(failed.settleCalls, 3, `${mobile ? '手機' : '桌機'}失敗 tick 仍須各結算一次`);
  assert.equal(failed.state.debt, 0, `${mobile ? '手機' : '桌機'}錯誤停損不得被 wall-time 重新加債`);
  assert.equal(failed.pendingTimers, 0, `${mobile ? '手機' : '桌機'}錯誤停損後不得殘留 timer`);
  assert.equal(failed.state.accActive, false, `${mobile ? '手機' : '桌機'}即使 logSys 丟錯也必須清掉摘要`);
  assert.equal(failed.finishCalls, 1, `${mobile ? '手機' : '桌機'}錯誤停損只能收尾一次`);
  assert.equal(failed.saveCalls, 1, `${mobile ? '手機' : '桌機'}錯誤停損必須保存已完成進度`);
}

{
  const desktop = evaluatePolicy({ mobile: false });
  assert.deepEqual(
    JSON.parse(JSON.stringify(desktop.__testPolicy())),
    { mobile: false, budgetMs: 80, yieldMs: 8 },
    '桌機補算速度政策維持 80/8ms，不因手機止血改慢',
  );
}

{
  const pending = evaluatePolicy({ mobile: true, inputPending: true });
  pending.__setNow(1);
  assert.equal(pending.__testShouldYield(0, true), true,
    '瀏覽器回報有待處理輸入時，即使尚未滿 12ms 也必須先讓出');
}

assert.match(core, /\(_ffMobile \|\| \(ran & 3\) === 0\) && _ffShouldYield/,
  '手機必須每一個真實 tick 檢查讓步；桌機才可維持每 4 tick');
assert.match(core, /}, _ffYieldMs\(\)\);/,
  '補算續跑 timer 必須依裝置選擇 48ms 或 8ms');
assert.match(core, /_ffProgressUpdate\(_ffAcc, _tickDebt, true\);[\s\S]{0,180}_ffReanchorCatchupClock\(\)/,
  '首次進度 DOM 後必須重錨補跑虛擬時鐘');
assert.match(core, /_ffReanchorCatchupClock\(\);\s*if \(player\.dead \|\| _ffAcc\.aborted\) _tickDebt = 0/,
  '錯誤／死亡停損必須在補跑 housekeeping 重錨後最後清帳');
assert.match(core, /FF_PROGRESS_INTERVAL_MS = 250/,
  '補跑進度 DOM 必須節流，避免每個手機 tick 都重繪');
assert.match(core, /收尾重繪／大型存檔也屬於 housekeeping/,
  '補跑收尾後必須重錨虛擬時鐘，避免大型存檔觸發 finish-save 回授迴圈');
assert.match(core, /_ffResumeToken !== _ffResumeGeneration/,
  '已取消但進入 task queue 的舊 resume callback 必須由 generation token 擋下');
assert.match(drops, /document\.hidden[\s\S]{0,220}_ffCancelScheduledLoop/,
  '切到背景時必須取消前景 resume timer，避免回前景競速吞掉 hidden elapsed');
assert.match(drops, /addEventListener\('pagehide'[\s\S]{0,180}_ffCancelScheduledLoop/,
  'pagehide／bfcache 也必須取消前景 resume timer');
assert.doesNotMatch(core, /overloadDroppedMs|FF_MOBILE_MAX_CATCHUP_WALL_MS|adaptiveMinTicks/,
  '穩定性修正不得用 wall cap、強迫多 tick 或 dropped debt 略過進度');
assert.match(patcher, /function patchMobileCatchupScheduler\(\)/,
  '上游同步後必須重套手機補算排程政策');

console.log('PASS mobile catchup budget: 12/48ms、逐 tick、慢 tick 有限完成、hidden 入債、前後景 task ordering、timer 競速與錯誤停損');
