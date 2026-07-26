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
  3,
  '快速事件、BOSS 真打、一般真模擬三條路都必須驅動離線召王'
);

console.log('PASS offline bossring: summon / buy / no double charge / mutex / cache / slot isolation');
