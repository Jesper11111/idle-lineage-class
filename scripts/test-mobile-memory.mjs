import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const plugin = await readFile(new URL('../afk-mobile-memory.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../js/13-shop-save.js', import.meta.url), 'utf8');
const dropsCore = await readFile(new URL('../js/01-drops-config.js', import.meta.url), 'utf8');
const vfxCore = await readFile(new URL('../js/09-vfx-render.js', import.meta.url), 'utf8');
const progressionCore = await readFile(new URL('../js/05-kill-progression.js', import.meta.url), 'utf8');
const worldCore = await readFile(new URL('../js/11-world-map.js', import.meta.url), 'utf8');
const petCore = await readFile(new URL('../js/22-pets.js', import.meta.url), 'utf8');
const marketCore = await readFile(new URL('../js/24-pandora-relic-market.js', import.meta.url), 'utf8');
const cardCore = await readFile(new URL('../js/15-cards.js', import.meta.url), 'utf8');
const trainingPlugin = await readFile(new URL('../afk-training.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sync = await readFile(new URL('./sync-upstream.mjs', import.meta.url), 'utf8');
const policyBlock = await readFile(new URL('./local-policy-block.html', import.meta.url), 'utf8');
const assetExcludes = await readFile(new URL('./shines-backport-assets.txt', import.meta.url), 'utf8');

function createHarness({
  mobile = true,
  mobileClass = mobile,
  noanim = true,
  lowfps = true,
  powersave = true,
  width = mobile ? 390 : 1280,
  coarse = mobile,
  userAgent = mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' : 'Desktop',
  readyState = 'complete',
} = {}) {
  let mobileState = mobile;
  const values = new Map([
    ['afk_ps_noanim', noanim ? '1' : '0'],
    ['afk_ps_lowfps', lowfps ? '1' : '0'],
  ]);
  const classNames = new Set(mobileClass ? ['m-mobile'] : []);
  const rootClassNames = new Set();
  const makeClasses = (names = classNames) => ({
    add: (...next) => next.forEach((name) => names.add(name)),
    remove: (...next) => next.forEach((name) => names.delete(name)),
    contains: (name) => names.has(name),
    toggle: (name, force) => {
      const enabled = force === undefined ? !names.has(name) : !!force;
      if (enabled) names.add(name); else names.delete(name);
      return enabled;
    },
  });
  const battle = { style: {}, classList: makeClasses() };
  const town = { style: {}, classList: makeClasses() };
  let areaCalls = 0;
  let townCalls = 0;
  let probeCancelCalls = 0;
  let startGameCalls = 0;
  const logs = [];
  const timers = [];
  const cachedImage = {
    src: 'assets/anim/test/idle_0.png',
    srcset: 'assets/anim/test/idle_0@2x.png 2x',
    removed: [],
    onload() {},
    onerror() {},
    removeAttribute(name) {
      this.removed.push(name);
      if (name === 'src') this.src = '';
      if (name === 'srcset') this.srcset = '';
    },
  };
  const mobCache = { test: { idle: [cachedImage] } };
  const state = { ff: false };
  const document = {
    body: { classList: makeClasses() },
    documentElement: { classList: makeClasses(rootClassNames) },
    readyState,
    addEventListener() {},
    getElementById(id) {
      return id === 'battle-view' ? battle : (id === 'town-view' ? town : null);
    },
  };
  const window = {
    innerWidth: width,
    navigator: { userAgent },
    matchMedia: () => ({ matches: coarse }),
    AFK_TOGGLES: { enabled: (id) => id !== 'powersave' || powersave },
    applyAreaBackground() {
      areaCalls++;
      battle.style.backgroundImage = 'url("assets/area/1920x1080/full.jpg")';
    },
    _townMapBg() {
      townCalls++;
      return 'url("assets/area/1920x1080/town.jpg")';
    },
    __afkCancelImageProbes() { probeCancelCalls++; },
    startGameTimers() { startGameCalls++; },
  };
  const context = {
    window,
    document,
    mapState: { current: 'field' },
    state,
    _mobAnimCache: mobCache,
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    console: { log: (line) => logs.push(String(line)) },
  };
  vm.runInNewContext(plugin, context, { filename: 'afk-mobile-memory.js' });
  return {
    window, battle, town, logs, values, timers, state, mobCache, cachedImage, rootClassNames,
    areaCalls: () => areaCalls,
    townCalls: () => townCalls,
    probeCancelCalls: () => probeCancelCalls,
    startGameCalls: () => startGameCalls,
    runNextTimer() {
      const fn = timers.shift();
      if (typeof fn === 'function') fn();
    },
    setMobile(next) {
      mobileState = !!next;
      window.innerWidth = mobileState ? 390 : 1280;
      if (mobileState) classNames.add('m-mobile'); else classNames.delete('m-mobile');
    },
  };
}

function createProbeHarness(knownFrames, {
  mobile = true,
  constructorFailures = 0,
  srcFailures = 0,
} = {}) {
  let mobileState = mobile;
  const start = vfxCore.indexOf('function _probeFramesWin(');
  const end = vfxCore.indexOf('function _mobAnimProbe(', start);
  assert.ok(start >= 0 && end > start, '應能擷取現行 _probeFramesWin 實作');
  const images = [];
  class ControlledImage {
    constructor() {
      if (constructorFailures > 0) {
        constructorFailures--;
        throw new Error('Image constructor failed synchronously');
      }
      this.onload = null;
      this.onerror = null;
      this._src = '';
      this.removed = false;
      images.push(this);
    }
    get src() { return this._src; }
    set src(value) {
      if (srcFailures > 0) {
        srcFailures--;
        throw new Error('Image src failed synchronously');
      }
      this._src = String(value);
    }
    removeAttribute(name) {
      if (name !== 'src') return;
      this._src = '';
      this.removed = true;
    }
    succeed() {
      const handler = this.onload;
      if (handler) handler();
    }
    fail() {
      const handler = this.onerror;
      if (handler) handler();
    }
  }
  const document = {
    body: { classList: { contains: (name) => mobileState && name === 'm-mobile' } },
  };
  const window = {
    innerWidth: mobileState ? 390 : 1280,
    matchMedia: () => ({ matches: mobileState }),
  };
  const context = { Image: ControlledImage, __knownFrames: knownFrames, document, window };
  const source = `function _manifestCount() { return globalThis.__knownFrames; }
${vfxCore.slice(start, end)}
globalThis.__probeFramesWin = _probeFramesWin;`;
  vm.runInNewContext(source, context, { filename: 'probe-frames-win.js' });
  return {
    probe: context.__probeFramesWin,
    images,
    window,
    setMobile(next) {
      mobileState = !!next;
      window.innerWidth = mobileState ? 390 : 1280;
    },
  };
}

{
  const { probe, images } = createProbeHarness(10);
  let result = null, calls = 0;
  probe(i => `known-${i}.png`, 40, 2, (frames, count, cancelled) => {
    calls++;
    result = { frames, count, cancelled };
  }, () => true);
  assert.equal(images.length, 6, 'manifest 已知幀數也只能先建立 6 張 Image');
  for (let i = 0; i < 10; i++) {
    assert.ok(images[i], `第 ${i} 幀應由窗口逐步補入`);
    images[i].succeed();
    assert.ok(images.length <= Math.min(10, i + 7), '每完成一張至多補入一張，不得一次解碼整套 manifest');
  }
  assert.equal(calls, 1, '正常 probe 只能完成一次');
  assert.equal(result.count, 10);
  assert.equal(result.cancelled, false);
  assert.equal(result.frames.length, 10);
  assert.ok(images.every(image => !image.removed), '已交付快取的正常幀不可被卸載');
}

{
  const { probe, images } = createProbeHarness(20);
  let current = true, result = null, calls = 0;
  probe(i => `cancel-${i}.png`, 40, 2, (frames, count, cancelled) => {
    calls++;
    result = { frames, count, cancelled };
  }, () => current);
  assert.equal(images.length, 6, '取消測試起始窗口必須固定為 6');
  current = false;
  images[0].succeed();
  assert.equal(images.length, 6, 'epoch 失效後不得再補排任何 Image');
  assert.equal(calls, 1, '取消只能回呼一次');
  assert.equal(result.cancelled, true, '取消結果必須明確標記，呼叫端才不會改試下一個前綴');
  assert.equal(result.frames, null);
  assert.equal(result.count, 0);
  assert.ok(images.every(image => image.removed && image.src === ''),
    'epoch 失效後，已完成與尚在途的舊 Image 都必須撤掉 src');
  assert.ok(images.every(image => image.onload === null && image.onerror === null),
    '取消後不得留下可回填快取的事件 handler');
  images.slice(1).forEach(image => image.succeed());
  assert.equal(calls, 1, '已撤銷 Image 的遲到事件不得再次完成 probe');
}

{
  const { probe, images } = createProbeHarness(null);
  let result = null;
  probe(i => `fallback-${i}.png`, 40, 2, (frames, count, cancelled) => {
    result = { frames, count, cancelled };
  }, () => true);
  images[5].succeed();   // 模擬高編號先解碼完成；稍後發現缺號時也必須釋放
  images[2].fail();
  assert.ok(images.slice(3).every(image => image.removed),
    '404 已確定連續段終點後，較後面的已解碼與在途探測都必須立即卸載');
  images[0].succeed();
  images[1].succeed();
  assert.equal(result.cancelled, false);
  assert.equal(result.count, 2);
  assert.equal(result.frames.length, 2);
}

{
  const { probe, images, window } = createProbeHarness(20);
  const results = [];
  for (let sequence = 0; sequence < 20; sequence++) {
    probe(i => `mobile-${sequence}-${i}.png`, 40, 2, (frames, count, cancelled) => {
      results.push({ frames, count, cancelled });
    }, () => true);
  }
  assert.equal(images.length, 6,
    '手機不論同時啟動多少 mob／玩家／寵物序列，全域只能建立 6 張在途 Image');
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.__afkImageProbeStats())),
    { active: 6, queued: 114, groups: 20, cap: 6 },
    '手機 aggregate probe 應共用同一個 semaphore，而非每序列各自 6 張'
  );
  window.__afkCancelImageProbes();
  assert.equal(results.length, 20, 'epoch invalidation 必須同步取消全部 probe group');
  assert.ok(results.every(result => result.cancelled && result.frames === null && result.count === 0),
    '全域取消不得交付任何舊 epoch 幀');
  assert.ok(images.every(image => image.removed && image.src === '' &&
    image.onload === null && image.onerror === null),
  '全域取消必須立即卸下所有 active Image，不能等待 load/error');
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.__afkImageProbeStats())),
    { active: 0, queued: 0, groups: 0, cap: 6 },
    'epoch invalidation 後 active、queued、group 都必須歸零'
  );
  images.forEach(image => image.succeed());
  assert.equal(results.length, 20, '已取消 Image 的遲到事件不得再次完成 probe');
}

{
  const { probe, images, window } = createProbeHarness(20, { mobile: false });
  for (let sequence = 0; sequence < 4; sequence++) {
    probe(i => `desktop-${sequence}-${i}.png`, 40, 2, () => {}, () => true);
  }
  assert.equal(images.length, 12, '桌機 probe 也必須有 12 張的合理全域上限');
  assert.equal(window.__afkImageProbeStats().cap, 12);
  window.__afkCancelImageProbes();
}

{
  const { probe, images, window, setMobile } = createProbeHarness(20, { mobile: false });
  const results = [];
  for (let sequence = 0; sequence < 4; sequence++) {
    probe(i => `desktop-to-mobile-${sequence}-${i}.png`, 40, 2, (frames, count, cancelled) => {
      results.push({ frames, count, cancelled });
    }, () => true);
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.__afkImageProbeStats())),
    { active: 12, queued: 12, groups: 4, cap: 12 },
    '切換前應確實填滿桌機 12 張 active，並保留其餘 queued'
  );
  setMobile(true);
  window.__afkEnforceImageProbeCap();
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.__afkImageProbeStats())),
    { active: 0, queued: 0, groups: 0, cap: 6 },
    '桌機 cap 12 縮成手機 cap 6 時，active＋queued 必須同步收斂'
  );
  assert.equal(results.length, 4, 'cap 縮小必須取消所有舊 probe group，不能留下永不完成的半組工作');
  assert.ok(results.every(result => result.cancelled && result.frames === null && result.count === 0),
    'cap 縮小不得把桌機 epoch 的部分幀交付給手機 cache');
  assert.ok(images.every(image => image.removed && image.src === '' &&
    image.onload === null && image.onerror === null),
  'cap 縮小取消的桌機 active Image 必須立即卸載 src 與 handler');
  probe(i => `mobile-recovery-${i}.png`, 40, 2, () => {}, () => true);
  assert.equal(window.__afkImageProbeStats().active, 6,
    '清掉桌機批次後，新 probe 必須依手機 cap 6 正常恢復');
  window.__afkCancelImageProbes();
}

for (const failure of ['constructor', 'src']) {
  const options = failure === 'constructor' ? { constructorFailures: 1 } : { srcFailures: 1 };
  const { probe, images, window } = createProbeHarness(20, options);
  let failedResult = null;
  probe(i => `${failure}-failure-${i}.png`, 40, 2, (frames, count, cancelled) => {
    failedResult = { frames, count, cancelled };
  }, () => true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(failedResult)),
    { frames: null, count: 0, cancelled: false },
    `Image ${failure} 同步失敗應正常結束首序列`
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.__afkImageProbeStats())),
    { active: 0, queued: 0, groups: 0, cap: 6 },
    `Image ${failure} 同步失敗不得殘留 active、queue 或 group`
  );
  probe(i => `${failure}-recovery-${i}.png`, 40, 2, () => {}, () => true);
  assert.equal(images.length, failure === 'constructor' ? 6 : 7,
    `Image ${failure} 同步失敗後 scheduler 必須能正常建立下一個完整窗口`);
  assert.equal(window.__afkImageProbeStats().active, 6,
    `Image ${failure} 同步失敗不得留下錯誤 inFlight 計數阻塞後續工作`);
  window.__afkCancelImageProbes();
}

{
  const start = dropsCore.indexOf('let _bgHeartbeatWorker = null;');
  const end = dropsCore.indexOf('\nlet player = {', start);
  assert.ok(start >= 0 && end > start, '應能擷取背景心跳 Worker 初始化區塊');
  const createdUrls = [];
  const revokedUrls = [];
  const context = {
    window: {},
    Blob: class ControlledBlob {},
    Worker: class FailingWorker {
      constructor() {
        throw new Error('Worker constructor blocked');
      }
    },
    URL: {
      createObjectURL() {
        const url = `blob:test-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
      },
    },
  };
  vm.runInNewContext(
    `${dropsCore.slice(start, end)}
globalThis.__bgHeartbeatWorkerResult = _bgHeartbeatWorker;`,
    context,
    { filename: 'background-heartbeat-worker.js' }
  );
  assert.equal(context.__bgHeartbeatWorkerResult, null,
    'Worker 建構同步失敗應回到既有 null fallback');
  assert.deepEqual(createdUrls, ['blob:test-1'], '測試必須確實建立一個 Blob URL');
  assert.deepEqual(revokedUrls, createdUrls,
    'Worker 建構同步拋錯也必須由 finally 撤銷同一個 Blob URL');
}

{
  const spriteStart = marketCore.indexOf('    function wanderingBuyerSpriteData(w) {');
  const spriteEnd = marketCore.indexOf('\n    function _findMatches', spriteStart);
  const clearStart = marketCore.indexOf('    window.__afkClearWanderingBuyerFrames = function () {');
  const clearEnd = marketCore.indexOf('\n    window.wanderingBuyerSpriteData', clearStart);
  assert.ok(spriteStart >= 0 && spriteEnd > spriteStart,
    '應能擷取玩家收購 NPC 圖片快取函式');
  assert.ok(clearStart >= 0 && clearEnd > clearStart,
    '應能擷取玩家收購 NPC 快取釋放函式');

  const images = [];
  class MarketImage {
    constructor() {
      this.onload = function () {};
      this.onerror = function () {};
      this._src = '';
      this.srcset = 'test-2x.png 2x';
      this.removed = [];
      images.push(this);
    }
    get src() { return this._src; }
    set src(value) { this._src = String(value); }
    removeAttribute(name) {
      this.removed.push(name);
      if (name === 'src') this._src = '';
      if (name === 'srcset') this.srcset = '';
    }
  }
  const context = { window: {}, Image: MarketImage };
  vm.runInNewContext(
    `let _classFrameCache = Object.create(null);
${marketCore.slice(spriteStart, spriteEnd)}
${marketCore.slice(clearStart, clearEnd)}
window.wanderingBuyerSpriteData = wanderingBuyerSpriteData;`,
    context,
    { filename: 'wandering-buyer-frame-cache.js' }
  );
  const first = context.window.wanderingBuyerSpriteData({ id: 'buyer-a', avatar: '男騎士' });
  assert.equal(images.length, 16, '預設 8 幀必須建立 8 張 body 與 8 張 shadow Image');
  context.window.__afkClearWanderingBuyerFrames();
  assert.ok(images.every((image) =>
    image.onload === null &&
    image.onerror === null &&
    image.src === '' &&
    image.srcset === '' &&
    image.removed.includes('src') &&
    image.removed.includes('srcset')
  ), '市集快取釋放必須逐張清 handler、src 與 srcset');
  const second = context.window.wanderingBuyerSpriteData({ id: 'buyer-a', avatar: '男騎士' });
  assert.equal(images.length, 32, '清除後同一買家必須建立新圖片，證明舊快取引用已丟棄');
  assert.notEqual(second.frames[0], first.frames[0], '清除後不得交回舊 body Image');
  assert.notEqual(second.shadows[0], first.shadows[0], '清除後不得交回舊 shadow Image');
}

const lite = createHarness();
assert.equal(lite.window.__afkMobileMemoryLite(), true, '手機雙省電應啟用圖片記憶體上限');
lite.window.applyAreaBackground();
assert.match(lite.battle.style.backgroundImage, /^linear-gradient/, '狩獵區應改用 CSS 漸層');
assert.equal(lite.areaCalls(), 0, '簡化模式不得先呼叫原函式，否則仍會開始解碼 1920 圖');
assert.match(lite.window._townMapBg('town_aden'), /^linear-gradient/, '城鎮也應改用 CSS 漸層');
assert.equal(lite.townCalls(), 0, '簡化模式不得解析城鎮 1920 圖');
assert.ok(lite.logs.some((line) => line.includes('[AFK-mobile-memory]') && line.includes('hooks OK')));
const liteMob = lite.window.__afkMobileMobStill('巨大骷髏');
assert.match(liteMob.src, /^assets\/mobile-mobs\/.+\.png$/, '雙省電怪物必須在原圖解碼前改走縮圖');
assert.equal(JSON.stringify(liteMob.fb), JSON.stringify(['assets/mobile-mobs/_fallback.svg']),
  '縮圖缺漏時只能退共用輕量圖，不得退原尺寸動畫幀');
assert.equal(lite.window.__afkMobileTownNpcFrames('1256', false).length, 0,
  '雙省電城鎮 NPC 不得建立完整站立序列');
assert.equal(lite.window.__afkMobileWanderingBuyerStill({}, '男騎士').frames.length, 1,
  '雙省電玩家收購 NPC 只可保留 body 首幀');
assert.equal(lite.window.__afkMobileMemoryAcceptFrames(), false,
  '雙省電啟用後，已在途的動畫 probe 完成時也不得回填大圖快取');
assert.deepEqual(lite.cachedImage.removed.sort(), ['src', 'srcset'],
  '釋放動畫快取時必須先卸下 Image src/srcset，不能只刪 cache key 等 GC');
assert.equal(Object.keys(lite.mobCache).length, 0, '卸下圖片後必須移除動畫 cache 持有權');
assert.ok(lite.probeCancelCalls() >= 1,
  'frame epoch 推進時必須同步通知全域 scheduler 取消 queued 與 active probe');
let trainingCalls = 0;
const beforeTraining = lite.window.applyAreaBackground;
lite.window.applyAreaBackground = function () {
  trainingCalls++;
  lite.battle.style.backgroundImage = 'url("assets/area/1920x1080/training.jpg")';
  return beforeTraining.apply(this, arguments);
};
lite.window.__afkMobileMemoryRefresh(true);
lite.window.applyAreaBackground();
assert.equal(trainingCalls, 0, '後載木人場 wrapper 也必須被最外層雙省電背景 gate 擋住');
assert.match(lite.battle.style.backgroundImage, /^linear-gradient/,
  '木人場在雙省電下必須維持 CSS 漸層');

const staleDisabled = createHarness({ powersave: false, noanim: true, lowfps: true });
assert.equal(staleDisabled.window.__afkMobileMemoryLite(), false,
  '省電外掛關閉時必須忽略殘留的雙省電子設定，避免動畫反覆下載／解碼後又被拒收');
assert.equal(staleDisabled.window.__afkMobileMemoryAcceptFrames(), true,
  '省電外掛關閉時動畫 probe 必須能正常收進 cache，不得形成下載後立即丟棄的迴圈');
assert.equal(staleDisabled.window.__afkMobileMobStill('巨大骷髏'), null,
  '省電外掛關閉時不得套用手機縮圖政策');

const landscapeBoot = createHarness({
  mobile: true,
  mobileClass: false,
  width: 932,
  coarse: true,
  readyState: 'loading',
});
assert.equal(landscapeBoot.window.__afkMobileMemoryLite(), true,
  '橫向手機不得依賴稍後才出現的 body.m-mobile 才辨識為手機');
assert.equal(landscapeBoot.rootClassNames.has('afk-memory-lite-boot'), true,
  'DOMContentLoaded 前就必須套用輕量背景，避免先解碼 3344x1882 大圖');

const catchup = createHarness();
catchup.timers.length = 0;
catchup.state.ff = true;
catchup.window.__afkMobileMemoryLifecycle('map-change');
assert.equal(catchup.timers.length, 0,
  '離線 ff 的多次 map-change 不得排靜態角色 render timer');
catchup.state.ff = false;
catchup.window.startGameTimers();
assert.equal(catchup.startGameCalls(), 1, 'live timer wrapper 必須透明呼叫核心函式');
assert.equal(catchup.timers.length, 1, '離線結算尾端只排一個合併後 flush');
catchup.runNextTimer();
assert.equal(catchup.timers.length, 1, 'flush 應在 catchingUp/ff 清除後才排真正渲染');
catchup.runNextTimer();
assert.equal(catchup.timers.length, 0, '合併後的靜態角色渲染只執行一次');

const viewportSwitch = createHarness({ mobile: false, noanim: false, lowfps: false });
const viewportCancelsBefore = viewportSwitch.probeCancelCalls();
viewportSwitch.setMobile(true);
viewportSwitch.window.__afkMobileMemoryRefresh(false);
assert.ok(viewportSwitch.probeCancelCalls() > viewportCancelsBefore,
  '桌機切手機即使雙省電狀態沒變，也必須形成 probe 取消／cache 釋放邊界');
assert.equal(viewportSwitch.window.__afkMobileMemoryStats().lastReason, 'mobile-cap-shrink',
  '桌機切手機的資源釋放必須留下固定診斷原因');

lite.values.set('afk_ps_lowfps', '0');
assert.equal(lite.window.__afkMobileMemoryLite(), false, '任一省電選項關閉就應恢復原背景');
lite.window.applyAreaBackground();
assert.equal(lite.areaCalls(), 1, '非簡化模式必須完整交回原背景函式');
assert.equal(lite.window._townMapBg('town_aden'), 'url("assets/area/1920x1080/town.jpg")');
assert.equal(lite.townCalls(), 1);
assert.equal(lite.window.__afkMobileMobStill('巨大骷髏'), null,
  '任一省電選項關閉時，怪物也必須完整交回原渲染');

const desktop = createHarness({ mobile: false });
assert.equal(desktop.window.__afkMobileMemoryLite(), false, '桌機不可套用手機記憶體政策');
assert.equal(desktop.window.__afkMobileMobStill('巨大骷髏'), null, '桌機怪物渲染必須維持原圖層');
desktop.window.applyAreaBackground();
assert.equal(desktop.areaCalls(), 1);

assert.equal((core.match(/__afkMobileMemoryLite/g) || []).length, 6,
  '角色選擇、創角預載、創角逐幀三處閘門必須完整存在');
assert.equal((vfxCore.match(/__afkMobileMobStill/g) || []).length, 2,
  '戰鬥渲染必須在原尺寸怪物 URL 進 DOM 前讀取雙省電縮圖 hook');
assert.equal((vfxCore.match(/__afkMobileMemoryAcceptFrames/g) || []).length, 6,
  'mob／mob8／玩家形態三組非同步 probe 都必須在完成時再次確認圖片模式');
assert.match(vfxCore, /function _probeFramesWin\(urlFor, maxF, minF, done, stillCurrent\)/,
  '共用動畫 probe 必須支援 epoch 取消 predicate');
assert.match(vfxCore, /const MOBILE_ACTIVE_CAP = 6, DESKTOP_ACTIVE_CAP = 12/,
  'mob／玩家／寵物共用的 probe scheduler 必須同時限制手機與桌機全域 active 數');
assert.match(vfxCore, /window\.__afkCancelImageProbes = cancelAll/,
  '核心 scheduler 必須暴露 epoch 立即取消掛點');
assert.match(vfxCore, /window\.__afkEnforceImageProbeCap = enforceCap/,
  '核心 scheduler 必須暴露動態 cap 收斂掛點');
assert.equal((vfxCore.match(/let _(?:mob|mob8|morph)MemoryCurrent =/g) || []).length, 3,
  'mob／mob8／玩家形態都必須把自己的 epoch predicate 傳入 loader');
assert.match(vfxCore, /if \(!cancelled && !frames && n === 0/,
  'epoch 取消不得觸發 mob 的下一個素材前綴重試');
assert.match(vfxCore, /_fullMobLayers && MOB_ANIM_NAMES\.has\(m\.n\)/,
  '雙省電縮圖啟用時必須阻止影子與武器原尺寸圖層進 DOM');
assert.match(worldCore, /__afkMobileTownNpcFrames/, '城鎮 NPC 必須在建立 Image 陣列前讀取手機首幀 hook');
assert.match(worldCore, /__afkMobileMemoryLite\(\)\) return;[\s\S]{0,120}城鎮也停止 8fps/,
  '城鎮 8fps ticker 必須遵守雙省電');
assert.equal((worldCore.match(/__afkMobileMemoryLifecycle\('map-change'\)/g) || []).length, 2,
  '一般 changeMap 與隱藏聖地直接進圖都必須建立圖片資源邊界');
assert.equal((progressionCore.match(/__afkMobileMemoryLifecycle\('map-change'\)/g) || []).length, 3,
  '傲慢、遺忘之島、時空裂痕三條直接進圖路徑都必須釋放上一張圖');
assert.match(trainingPlugin,
  /__afkMobileMemoryLifecycle\('map-change'\);[^\n]*\n\s*mapState\.current = TRAIN_MAP;/,
  '木人場直接切換假地圖前也必須建立圖片資源邊界');
assert.equal((petCore.match(/__afkMobileMemoryAcceptFrames/g) || []).length, 2,
  '寵物非同步 probe 完成時必須再次確認圖片模式');
assert.match(petCore, /let _petMemoryCurrent =[\s\S]{0,1200}_petMemoryCurrent\);/,
  '寵物 probe 必須傳入自己的 epoch predicate');
assert.match(marketCore, /__afkMobileWanderingBuyerStill/,
  '玩家收購 NPC 必須在 classanim 全序列建立前讀取手機首幀 hook');
assert.match(marketCore, /__afkClearWanderingBuyerFrames/,
  '角色／模式切換時必須能釋放 IIFE 私有的玩家 NPC 快取');
assert.match(cardCore, /手機雙省電縮圖已含完整單層/,
  '卡片圖鑑使用手機縮圖後不得再疊回原尺寸影子／武器');
for (const marker of [
  'function releasePanelBody(id)',
  'function closeAndReleaseImagePanels()',
  "installBookCloseGuard('closeNpcInteraction', 'interaction-content');",
  'function renderStaticActors()',
  'function scheduleStaticActors()',
  'releaseImageValue(cache[keys[i]], 0, [])',
]) {
  assert.ok(plugin.includes(marker), `手機圖片政策缺少生命週期標記：${marker}`);
}
assert.match(indexHtml, /afk-memory-lite-boot/, '手機既有雙省電設定必須在 CSS 載入前阻止大 body 背景');
assert.match(indexHtml, /window\.__afkIsMobileDevice = function \(\)/,
  'head 啟動閘門必須先建立共用手機偵測，避免橫向寬度與手機外殼判斷分歧');
assert.match(indexHtml, /localStorage\.getItem\('afk_toggle_powersave'\)/,
  'head 啟動閘門必須尊重省電外掛總開關，不能只讀殘留子設定');
assert.equal((indexHtml.match(/data-afk-mobile-lazy="1"/g) || []).length, 12,
  '4 張隱藏選角大圖與 8 張職業 logo 必須延遲載入');
assert.match(sync, /'afk-mobile-memory\.js'/, '上游同步必須保留本地政策檔');
assert.match(policyBlock, /afk-mobile-memory\.js/, '同步後 index 必須重新注入政策檔');
assert.match(assetExcludes, /\/mobile-mobs\//, '上游 assets rsync --delete 必須保留手機怪物縮圖');

console.log('✅ 手機圖片記憶體上限：場景、登入、城鎮、玩家 NPC、怪物／寵物快取與上游同步保護全部通過。');
