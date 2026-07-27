import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const plugin = await readFile(new URL('../afk-mobile-audio-memory.js', import.meta.url), 'utf8');
const sync = await readFile(new URL('./sync-upstream.mjs', import.meta.url), 'utf8');
const policyBlock = await readFile(new URL('./local-policy-block.html', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function createHarness(active) {
  let activeValue = active;
  let released = 0;
  let created = 0;
  class FakeAudio {
    constructor() {
      created++;
      this.paused = true;
      this.ended = false;
      this.src = '';
      this.currentSrc = '';
      this.volume = 1;
      this.currentTime = 0;
    }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === 'src') { released++; this.src = ''; } }
    load() { this.currentSrc = this.src; }
    play() { this.paused = false; return Promise.resolve(); }
  }
  const context = {
    Map,
    Array,
    Object,
    console: { log() {}, error() {} },
    localStorage: { getItem: () => '1' },
    document: {
      addEventListener() {},
      body: { classList: { contains: () => active } },
    },
    matchMedia: () => ({ matches: active }),
    innerWidth: active ? 390 : 1280,
    _sfxPool: {},
    _sfxIdx: {},
    _sfxDynTried: {},
    SFX_POOL_N: 4,
    Audio: FakeAudio,
    performance: { now: (() => { let now = 0; return () => (now += 200); })() },
    setTimeout(fn) { fn(); },
  };
  context.window = context;
  context._sfxTryLoad = function (key, def) {
    context._sfxPool[key] = Array.from({ length: context.SFX_POOL_N }, () => {
      const audio = new FakeAudio();
      audio.src = `assets/sfx/${def.file}.ogg`;
      return audio;
    });
    context._sfxIdx[key] = 0;
  };
  context._sfxDynLoad = function (key) {
    if (context._sfxDynTried[key]) return;
    context._sfxDynTried[key] = true;
    context._sfxTryLoad(key, { file: key });
  };
  context._sfxPlayPool = function (key, volume) {
    const pool = context._sfxPool[key];
    if (!Array.isArray(pool) || !pool.length) return false;
    pool[0].volume = volume;
    pool[0].currentTime = 0;
    pool[0].play();
    return true;
  };
  context.__afkMobileMemoryLite = () => activeValue;
  vm.runInNewContext(plugin, context, { filename: 'afk-mobile-audio-memory.js' });
  return {
    context,
    released: () => released,
    created: () => created,
    setActive(value) { activeValue = value; },
  };
}

const mobile = createHarness(true);
for (let i = 0; i < 300; i++) mobile.context._sfxDynLoad(`mob_${i}`, String(i));
const mobileStats = mobile.context.__afkMobileAudioMemory.stats();
assert.equal(mobile.context.SFX_POOL_N, 1, '手機雙省電每個音效池應降為一個元素');
assert.equal(mobileStats.virtualPools, 300, '每個動態 key 應只建立輕量播放代理');
assert.equal(mobileStats.realAudioElements, 0, '尚未播放前不得為動態音效預載 Audio 元素');
assert.equal(mobile.created(), 0, '建立 300 個動態 key 不得觸發媒體元素建構');
for (let i = 0; i < 20; i++) mobile.context._sfxPlayPool(`mob_${i}`, 0.5);
const mobilePlayedStats = mobile.context.__afkMobileAudioMemory.stats();
assert.equal(mobilePlayedStats.channelsCreated, 6, '所有音效只能共用六個固定播放通道');
assert.equal(mobilePlayedStats.realAudioElements, 6, '播放再多不同音效也只能留下六個 Audio 元素');
assert.equal(mobile.created(), 6, '媒體元素建構數不得隨音效 key 成長');
mobile.setActive(false);
mobile.context._sfxPool.mob_0[0].play();
assert.equal(mobile.context.SFX_POOL_N, 4, '關閉雙省電後必須恢復 PP 四元素播放池');
assert.equal(mobile.context._sfxPool.mob_0[0].__afkMobileAudioVirtual, undefined,
  '關閉雙省電後，下一次播放應把該音效惰性還原為 PP 原生池');
assert.equal(mobile.context._sfxPool.mob_0.length, 4, '惰性還原不得只建立省電模式的一元素池');

const desktop = createHarness(false);
for (let i = 0; i < 40; i++) desktop.context._sfxDynLoad(`mob_${i}`, String(i));
const desktopStats = desktop.context.__afkMobileAudioMemory.stats();
assert.equal(desktop.context.SFX_POOL_N, 4, '桌機／非雙省電必須保留原本四元素重疊播放');
assert.equal(desktopStats.virtualPools, 0, '非雙省電不接管 PP 動態池');
assert.equal(desktop.created(), 160, '非雙省電必須維持 PP 每池四個 Audio 元素');
assert.equal(desktop.released(), 0, '非雙省電不得釋放 PP 音效元素');
desktop.setActive(true);
desktop.context.__afkMobileAudioMemory.enforce();
const desktopToLiteStats = desktop.context.__afkMobileAudioMemory.stats();
assert.equal(desktopToLiteStats.virtualPools, 40, '頁面中途開啟雙省電時應轉換既有 PP 音效池');
assert.equal(desktopToLiteStats.realAudioElements, 0, '轉換後不得留下原本的 Audio 預載元素');
assert.equal(desktop.released(), 160, '轉換時必須清除全部既有 Audio src');

assert.match(sync, /'afk-mobile-audio-memory\.js'/, '上游同步必須保留手機音效政策檔');
assert.match(policyBlock, /afk-mobile-audio-memory\.js/, '同步後 index 必須重新注入音效政策檔');
assert.equal((index.match(/afk-mobile-audio-memory\.js/g) || []).length, 1,
  '正式 index 應且只能載入一次音效政策檔');

console.log('✅ 手機音效記憶體上限：輕量代理、固定六通道、桌機不變與上游同步保護全部通過。');
