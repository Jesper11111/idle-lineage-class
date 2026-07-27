import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const plugin = await readFile(new URL('../afk-mobile-memory.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../js/13-shop-save.js', import.meta.url), 'utf8');
const sync = await readFile(new URL('./sync-upstream.mjs', import.meta.url), 'utf8');
const policyBlock = await readFile(new URL('./local-policy-block.html', import.meta.url), 'utf8');

function createHarness({ mobile = true, noanim = true, lowfps = true } = {}) {
  const values = new Map([
    ['afk_ps_noanim', noanim ? '1' : '0'],
    ['afk_ps_lowfps', lowfps ? '1' : '0'],
  ]);
  const classNames = new Set(mobile ? ['m-mobile'] : []);
  const makeClasses = () => ({
    add: (...names) => names.forEach((name) => classNames.add(name)),
    remove: (...names) => names.forEach((name) => classNames.delete(name)),
    contains: (name) => classNames.has(name),
  });
  const battle = { style: {}, classList: makeClasses() };
  const town = { style: {}, classList: makeClasses() };
  let areaCalls = 0;
  let townCalls = 0;
  const logs = [];
  const document = {
    body: { classList: makeClasses() },
    addEventListener() {},
    getElementById(id) {
      return id === 'battle-view' ? battle : (id === 'town-view' ? town : null);
    },
  };
  const window = {
    innerWidth: mobile ? 390 : 1280,
    matchMedia: () => ({ matches: mobile }),
    applyAreaBackground() {
      areaCalls++;
      battle.style.backgroundImage = 'url("assets/area/1920x1080/full.jpg")';
    },
    _townMapBg() {
      townCalls++;
      return 'url("assets/area/1920x1080/town.jpg")';
    },
  };
  const context = {
    window,
    document,
    mapState: { current: 'field' },
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    setTimeout() {},
    console: { log: (line) => logs.push(String(line)) },
  };
  vm.runInNewContext(plugin, context, { filename: 'afk-mobile-memory.js' });
  return {
    window, battle, town, logs, values,
    areaCalls: () => areaCalls,
    townCalls: () => townCalls,
  };
}

const lite = createHarness();
assert.equal(lite.window.__afkMobileMemoryLite(), true, '手機雙省電應啟用圖片記憶體上限');
lite.window.applyAreaBackground();
assert.match(lite.battle.style.backgroundImage, /^linear-gradient/, '狩獵區應改用 CSS 漸層');
assert.equal(lite.areaCalls(), 0, '簡化模式不得先呼叫原函式，否則仍會開始解碼 1920 圖');
assert.match(lite.window._townMapBg('town_aden'), /^linear-gradient/, '城鎮也應改用 CSS 漸層');
assert.equal(lite.townCalls(), 0, '簡化模式不得解析城鎮 1920 圖');
assert.ok(lite.logs.some((line) => line.includes('[AFK-mobile-memory]') && line.includes('hooks OK')));

lite.values.set('afk_ps_lowfps', '0');
assert.equal(lite.window.__afkMobileMemoryLite(), false, '任一省電選項關閉就應恢復原背景');
lite.window.applyAreaBackground();
assert.equal(lite.areaCalls(), 1, '非簡化模式必須完整交回原背景函式');
assert.equal(lite.window._townMapBg('town_aden'), 'url("assets/area/1920x1080/town.jpg")');
assert.equal(lite.townCalls(), 1);

const desktop = createHarness({ mobile: false });
assert.equal(desktop.window.__afkMobileMemoryLite(), false, '桌機不可套用手機記憶體政策');
desktop.window.applyAreaBackground();
assert.equal(desktop.areaCalls(), 1);

assert.equal((core.match(/__afkMobileMemoryLite/g) || []).length, 6,
  '角色選擇、創角預載、創角逐幀三處閘門必須完整存在');
assert.match(sync, /'afk-mobile-memory\.js'/, '上游同步必須保留本地政策檔');
assert.match(policyBlock, /afk-mobile-memory\.js/, '同步後 index 必須重新注入政策檔');

console.log('✅ 手機圖片記憶體上限：地圖 A/B、角色預覽閘門與上游同步保護全部通過。');
