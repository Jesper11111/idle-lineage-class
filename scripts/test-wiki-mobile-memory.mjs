import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium, devices } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
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
const browser = await chromium.launch(systemChrome ? { executablePath: systemChrome } : {});

try {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.addInitScript(() => {
    localStorage.setItem('afk_ps_noanim', '1');
    localStorage.setItem('afk_ps_lowfps', '1');
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AFK_WIKI_API && document.getElementById('m-wiki-modal'));

  await page.evaluate(() => window.AFK_WIKI_API.goto({ tab: 'equip' }));
  await page.waitForSelector('#m-wiki-modal.open');
  let snapshot = await page.evaluate(() => ({
    cards: document.querySelectorAll('#m-wiki-body .m-eq-card').length,
    images: document.querySelectorAll('#m-wiki-body img[src]').length,
    detailsWithNodes: Array.from(document.querySelectorAll('#m-wiki-body .m-eq-detail'))
      .filter((node) => node.childElementCount > 0).length,
    descendants: document.querySelectorAll('#m-wiki-body *').length,
  }));
  assert.ok(snapshot.cards > 0 && snapshot.cards <= 48, `裝備列表單頁應為 1..48 件，實際 ${snapshot.cards}`);
  assert.ok(snapshot.images <= 48, `未展開時只可載入單頁裝備圖，實際 ${snapshot.images}`);
  assert.equal(snapshot.detailsWithNodes, 0, '未點擊的完整取得內容不得預先建立');
  assert.ok(snapshot.descendants < 1500, `單頁 DOM 必須有界，實際 ${snapshot.descendants}`);

  const heads = page.locator('#m-wiki-body [data-eq]');
  await heads.nth(0).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('#m-wiki-body .m-eq-detail:not([style*="display: none"]) img[src]').length > 0
  );
  await heads.nth(1).click();
  snapshot = await page.evaluate(() => ({
    openDetails: Array.from(document.querySelectorAll('#m-wiki-body .m-eq-detail'))
      .filter((node) => node.style.display !== 'none' && node.childElementCount > 0).length,
    loadedDetails: Array.from(document.querySelectorAll('#m-wiki-body .m-eq-detail'))
      .filter((node) => node.childElementCount > 0).length,
  }));
  assert.equal(snapshot.openDetails, 1, '同時只能保留一件裝備的完整詳情');
  assert.equal(snapshot.loadedDetails, 1, '切到另一件後，上一件詳情 DOM／圖片必須卸載');

  const next = page.locator('#m-wiki-body [data-equippage]').filter({ hasText: '下一頁' }).first();
  assert.equal(await next.isEnabled(), true, '裝備資料應超過一頁，才能驗證完整搜尋');
  await next.click();
  assert.ok(await page.locator('#m-wiki-body .m-eq-card').count() <= 48, '下一頁仍必須維持固定上限');
  const secondPageTarget = await page.locator('#m-wiki-body [data-eq]').first().evaluate((node) => ({
    id: node.getAttribute('data-eq'),
    name: node.querySelector('.font-bold')?.textContent.trim() || '',
  }));
  assert.ok(secondPageTarget.id && secondPageTarget.name, '應能取得第二頁裝備作為搜尋樣本');
  await page.fill('#m-wiki-input', secondPageTarget.name.replace(/[🏺✦]/g, '').trim());
  await page.waitForFunction((id) =>
    Array.from(document.querySelectorAll('#m-wiki-body [data-eqsearch-card] [data-eq]'))
      .some((node) => node.getAttribute('data-eq') === id),
  secondPageTarget.id);
  const searchTarget = await page.evaluate((id) => {
    const head = Array.from(document.querySelectorAll('#m-wiki-body [data-eqsearch-card] [data-eq]'))
      .find((node) => node.getAttribute('data-eq') === id);
    return {
      found: !!head,
      images: head && head.parentNode ? head.parentNode.querySelectorAll('img[src],img[srcset]').length : -1,
      totalCards: document.querySelectorAll('#m-wiki-body .m-eq-card').length,
    };
  }, secondPageTarget.id);
  assert.equal(searchTarget.found, true, '全域搜尋必須找到第二頁以後的裝備');
  assert.equal(searchTarget.images, 0, '搜尋命中卡不得預先載入圖片');
  assert.ok(searchTarget.totalCards <= 80, `搜尋裝備卡必須維持上限，實際 ${searchTarget.totalCards}`);

  await page.click('#m-wiki-close');
  await page.waitForFunction(() => !document.getElementById('m-wiki-modal').classList.contains('open'));
  await page.waitForFunction(() => document.getElementById('m-wiki-body').childElementCount === 0);
  snapshot = await page.evaluate(() => ({
    images: document.querySelectorAll('#m-wiki-body img[src],#m-wiki-body img[srcset]').length,
    descendants: document.querySelectorAll('#m-wiki-body *').length,
  }));
  assert.deepEqual(snapshot, { images: 0, descendants: 0 }, '關閉 Wiki 後必須完整釋放圖片與 DOM');

  const closeGuardProblems = await page.evaluate(() => {
    const checks = [
      ['equip-book-body', 'closeEquipBook'],
      ['misc-book-body', 'closeMiscBook'],
      ['relic-book-body', 'closeRelicBook'],
      ['interaction-content', 'closeNpcInteraction'],
    ];
    const problems = [];
    checks.forEach(([bodyId, closeName]) => {
      const body = document.getElementById(bodyId);
      if (!body || typeof window[closeName] !== 'function') {
        problems.push(`${closeName}:missing`);
        return;
      }
      body.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="><span>x</span>';
      window[closeName]();
      if (body.childElementCount || body.querySelector('img[src],img[srcset]')) problems.push(`${closeName}:retained`);
    });
    return problems;
  });
  assert.deepEqual(closeGuardProblems, [], `關閉面板仍殘留圖片：${closeGuardProblems.join(', ')}`);

  console.log('✅ 手機大型面板：Wiki 裝備 48 件分頁、詳情單例、關閉釋放與收集冊/NPC 清理全部通過。');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
