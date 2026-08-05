import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const core = await readFile(new URL('../js/03-combat-core.js', import.meta.url), 'utf8');
const patcher = await readFile(new URL('./apply-core-patches.mjs', import.meta.url), 'utf8');

const policyStart = core.indexOf('// ⏩ 補跑專用快速排程：桌機維持 80/8ms');
const policyEnd = core.indexOf('function _ffProgressEnsure()', policyStart);
assert.ok(policyStart >= 0 && policyEnd > policyStart, '應能擷取手機補算排程政策');
const policySource = core.slice(policyStart, policyEnd);

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
assert.match(patcher, /function patchMobileCatchupScheduler\(\)/,
  '上游同步後必須重套手機補算排程政策');

console.log('PASS mobile catchup budget: 12/48ms、逐 tick 與輸入優先讓步');
