import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bossringSource = readFileSync('afk-bossring.js', 'utf8');
const offlineSource = readFileSync('afk-offline.js', 'utf8');

function makeHarness(options = {}) {
  const store = new Map(Object.entries(options.storage || {}));
  const timers = [];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    currentSlot: options.slot || 1,
    state: {
      running: true,
      ff: options.ff !== false,
      ticks: options.ticks || 1000,
      oblivion: null,
      antharas: null,
      prideClimb: false,
      prideRanked: false,
      riftRun: false
    },
    mapState: {
      current: options.map || 'field',
      mobs: [],
      forceBoss: false
    },
    player: {
      inv: options.scrolls === 0 ? [] : [{ id: 'scroll_teleport', uid: 'scroll-1', cnt: options.scrolls || 3 }],
      eq: {},
      gold: options.gold == null ? 1000 : options.gold
    },
    DB: {
      maps: {
        field: ['mob-normal', 'mob-boss'],
        empty: ['mob-normal'],
        hidden_parent: ['mob-normal', 'mob-boss']
      },
      mobs: {
        'mob-normal': { n: '一般怪' },
        'mob-boss': { n: '測試頭目', boss: true }
      },
      items: {
        scroll_teleport: { p: 100 }
      }
    },
    KING_ROOMS: {},
    PURE_BOSS_MAPS: [],
    HIDDEN_AREA_PARENT: { hidden_parent: 'hidden_child' },
    AFK_TOGGLES: { enabled: () => true },
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); }
    },
    document: {
      getElementById() { return null; },
      createElement() {
        return {
          className: '',
          innerHTML: '',
          querySelector() { return null; }
        };
      }
    },
    setInterval(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    isSiegeArea: () => false,
    prideTeleportBlocked: () => false,
    hasTeleportRing() { return context.hasRing !== false; },
    shopPrice(value) { return value; },
    gainItem(id, cnt) {
      let item = context.player.inv.find(x => x && x.id === id);
      if (item) item.cnt = (item.cnt || 1) + cnt;
      else context.player.inv.push({ id, uid: `bought-${id}`, cnt });
    },
    useItem(uid, silent, keepModal) {
      context.useCalls.push({ uid, silent, keepModal });
      if (context.blockUse) return;
      const index = context.player.inv.findIndex(x => x && x.uid === uid);
      if (index < 0) return;
      const item = context.player.inv[index];
      if ((item.cnt || 1) > 1) item.cnt -= 1;
      else context.player.inv.splice(index, 1);
      context.mapState.mobs = [null, null, null, null, null];
      context.mapState.forceBoss = !silent && context.hasTeleportRing();
    },
    useCalls: [],
    blockUse: false,
    hasRing: options.hasRing !== false
  };
  context.window = context;
  context.__afk = { isCatchingUp: () => context.catchingUp !== false };
  context.catchingUp = options.catchingUp !== false;

  vm.createContext(context);
  vm.runInContext(bossringSource, context, { filename: 'afk-bossring.js' });
  return { context, api: context.AFK_BOSSRING, timers, store };
}

{
  const { context, api, timers } = makeHarness();
  assert.equal(timers.length, 2, '應保留 UI 注入與線上召王兩個 timer');
  assert.deepEqual(JSON.parse(JSON.stringify(api.signature())), { on: true, ring: true });
  assert.equal(api.huntActive(), true, '離線結算中應維持找王/避王互斥');
  assert.equal(api.offlineStep(1000), 'used');
  assert.equal(context.useCalls.length, 1);
  assert.deepEqual(context.useCalls[0], { uid: 'scroll-1', silent: false, keepModal: true });
  assert.equal(context.player.inv[0].cnt, 2, '每次召王只扣一張卷軸');
  assert.equal(context.mapState.forceBoss, true);
  assert.equal(api.offlineStep(1000), 'waiting', '已排定 BOSS 時不可重複耗卷');
  assert.equal(context.useCalls.length, 1);
}

{
  const { context, api } = makeHarness({ scrolls: 0, gold: 100 });
  assert.equal(api.offlineStep(1000), 'used', '缺卷時應依既有規則自動買一張再召王');
  assert.equal(context.player.gold, 0);
  assert.equal(context.player.inv.some(x => x.id === 'scroll_teleport'), false, '買來的一張應恰好被消耗');
  assert.equal(context.useCalls.length, 1);
}

{
  const { context, api } = makeHarness();
  assert.equal(api.offlineStep(99), 'ending', '結算剩不到生怪等待時間時不可再白耗卷軸');
  assert.equal(context.useCalls.length, 0);
}

{
  const { context, api } = makeHarness({ catchingUp: false });
  assert.equal(api.huntActive(), false, '一般 state.ff／背景補跑不可冒充離線掛機');
  assert.equal(api.offlineStep(1000), 'inactive');
  assert.equal(context.useCalls.length, 0);
}

{
  const { context, api } = makeHarness({ map: 'hidden_parent' });
  assert.equal(api.huntActive(), false, '會進隱藏區域的母地圖必須維持排除');
  assert.equal(api.offlineStep(1000), 'excluded');
  assert.equal(context.useCalls.length, 0);
}

{
  const { context, api } = makeHarness({ scrolls: 3 });
  context.blockUse = true;
  assert.equal(api.offlineStep(1000), 'blocked');
  context.blockUse = false;
  context.currentSlot = 2;
  assert.equal(api.offlineStep(1000), 'used', '等待期限必須依存檔位分開');
  assert.equal(context.useCalls.length, 2);
}

{
  const { context, api } = makeHarness({ storage: { afk_bossring_on_1: '0' } });
  assert.equal(api.signature().on, false);
  assert.equal(api.huntActive(), false);
  assert.equal(api.offlineStep(1000), 'off');
  assert.equal(context.useCalls.length, 0);
}

assert.ok(offlineSource.includes('// 🔒 Jesper offline boss hunt settlement bridge v1'));
assert.ok(offlineSource.includes('bossring:offlineBossHuntSignature()'), '快取簽章必須納入開關與戒指');
assert.ok(
  offlineSource.includes("if (k === 'scroll_teleport' && offlineBossHuntActive()) continue"),
  '快速結算不得把精確扣除的召王卷軸再按取樣耗率扣一次'
);
assert.ok(
  offlineSource.includes('if (offlineBossHuntActive()) return false'),
  '快速結算的避王路徑必須與自動找王互斥'
);
assert.equal(
  (offlineSource.match(/offlineBossHuntStep\(totalTicks - done\)/g) || []).length,
  4,
  '快速事件、BOSS 事件重播、BOSS 真打、一般真模擬四條路都必須驅動離線召王'
);

// 瘋狂席琳的 Boss 可能在戰鬥途中才取得恩賜並回滿、HP ×10；
// 同名 Boss 必須拆成 normal／grace，重播期間仍由核心 spawn 路徑判定途中恩賜。
assert.ok(
  offlineSource.includes('// 🔒 Jesper Crazy Sherine Boss event cache v2'),
  '瘋狂席琳 Boss 雙快取事件重播補丁必須存在'
);
assert.ok(
  offlineSource.includes("OFFSTATS_RULESET = 'pp-v3.8.34+shines-v3.8.27-content-r4-grace-events'"),
  '規則版必須提升，讓舊的 3131 tick 等污染快取失效'
);
assert.ok(
  offlineSource.includes('row = bossStats[name] = { normal: null, grace: null }'),
  '瘋狂席琳同名 Boss 必須建立 normal／grace 雙槽'
);
assert.ok(
  offlineSource.includes("var _bossVariant = (_m0._grace ? 'grace' : 'normal')"),
  '讀取快取前必須依 Boss 當下是否恩賜選擇 variant'
);
assert.ok(
  offlineSource.includes('maybeSpawnMobs();                            // 唯一出怪／唯一恩賜 RNG 路徑'),
  '事件重播的恩賜判定必須只走核心出怪路徑'
);
assert.ok(
  offlineSource.includes('bossReplaySwitchGrace(replay, boss)'),
  'normal 重播途中取得恩賜時必須切換 grace'
);
assert.ok(
  offlineSource.includes('_entryB[_doneBossVariant] = bossMergeProfile'),
  '完成真打只能寫入本次 normal 或 grace 槽'
);
assert.ok(
  offlineSource.includes('var _provedB = !!fastBossActualKill'),
  'Boss UID 消失不可當成擊殺，必須由正式 killMob hook 證明'
);
assert.ok(
  !offlineSource.includes('var bossCacheEnabled = !player.sherineMad'),
  '不得殘留瘋狂席琳每隻 Boss 全逐拍的舊總閘'
);

// 背景結算 ticker 的 Worker 若收不到回覆，fallback timeout 必須在每個 slice
// 當下解除 message listener；長結算不可累積到 finally 才靠 terminate 一次回收。
{
  const tickerStart = offlineSource.indexOf('  var _ticker = null, _tickerBad = false');
  const tickerEnd = offlineSource.indexOf('  // 結算進行中時指向當下那一輪的檢查點函式', tickerStart);
  assert.ok(tickerStart >= 0 && tickerEnd > tickerStart, '應能擷取現行離線 ticker 實作');

  const scheduled = new Map();
  let timerSeq = 0;
  let createdUrls = 0;
  let revokedUrls = 0;
  let liveUrls = 0;
  let peakUrls = 0;
  const workers = [];

  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.listeners = new Set();
      this.peakListeners = 0;
      this.throwOnPost = false;
      this.terminated = false;
      workers.push(this);
    }
    addEventListener(type, fn) {
      if (type !== 'message') return;
      this.listeners.add(fn);
      this.peakListeners = Math.max(this.peakListeners, this.listeners.size);
    }
    removeEventListener(type, fn) {
      if (type === 'message') this.listeners.delete(fn);
    }
    postMessage() {
      if (this.throwOnPost) throw new Error('postMessage failed');
      this.lastRequest = arguments[0];
      // 刻意不回覆；測 fallback timeout 路徑。
    }
    emit(id = this.lastRequest && this.lastRequest.id) {
      for (const listener of [...this.listeners]) listener({ data: { id } });
    }
    terminate() {
      this.terminated = true;
      this.listeners.clear();
    }
  }

  const tickerContext = {
    Blob: class Blob {},
    Worker: FakeWorker,
    URL: {
      createObjectURL() {
        createdUrls++;
        liveUrls++;
        peakUrls = Math.max(peakUrls, liveUrls);
        return `blob:offline-${createdUrls}`;
      },
      revokeObjectURL() {
        revokedUrls++;
        liveUrls--;
      }
    },
    setTimeout(fn) {
      const id = ++timerSeq;
      scheduled.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      scheduled.delete(id);
    },
    Promise
  };
  tickerContext.window = tickerContext;
  vm.createContext(tickerContext);
  vm.runInContext(offlineSource.slice(tickerStart, tickerEnd), tickerContext, {
    filename: 'afk-offline-ticker.js'
  });

  for (let slice = 0; slice < 100; slice++) {
    const waiting = tickerContext.workerGap(16);
    assert.equal(workers.length, 1, '同一輪結算只能共用一支 ticker Worker');
    assert.equal(workers[0].listeners.size, 1, '等待中的 slice 恰有一支 listener');
    assert.equal(scheduled.size, 1, '等待中的 slice 恰有一支 fallback timer');
    const fallback = scheduled.values().next().value;
    fallback();
    await waiting;
    assert.equal(workers[0].listeners.size, 0, `第 ${slice + 1} 個逾時 slice 必須立即解除 listener`);
    assert.equal(scheduled.size, 0, `第 ${slice + 1} 個逾時 slice 不得留下 timer`);
  }

  const normalReply = tickerContext.workerGap(16);
  workers[0].emit(workers[0].lastRequest.id - 1);
  assert.equal(workers[0].listeners.size, 1, '上一個 slice 的延遲訊息不得提早完成目前等待');
  assert.equal(scheduled.size, 1, '延遲訊息不得取消目前 slice 的 fallback timer');
  workers[0].emit();
  await normalReply;
  assert.equal(workers[0].listeners.size, 0, '正常 Worker 回覆也必須立即解除 listener');
  assert.equal(scheduled.size, 0, '正常 Worker 回覆必須取消 fallback timer');

  workers[0].throwOnPost = true;
  await tickerContext.workerGap(16);
  assert.equal(workers[0].listeners.size, 0, 'postMessage 失敗必須立即解除 listener');
  assert.equal(scheduled.size, 0, 'postMessage 失敗必須取消 fallback timer');

  tickerContext.killTicker();
  assert.equal(workers[0].terminated, true, '結算結束必須 terminate ticker Worker');
  assert.equal(workers[0].peakListeners, 1, '任意時刻最多只允許一支 slice listener');
  assert.equal(createdUrls, 1, '單次結算只建立一個 ticker Blob URL');
  assert.equal(revokedUrls, 1, 'ticker Blob URL 必須同步撤銷');
  assert.equal(liveUrls, 0, 'ticker() 返回後不得留 Blob URL');
  assert.equal(peakUrls, 1, 'Blob URL 瞬時峰值應為一個');
}

console.log('PASS offline bossring: summon / buy / no double charge / mutex / cache / slot isolation / Crazy Sherine boss event cache');
