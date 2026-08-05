import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium, devices, webkit } from 'playwright';
import { listTestSaves, loadFullBackup, loadTestSave } from './load-testsave.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUNDS = Math.max(4, Number(process.env.AFK_STRESS_ROUNDS) || 8);
const BROWSER_ENGINE = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const FULL_BACKUP = process.env.AFK_FULL_BACKUP || '';
const FULL_BACKUP_SLOT = Math.max(1, Number(process.env.AFK_FULL_BACKUP_SLOT) || 1);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const systemChrome = platform() === 'win32'
  ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
     'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)
  : null;
const browser = await (BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch(
  BROWSER_ENGINE === 'chromium'
    ? {
        ...(systemChrome ? { executablePath: systemChrome } : {}),
        args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
      }
    : {}
);

const context = await browser.newContext({ ...devices['iPhone 13'] });
await context.addInitScript(() => {
  localStorage.setItem('afk_ps_noanim', '1');
  localStorage.setItem('afk_ps_lowfps', '1');
  localStorage.setItem('afk_ps_nofx', '1');
});
const page = await context.newPage();
const failures = [];
let crashed = false;
page.on('crash', () => { crashed = true; });
page.on('pageerror', (error) => failures.push(String(error && error.stack || error)));

const sleep = (ms) => page.waitForTimeout(ms);
const maps = [
  'town_silver_knight', 'silver_knight', 'town_elf', 'zone_01',
  'town_talking', 'talking_island', 'town_gludin', 'gludio',
  'town_giran', 'giran',
];

async function createSyntheticRole() {
  return page.evaluate(() => {
    currentSlot = 16;
    try { _lzRemoveStored('lineage_idle_save_16'); } catch (e) {}
    selectClass('m_knight');
    const stats = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    let guard = 100;
    while (guard-- > 0) {
      const before = stats.reduce((sum, key) => sum + Number(curCreate[key] || 0), 0);
      for (const key of stats) adjStat(key, 1);
      const after = stats.reduce((sum, key) => sum + Number(curCreate[key] || 0), 0);
      if (after >= Number(createBase[curCreate.cls].pts || 0)) break;
      if (after === before) throw new Error('創角配點無法完成');
    }
    startGame();
    return { source: 'synthetic', slot: currentSlot, role: player.cls, inventory: player.inv.length };
  });
}

async function loadRole() {
  if (FULL_BACKUP) {
    return loadFullBackup(page, { file: FULL_BACKUP, slot: FULL_BACKUP_SLOT, powersave: true });
  }
  const saves = listTestSaves();
  if (saves.length) {
    const loaded = await loadTestSave(page, { file: saves[0], slot: 1 });
    return { source: saves[0], ...loaded };
  }
  return createSyntheticRole();
}

async function makeInventoryHeavy() {
  return page.evaluate(() => {
    const ids = Object.keys(DB.items).filter((id) => {
      const item = DB.items[id];
      return item && item.n && ['etc', 'misc', 'wpn', 'arm', 'acc'].includes(item.type);
    });
    const target = Math.max(420, player.inv.length);
    for (let index = player.inv.length; index < target; index++) {
      const id = ids[index % ids.length];
      player.inv.push({
        id, uid: `stress-${index}-${id}`, cnt: (index % 7) + 1,
        en: 0, bless: 0, anc: false, lock: false, junk: false,
      });
    }
    player.inventoryAutoSort = false;
    calcStats();
    renderTabs(true);
    saveGame();
    return { inventory: player.inv.length, saveBytes: saveStateJson().length };
  });
}

async function openAndCloseBooks() {
  for (const [openName, closeName] of [
    ['openEquipBook', 'closeEquipBook'],
    ['openMiscBook', 'closeMiscBook'],
    ['openRelicBook', 'closeRelicBook'],
    ['openCardBook', 'closeCardBook'],
  ]) {
    await page.evaluate((name) => window[name](), openName);
    await sleep(35);
    await page.evaluate((name) => window[name](), closeName);
  }
}

async function exerciseWiki() {
  await page.evaluate(() => window.AFK_WIKI_API.goto({ tab: 'equip' }));
  await page.waitForSelector('#m-wiki-modal.open');
  const first = page.locator('#m-wiki-body [data-eq]').first();
  if (await first.count()) {
    await first.click();
    await sleep(35);
  }
  const next = page.locator('#m-wiki-body [data-equippage]').filter({ hasText: '下一頁' }).first();
  if (await next.count() && await next.isEnabled()) await next.click();
  await page.click('#m-wiki-close');
  await page.waitForFunction(() =>
    !document.getElementById('m-wiki-modal').classList.contains('open') &&
    document.getElementById('m-wiki-body').childElementCount === 0
  );
}

async function exerciseBackpack(round) {
  const right = page.locator('#m-nav [data-view="right"]');
  if (await right.count()) await right.click();
  for (const tab of ['items', 'weapons', 'armors', 'equip', 'skill']) {
    await page.evaluate((name) => {
      const button = Array.from(document.querySelectorAll('button[onclick]'))
        .find((candidate) => String(candidate.getAttribute('onclick')).includes(`switchTab('${name}'`));
      if (!button) throw new Error(`找不到 ${name} 分頁按鈕`);
      switchTab(name, button);
      renderTabs(true);
    }, tab);
  }
  await page.evaluate(() => {
    document.body.classList.remove('mview-left', 'mview-right');
    document.body.classList.add('mview-center');
    state.inTick = true;
    if (player.inv[0]) player.inv[0].cnt = (Number(player.inv[0].cnt) || 1) + 1;
    renderTabs();
    state.inTick = false;
  });
  await sleep(80);
  const retained = await page.evaluate(() =>
    ['items', 'weapons', 'armors', 'equip', 'skill']
      .reduce((sum, id) => sum + document.getElementById('tab-' + id).childElementCount, 0)
  );
  assert.equal(retained, 0, `第 ${round} 輪離開背包後仍保留分頁 DOM`);
}

async function exerciseMaps(round) {
  for (let offset = 0; offset < 5; offset++) {
    const map = maps[(round * 5 + offset) % maps.length];
    const result = await page.evaluate((mapId) => {
      setMapSelectors(mapId);
      changeMap(true);
      return mapState.current;
    }, map);
    assert.equal(result, map, `地圖切換未落在 ${map}`);
    await sleep(35);
  }
}

async function exerciseRoleCycle() {
  const result = await page.evaluate(() => {
    const slot = currentSlot;
    if (!returnToCharacterSelect()) return { ok: false, phase: 'return' };
    loadEnterSelected();
    return {
      ok: !!player && !!player.cls &&
        !document.getElementById('game-screen').classList.contains('hidden'),
      slot,
      loadedSlot: currentSlot,
    };
  });
  assert.equal(result.ok, true, '返回選角後無法重新載入角色');
  assert.equal(result.loadedSlot, result.slot, '重新載入了錯誤存檔位');
  await sleep(80);
}

const cdp = BROWSER_ENGINE === 'chromium' ? await context.newCDPSession(page) : null;
if (cdp) await cdp.send('Performance.enable');
async function sample(round, collectGarbage = false) {
  if (cdp && collectGarbage) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const [dom, performanceMetrics, pageMetrics] = await Promise.all([
    cdp ? cdp.send('Memory.getDOMCounters') : Promise.resolve(null),
    cdp ? cdp.send('Performance.getMetrics') : Promise.resolve(null),
    page.evaluate(() => {
      const images = Array.from(document.images).filter((image) => image.getAttribute('src'));
      const decodedBytes = images.reduce((sum, image) =>
        sum + (Number(image.naturalWidth) || 0) * (Number(image.naturalHeight) || 0) * 4, 0);
      const panelIds = ['card-book-body', 'equip-book-body', 'misc-book-body', 'relic-book-body', 'interaction-content'];
      return {
        domNodes: document.querySelectorAll('*').length + 1,
        images: images.length,
        decodedBytes,
        wikiNodes: document.querySelectorAll('#m-wiki-body *').length,
        wikiImages: document.querySelectorAll('#m-wiki-body img[src],#m-wiki-body img[srcset]').length,
        panelNodes: panelIds.reduce((sum, id) => sum + (document.getElementById(id)?.childElementCount || 0), 0),
        backpackNodes: ['items', 'weapons', 'armors', 'equip', 'skill']
          .reduce((sum, id) => sum + document.getElementById('tab-' + id).childElementCount, 0),
        releases: window.__afkMobileMemoryStats?.().releases || 0,
      };
    }),
  ]);
  const metric = performanceMetrics
    ? Object.fromEntries(performanceMetrics.metrics.map(({ name, value }) => [name, value]))
    : {};
  return {
    round,
    nodes: dom ? dom.nodes : pageMetrics.domNodes,
    documents: dom ? dom.documents : null,
    listeners: dom ? dom.jsEventListeners : null,
    jsHeap: metric.JSHeapUsedSize || null,
    ...pageMetrics,
  };
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    typeof loadGame === 'function' &&
    typeof window.AFK_WIKI_API === 'object' &&
    typeof window.__afkMobileMemoryStats === 'function'
  );
  const loaded = await loadRole();
  await page.waitForFunction(() =>
    document.body.classList.contains('m-mobile') &&
    document.getElementById('m-nav')
  );
  const heavy = await makeInventoryHeavy();
  await sleep(250);

  const samples = [];
  for (let round = 0; round < ROUNDS; round++) {
    await exerciseBackpack(round + 1);
    await exerciseMaps(round);
    await exerciseWiki();
    await openAndCloseBooks();
    await exerciseRoleCycle();
    await page.evaluate(() => {
      saveGame();
      saveGame();
      document.body.classList.remove('mview-left', 'mview-right');
      document.body.classList.add('mview-center');
    });
    await sleep(100);
    const peak = await sample(round + 1, false);   // 先量自然峰值；只看強制 GC 後會漏掉 iOS 真正會殺頁的尖峰
    const current = await sample(round + 1, true);
    current.peakJsHeap = peak.jsHeap;
    assert.equal(current.wikiNodes + current.wikiImages, 0, `第 ${round + 1} 輪 Wiki 未釋放`);
    assert.equal(current.panelNodes, 0, `第 ${round + 1} 輪收集冊／NPC body 未釋放`);
    assert.equal(current.backpackNodes, 0, `第 ${round + 1} 輪背包未休眠`);
    samples.push(current);
    console.log(`[stress ${round + 1}/${ROUNDS}] nodes=${current.nodes} images=${current.images} ` +
      `decoded=${(current.decodedBytes / 1048576).toFixed(1)}MiB heap=` +
      `${current.jsHeap == null ? 'n/a' : (current.jsHeap / 1048576).toFixed(1) + 'MiB'} peak=` +
      `${current.peakJsHeap == null ? 'n/a' : (current.peakJsHeap / 1048576).toFixed(1) + 'MiB'}`);
  }

  await page.waitForFunction(() =>
    !window._lzWorkerActive && Object.keys(window._lzWorkerPending || {}).length === 0,
  null, { timeout: 15000 });
  const finalPeak = await sample(ROUNDS + 1, false);
  const final = await sample(ROUNDS + 1, true);
  final.peakJsHeap = finalPeak.jsHeap;
  const warm = samples[Math.min(2, samples.length - 1)];
  assert.equal(crashed, false, '手機壓力測試期間 renderer 發生 crash');
  assert.deepEqual(failures, [], `手機壓力測試有 pageerror：\n${failures.join('\n')}`);
  assert.ok(final.nodes <= warm.nodes + 2500,
    `DOM 未收斂：暖機 ${warm.nodes} → 最後 ${final.nodes}`);
  assert.ok(final.images <= warm.images + 80,
    `圖片 DOM 未收斂：暖機 ${warm.images} → 最後 ${final.images}`);
  if (Number.isFinite(final.jsHeap) && Number.isFinite(warm.jsHeap)) {
    assert.ok(final.jsHeap <= warm.jsHeap + 16 * 1024 * 1024,
      `JS heap 未收斂：暖機 ${(warm.jsHeap / 1048576).toFixed(1)} → 最後 ${(final.jsHeap / 1048576).toFixed(1)} MiB`);
  }
  if (Number.isFinite(final.peakJsHeap) && Number.isFinite(warm.peakJsHeap)) {
    assert.ok(final.peakJsHeap <= warm.peakJsHeap + 48 * 1024 * 1024,
      `自然 GC 前 heap 尖峰持續擴張：暖機 ${(warm.peakJsHeap / 1048576).toFixed(1)} → 最後 ${(final.peakJsHeap / 1048576).toFixed(1)} MiB`);
  }
  assert.ok(final.releases >= ROUNDS * 6,
    `圖片生命週期釋放次數不足：${final.releases}`);

  console.log(`✅ ${BROWSER_ENGINE} 手機整體壓力：${ROUNDS * 5} 次背包分頁、${ROUNDS * 5} 次換圖、` +
    `${ROUNDS} 次 Wiki／四收集冊／角色重載與 ${ROUNDS * 2} 次存檔，無 crash、無錯誤且資源收斂。`);
  console.log(`   測試角色=${loaded.source}，背包=${heavy.inventory} 件，存檔原文=${heavy.saveBytes} bytes。`);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
