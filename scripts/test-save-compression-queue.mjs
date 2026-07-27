import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/00-data.js', import.meta.url), 'utf8');
const syncCompressSource = await readFile(new URL('../afk-synccompress.js', import.meta.url), 'utf8');
const shopSaveSource = await readFile(new URL('../js/13-shop-save.js', import.meta.url), 'utf8');
const start = source.indexOf('var _FS =');
const end = source.indexOf('// 解壓讀取：', start);
assert.ok(start >= 0 && end > start, '找不到 js/00 儲存／壓縮區塊');

const storage = new Map();
let revoked = 0;
let workerUrlSeq = 0;
const workers = [];
let timerSeq = 0;
const timers = new Map();
let failNextWorkerConstruction = false;

class FakeWorker {
  constructor(url) {
    if (failNextWorkerConstruction) {
      failNextWorkerConstruction = false;
      throw new Error('worker blocked');
    }
    this.url = url;
    this.messages = [];
    this.terminated = false;
    workers.push(this);
  }
  postMessage(message) {
    this.messages.push({ ...message });
  }
  terminate() {
    this.terminated = true;
  }
}

const context = {
  window: {},
  document: { documentElement: { classList: { add() {} } } },
  localStorage: {
    get length() { return storage.size; },
    key(index) { return Array.from(storage.keys())[index] ?? null; },
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  },
  Worker: FakeWorker,
  Blob: class FakeBlob { constructor(parts, options) { this.parts = parts; this.options = options; } },
  URL: {
    createObjectURL() { return `blob:test-${++workerUrlSeq}`; },
    revokeObjectURL() { revoked++; },
  },
  LZString: {
    _compress(value) { return String(value); },
    compressToUTF16(value) { return `packed:${value}`; },
  },
  setTimeout(fn, delay = 0) {
    const id = ++timerSeq;
    if (delay === 0) fn();
    else timers.set(id, { fn, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  console: { log() {}, warn() {}, error() {} },
};
context.window = context;

vm.runInNewContext(source.slice(start, end), context, { filename: 'js/00-data-storage-slice.js' });

const latest = {};
const keys = ['slot-a', 'slot-b', 'pets-main', 'pets-backup'];
for (let round = 0; round < 80; round++) {
  for (const key of keys) {
    const value = JSON.stringify({ key, round, payload: key.repeat(12000) });
    latest[key] = value;
    assert.equal(context._lzSet(key, value), true, '原文同步落地必須成功');
  }
}

assert.equal(workers.length, 1, '整個 session 只應建立一個壓縮 Worker');
assert.equal(workers[0].messages.length, 1, 'Worker 全域同時只可有一個執行中工作');
assert.ok(Object.keys(context._lzWorkerPending).length <= keys.length,
  '每個 key 最多只可保留一個最新 pending 工作');
assert.ok(Object.keys(context._lzWorkerRaw).length <= keys.length + 1,
  '主執行緒不得保留所有舊 revision 的完整 raw 字串');
for (const key of keys) {
  assert.equal(storage.get(key), latest[key], '壓縮完成前，最新原文必須已經同步持久化');
}

let completed = 0;
while (context._lzWorkerActive || Object.keys(context._lzWorkerPending).length || workers[0].messages.length) {
  const job = workers[0].messages.shift();
  assert.ok(job, 'active 工作必須有對應 Worker 訊息');
  workers[0].onmessage({
    data: { id: job.id, key: job.key, rev: job.rev, packed: `LZ1:packed:${job.value}` },
  });
  completed++;
  assert.ok(completed <= keys.length + 1, '80 輪寫入不應壓縮超過 active 一份加每 key 最新一份');
}

for (const key of keys) {
  assert.equal(storage.get(key), `LZ1:packed:${latest[key]}`, '佇列排空後只可寫回最新 revision 的壓縮值');
}
assert.equal(Object.keys(context._lzWorkerRaw).length, 0, '佇列排空後不得殘留 raw 參照');
assert.equal(revoked, 1, 'Worker Blob URL 建立後必須立即 revoke');

// 直接還原／移除會取消同 key 的 pending 或 active raw guard，舊 Worker 回覆不得蓋回去。
context._lzSet('slot-a', 'queued-old');
context._lzSet('slot-b', 'queued-other');
context._lzSetStoredRaw('slot-a', 'restored-raw');
const stale = workers[0].messages.shift();
workers[0].onmessage({
  data: { id: stale.id, key: stale.key, rev: stale.rev, packed: 'LZ1:stale' },
});
assert.equal(storage.get('slot-a'), 'restored-raw', '直接還原後，舊壓縮回覆不得覆蓋新原文');

// Worker 無回覆也無 onerror 時，watchdog 必須終止它並讓後續存檔換新 Worker 繼續壓縮。
const hung = workers[0].messages.shift();
assert.ok(hung, 'stale 測試後應有一份刻意不回覆的 active 工作');
const watchdog = Array.from(timers.entries()).find(([, timer]) => timer.delay === 15000);
assert.ok(watchdog, 'active 工作必須安裝 15 秒 watchdog');
timers.delete(watchdog[0]);
watchdog[1].fn();
assert.equal(workers[0].terminated, true, 'watchdog 必須終止無回覆的 Worker');
assert.equal(workers.length, 1, '佇列已空時 watchdog 不得無限重建 Worker');
assert.equal(context._lzWorker, null, '逾時 Worker 必須退役，等待下一份存檔再建立');
assert.equal(storage.get(hung.key), hung.value, '逾時工作仍須保留先前同步落地的原文');

context._lzSet('slot-c', 'after-watchdog');
assert.equal(workers.length, 2, 'watchdog 後的下一份存檔必須建立替代 Worker');
const recovered = workers[1].messages.shift();
assert.ok(recovered, 'watchdog 後的新存檔必須交給替代 Worker');
workers[0].onerror(new Error('late old worker error'));
assert.equal(workers[1].terminated, false, '舊 Worker 的延遲 error 不得終止替代 Worker');
assert.equal(context._lzWorkerActive?.id, recovered.id, '舊 Worker error 不得清掉替代 Worker 的 active 工作');
workers[0].onmessage({
  data: { id: hung.id, key: hung.key, rev: hung.rev, packed: 'LZ1:late-old-worker' },
});
assert.equal(context._lzWorkerActive?.id, recovered.id, '舊 Worker 訊息不得清掉替代 Worker 的 active 工作');
workers[1].onmessage({
  data: { id: recovered.id, key: recovered.key, rev: recovered.rev, packed: 'LZ1:after-watchdog' },
});
assert.equal(storage.get('slot-c'), 'LZ1:after-watchdog', '替代 Worker 必須能完成後續壓縮');

// 同步壓縮開關插入 active/pending 中間時，舊 async 回覆不得蓋新值，關閉後 async 仍能排空。
let syncCompressEnabled = false;
context.AFK_TOGGLES = {
  register() {},
  enabled(id) { return id === 'synccompress' && syncCompressEnabled; },
};
vm.runInNewContext(syncCompressSource, context, { filename: 'afk-synccompress.js' });
context._lzSet('race-a', 'async-a1'); // active
context._lzSet('race-a', 'async-a2'); // 同 key 最新 pending
context._lzSet('race-b', 'async-b1'); // 另一 key pending
const asyncA1 = workers[1].messages.shift();
assert.equal(context._lzWorkerPending['race-a']?.value, 'async-a2',
  '同步開關前必須確實存在同 key pending，才能驗證取消路徑');
syncCompressEnabled = true;
context._lzSet('race-a', 'sync-a3');
assert.equal(context._lzWorkerPending['race-a'], undefined,
  '同步壓縮必須立即移除同 key pending，不能繼續白做完整壓縮');
assert.equal(Object.keys(context._lzWorkerRaw).some((key) => key.startsWith('race-a@')), false,
  '同步壓縮必須立即釋放同 key active／pending 的主線 raw 參照');
workers[1].onmessage({
  data: { id: asyncA1.id, key: asyncA1.key, rev: asyncA1.rev, packed: 'LZ1:stale-async-a1' },
});
assert.equal(storage.get('race-a'), 'LZ1:packed:sync-a3', '同步壓縮值不得被舊 async 回覆覆蓋');
const asyncB1 = workers[1].messages.shift();
workers[1].onmessage({
  data: { id: asyncB1.id, key: asyncB1.key, rev: asyncB1.rev, packed: 'LZ1:packed:async-b1' },
});
syncCompressEnabled = false;
context._lzSet('race-a', 'async-a3');
const asyncA3 = workers[1].messages.shift();
workers[1].onmessage({
  data: { id: asyncA3.id, key: asyncA3.key, rev: asyncA3.rev, packed: 'LZ1:packed:async-a3' },
});
assert.equal(storage.get('race-a'), 'LZ1:packed:async-a3', '關閉同步壓縮後，async queue 必須恢復並寫回最新值');
assert.equal(storage.get('race-b'), 'LZ1:packed:async-b1', '其他 key 的 pending 不得被同步壓縮切換丟失');
assert.equal(context._lzWorkerActive, null, '競態測試後 active 必須排空');
assert.equal(Object.keys(context._lzWorkerPending).length, 0, '競態測試後 pending 必須排空');
assert.equal(Object.keys(context._lzWorkerRaw).length, 0, '競態測試後 raw guard 必須排空');

// Worker constructor 被 CSP／安全策略拒絕時，createObjectURL 也必須在 finally 釋放。
context._lzWorker = null;
context._resetLzCompressionQueue();
const revokedBeforeFailure = revoked;
failNextWorkerConstruction = true;
context._lzSet('worker-blocked', 'durable-raw');
assert.equal(storage.get('worker-blocked'), 'durable-raw', 'Worker 建立失敗時仍須保留同步落地原文');
assert.equal(revoked, revokedBeforeFailure + 1, 'Worker constructor 丟錯時也必須 revoke Blob URL');
assert.equal(context._lzWorker, null, 'Worker 建立失敗後不得留下半初始化實例');

// visibilitychange / pagehide / beforeunload 會連續發生；成功後 250ms 內只寫一次，
// 但失敗不得鎖住下一個事件的救援重試。
{
  const closeStart = shopSaveSource.indexOf('let _lastCloseFlushAt =');
  const closeEnd = shopSaveSource.indexOf('// 🗑️ v3.5.83 移除 openSlotSelect', closeStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart, '找不到關頁最終存檔區塊');
  let now = 1000;
  let saveCalls = 0;
  let forgetCalls = 0;
  const flushFlags = [];
  const saveResults = [];
  const documentListeners = {};
  const windowListeners = {};
  const closeContext = {
    player: { cls: 'elf' },
    performance: { now: () => now },
    saveGame() {
      saveCalls++;
      flushFlags.push(closeContext.window.__fb5CloseFlush);
      return saveResults.length ? saveResults.shift() : true;
    },
    _roleSessionForget() { forgetCalls++; },
    document: {
      hidden: true,
      addEventListener(type, fn) { documentListeners[type] = fn; },
    },
    window: {
      addEventListener(type, fn) { windowListeners[type] = fn; },
    },
  };
  vm.runInNewContext(shopSaveSource.slice(closeStart, closeEnd), closeContext, {
    filename: 'js/13-close-flush-slice.js',
  });

  documentListeners.visibilitychange();
  windowListeners.pagehide();
  windowListeners.beforeunload();
  assert.equal(saveCalls, 1, '同一輪三個關頁事件只能成功存檔一次');
  assert.equal(forgetCalls, 2, 'pagehide / beforeunload 仍須各自清除角色 session');

  now += 300;
  windowListeners.pagehide();
  assert.equal(saveCalls, 2, '超過去重窗口後必須允許下一次最終存檔');

  now += 300;
  saveResults.push(false, true);
  documentListeners.visibilitychange();
  now += 10;
  windowListeners.beforeunload();
  assert.equal(saveCalls, 4, '存檔失敗後，下一個事件必須立即救援重試');
  assert.deepEqual(flushFlags, [true, true, true, true], 'saveGame 執行期間必須固定帶關頁繞過旗標');
  assert.equal(closeContext.window.__fb5CloseFlush, false, '每次存檔後必須清除關頁旗標');
}

console.log('✅ 存檔壓縮佇列：有界 queue、世代隔離、watchdog、Blob 釋放、關頁去重／重試與同步壓縮競態全部通過。');
