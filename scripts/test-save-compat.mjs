/**
 * 使用真實 SIG1 匯出檔驗證目前核心：
 *   - 簽章有效、JSON 可解析
 *   - 可載入並重新存成有效 SIG1
 *   - 角色身分、等級、背包、裝備、傭兵數不因載入／存檔往返而改變
 *   - 舊傭兵政策生效、妖精傭兵不限目前屬性，且 PP v3.8.5 戰鬥模組仍存在
 *
 * 可由 CLI 傳入多個絕對路徑，也可 import 後呼叫 testSaveFiles(paths)。
 */
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { extname, join, normalize, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function identityOf(p) {
  const eq = {};
  for (const [k, v] of Object.entries((p && p.eq) || {})) eq[k] = v && v.id ? v.id : null;
  return {
    cls: p && p.cls, name: p && p.name, enSeed: p && p.enSeed,
    classicMode: !!(p && p.classicMode), lv: p && p.lv,
    invCount: ((p && p.inv) || []).length,
    allyCount: ((p && p.allies) || []).length,
    eq
  };
}

function plainPayload(raw) {
  const text = String(raw);
  if (!text.startsWith('SIG1:') && !text.startsWith('SIG2:')) return text;
  const secondColon = text.indexOf(':', 5);
  if (secondColon < 0) throw new Error('簽章格式缺少 payload 分隔符');
  return text.slice(secondColon + 1);
}

export async function testSaveFiles(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('未提供測試存檔');
  const inputs = [];
  for (const path of paths) {
    await stat(path);
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(plainPayload(raw));
    if (!data || !data.p || !data.p.cls) throw new Error(`${basename(path)} 不是有效角色存檔`);
    inputs.push({
      path, raw, expected: identityOf(data.p),
      sha256: createHash('sha256').update(raw).digest('hex')
    });
  }

  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      const buf = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const systemChrome = platform() === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
       'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)
    : null;
  const browser = await chromium.launch(systemChrome ? { executablePath: systemChrome } : {});
  const results = [];
  try {
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message ? e.message : e)));
      await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

      const got = await page.evaluate(({ raw, slot }) => {
        const u = _saveUnwrap(raw);
        if (!u || !u.signed || !u.ok) return { error: 'SIG1 簽章驗證失敗' };
        const exported = JSON.parse(u.payload);
        const clean = {};
        for (const k in exported) {
          if (k !== 'wh' && k !== 'pets' && k !== 'pandoraDiamonds' && k !== 'clanState') clean[k] = exported[k];
        }
        localStorage.removeItem('afk_ts_' + slot);
        localStorage.removeItem('afk_map_' + slot);
        if (!_lzSet('lineage_idle_save_' + slot, _saveWrap(JSON.stringify(clean)))) return { error: '測試存檔寫入失敗' };
        currentSlot = slot;
        loadGame();
        saveGame();

        const stored = _saveUnwrap(_lzGet('lineage_idle_save_' + slot));
        if (!stored || !stored.signed || !stored.ok) return { error: '載入後重新存檔的簽章驗證失敗' };
        const p = JSON.parse(stored.payload).p;
        const eq = {};
        for (const k in (p.eq || {})) eq[k] = p.eq[k] && p.eq[k].id ? p.eq[k].id : null;
        const employmentKeys = [];
        for (let n = 0; n < localStorage.length; n++) {
          const key = localStorage.key(n);
          if (key && key.startsWith('fb5_mercenary_employment_v1_')) employmentKeys.push(key);
        }
        const activeAllies = (player.allies || []).filter(a => a && !a._downed).length;
        return {
          identity: {
            cls: p.cls, name: p.name, enSeed: p.enSeed, classicMode: !!p.classicMode, lv: p.lv,
            invCount: (p.inv || []).length, allyCount: (p.allies || []).length, eq
          },
          version: GAME_VERSION,
          signedRoundtrip: true,
          partyCount: partyExpShareCount(),
          expectedPartyCount: 1 + activeAllies,
          rewardMult: partyRewardMult(),
          dropRate: partyDropRate(0.125),
          employmentKeys,
          safeAreaBlocked: mercenaryRoleBattleBlocked('dragon_valley', false),
          rehireCosts: [mercRehireCost(1), mercRehireCost(50), mercRehireCost(100)],
          legacyPolicy: window.__legacyMercPolicy && window.__legacyMercPolicy.version,
          mercElementRestriction: window.__legacyMercPolicy && window.__legacyMercPolicy.elementRestriction,
          mismatchedElfSkillAllowed: typeof allySkillElementOk === 'function' &&
            allySkillElementOk({ elfEle: 'water', grantedSkills: [] }, 'sk_elf_dancefire'),
          offlineVersion: window.__afk && window.__afk.version,
          offlineOwner: window.__afkLegacyOfflineOwnsSettlement,
          siegeStages: window.SiegeV2 && SiegeV2.stages ? SiegeV2.stages.length : 0,
          threatEnabled: typeof THREAT_ENABLED !== 'undefined' && THREAT_ENABLED === true,
          mercThreatKey: typeof threatKey === 'function' ? threatKey({ _slot: 'test', cls: 'knight' }) : '',
          bindMercSupported: typeof bindSelfBlocked === 'function' &&
            bindSelfBlocked({ statuses: { bind: 1 }, eq: {}, cls: 'knight' }) === true,
          guardLoaded: typeof castleGuardTick === 'function' && typeof castleGuardSync === 'function'
        };
      }, { raw: input.raw, slot: i + 1 });

      const failures = [];
      if (got.error) failures.push(got.error);
      else {
        if (JSON.stringify(got.identity) !== JSON.stringify(input.expected)) failures.push('角色核心資料往返後不一致');
        if (got.version !== 'v3.8.5') failures.push('核心版本不是 PP v3.8.5');
        if (got.partyCount !== got.expectedPartyCount) failures.push('傭兵經驗均分人數錯誤');
        if (got.rewardMult !== 1 || Math.abs(got.dropRate - 0.125) > 1e-12) failures.push('金幣／掉落仍有隊伍人數加乘');
        if (got.employmentKeys.length) failures.push('仍寫入反向受僱登記');
        if (got.safeAreaBlocked !== false) failures.push('受僱角色仍被鎖在安全區');
        if (JSON.stringify(got.rehireCosts) !== JSON.stringify([1000, 100000, 500000])) failures.push('重新招募費率錯誤');
        if (got.legacyPolicy !== '3.7.61-policy-on-pp-v3.8.5') failures.push('舊傭兵政策層未啟動');
        if (got.mercElementRestriction !== false || got.mismatchedElfSkillAllowed !== true) failures.push('妖精傭兵仍受目前屬性限制');
        if (got.offlineVersion !== '2.2.0-jesper-safety' || got.offlineOwner !== true) failures.push('舊離線安全引擎未獨占啟動');
        if (got.siegeStages !== 5 || !got.threatEnabled || got.mercThreatKey !== 'A:test' || !got.bindMercSupported || !got.guardLoaded) {
          failures.push('PP v3.8.5 戰鬥模組未完整作用於傭兵');
        }
        if (i === 0) {
          const offlineStart = await page.evaluate(() => {
            setMapSelectors('talking_island');
            changeMap(true);
            const before = mapState.current;
            window.__afk.forceCatchup(0.02, true);   // 1.2 秒、強制走逐 tick 真實模擬路徑
            return before;
          });
          await page.waitForFunction(() => window.__afk && !window.__afk.isCatchingUp(), null, { timeout: 30000 });
          const offlineEnd = await page.evaluate(() => ({
            map: mapState.current,
            nativeHooks: ['offlineCatchupSaveCommitted', 'offlineSettleCatchup', 'offlinePrepareCharacterSelect']
              .filter(name => typeof window[name] !== 'undefined')
          }));
          if (offlineEnd.map !== offlineStart) failures.push(`舊離線實戰模擬後未留在原狩獵圖（${offlineStart} → ${offlineEnd.map}）`);
          if (offlineEnd.nativeHooks.length) failures.push('舊離線測試期間出現官方新版離線鉤子');
        }
      }
      if (errors.length) failures.push('頁面例外：' + errors.join(' | '));
      results.push({
        file: basename(input.path), sha256: input.sha256,
        role: `${input.expected.name || '未命名'} / ${input.expected.cls} / Lv.${input.expected.lv}`,
        ok: failures.length === 0, failures
      });
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  for (const row of results) {
    console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.file}  ${row.role}  sha256=${row.sha256}`);
    for (const failure of row.failures) console.error('  - ' + failure);
  }
  if (results.some(r => !r.ok)) throw new Error('有存檔相容性測試失敗');
  return results;
}

if (typeof process !== 'undefined' && process.argv && process.argv[1] &&
    fileURLToPath(import.meta.url) === process.argv[1]) {
  await testSaveFiles(process.argv.slice(2));
}
