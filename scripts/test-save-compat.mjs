/**
 * 使用真實 SIG1 匯出檔驗證目前核心：
 *   - 簽章有效、JSON 可解析
 *   - 可載入並重新存成有效 SIG1
 *   - 角色身分、等級、背包、裝備、傭兵數不因載入／存檔往返而改變
 *   - 舊傭兵獎勵／招募／受僱政策與回城免費刷新生效、妖精傭兵不限目前屬性，且 PP v3.8.34 戰鬥模組仍存在
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

function itemSignature(it) {
  const star = Math.max(1, Math.min(3, Math.floor(Number(it.attrMagicStar) || 1)));
  return it.id + '|' + (it.en || 0) + '|' +
    (it.bless === true ? 'B' : (it.bless ? 'C' : 0)) + '|' +
    (it.anc === true ? 'A' : (it.anc || 0)) + '|' +
    (it.attr || '') + '|' + (it.seteff || '') +
    (it.attrMagic ? '|' + it.attrMagic + (star > 1 ? '@' + star : '') : '');
}

function inventoryIdentity(items) {
  const totals = new Map();
  const nonWishSignatures = new Set();
  let wishSlots = 0;
  let totalCount = 0;
  for (const item of items || []) {
    const count = item.cnt || 1;
    const signature = itemSignature(item);
    const key = item.gw ? signature + '|gw:' + JSON.stringify(item.gw) : signature;
    totals.set(key, (totals.get(key) || 0) + count);
    totalCount += count;
    if (item.gw) wishSlots++;
    else nonWishSignatures.add(signature);
  }
  return {
    invCount: nonWishSignatures.size + wishSlots,
    invTotal: totalCount,
    invSignatures: [...totals].sort((a, b) => a[0].localeCompare(b[0])),
  };
}

function identityOf(p) {
  const eq = {};
  for (const [k, v] of Object.entries((p && p.eq) || {})) eq[k] = v && v.id ? v.id : null;
  const inventory = inventoryIdentity((p && p.inv) || []);
  return {
    cls: p && p.cls, name: p && p.name, enSeed: p && p.enSeed,
    classicMode: !!(p && p.classicMode), lv: p && p.lv,
    ...inventory,
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
        if (exported.wh) {
          const warehouse = {
            items: Array.isArray(exported.wh.items) ? exported.wh.items : [],
            gold: Number.isFinite(Number(exported.wh.gold)) ? Math.max(0, Math.floor(Number(exported.wh.gold))) : 0,
          };
          if (!_lzSet(whKey(exported.p), JSON.stringify(warehouse))) return { error: '測試倉庫寫入失敗' };
        }
        localStorage.removeItem('afk_ts_' + slot);
        localStorage.removeItem('afk_map_' + slot);
        if (!_lzSet('lineage_idle_save_' + slot, _saveWrap(JSON.stringify(clean)))) return { error: '測試存檔寫入失敗' };
        currentSlot = slot;
        const originalLoadWarehouse = window.loadWarehouse;
        let loadWarehouseCalls = 0;
        window.loadWarehouse = function () {
          loadWarehouseCalls++;
          return originalLoadWarehouse.apply(this, arguments);
        };
        try {
          loadGame();
        } finally {
          window.loadWarehouse = originalLoadWarehouse;
        }
        const loadedWarehouse = originalLoadWarehouse();
        const expectedWarehouseItems = exported.wh && Array.isArray(exported.wh.items)
          ? exported.wh.items.filter(item => item && item.id &&
              (DB.items[item.id] || (typeof _PET_LEGACY_COLLARS !== 'undefined' && _PET_LEGACY_COLLARS[item.id])))
          : [];
        const expectedWarehouseTotal = expectedWarehouseItems.reduce((sum, item) => sum + (item.cnt || 1), 0);
        const loadedWarehouseTotal = (loadedWarehouse.items || []).reduce((sum, item) => sum + (item.cnt || 1), 0);
        const originalTownRefresh = window.refreshAllAllies;
        let townRefreshCalls = 0;
        const goldBeforeTownRefresh = player.gold || 0;
        window.refreshAllAllies = function () {
          townRefreshCalls++;
          return originalTownRefresh.apply(this, arguments);
        };
        try {
          setMapSelectors(getHomeTown());
          changeMap(true);
        } finally {
          window.refreshAllAllies = originalTownRefresh;
        }
        const townRefreshGoldDelta = (player.gold || 0) - goldBeforeTownRefresh;
        saveGame();

        const stored = _saveUnwrap(_lzGet('lineage_idle_save_' + slot));
        if (!stored || !stored.signed || !stored.ok) return { error: '載入後重新存檔的簽章驗證失敗' };
        const p = JSON.parse(stored.payload).p;
        const eq = {};
        for (const k in (p.eq || {})) eq[k] = p.eq[k] && p.eq[k].id ? p.eq[k].id : null;
        const totals = new Map();
        let invTotal = 0;
        for (const item of p.inv || []) {
          const count = item.cnt || 1;
          const signature = itemSig(item);
          const key = item.gw ? signature + '|gw:' + JSON.stringify(item.gw) : signature;
          totals.set(key, (totals.get(key) || 0) + count);
          invTotal += count;
        }
        const employmentKeys = [];
        for (let n = 0; n < localStorage.length; n++) {
          const key = localStorage.key(n);
          if (key && key.startsWith('fb5_mercenary_employment_v1_')) employmentKeys.push(key);
        }
        const activeAllies = (player.allies || []).filter(a => a && !a._downed).length;
        return {
          identity: {
            cls: p.cls, name: p.name, enSeed: p.enSeed, classicMode: !!p.classicMode, lv: p.lv,
            invCount: (p.inv || []).length,
            invTotal,
            invSignatures: [...totals].sort((a, b) => a[0].localeCompare(b[0])),
            allyCount: (p.allies || []).length,
            eq
          },
          warehouseProvided: !!exported.wh,
          expectedWarehouseTotal,
          loadedWarehouseTotal,
          expectedWarehouseGold: exported.wh
            ? (Number.isFinite(Number(exported.wh.gold)) ? Math.max(0, Math.floor(Number(exported.wh.gold))) : 0)
            : 0,
          loadedWarehouseGold: loadedWarehouse.gold || 0,
          loadWarehouseCalls,
          version: GAME_VERSION,
          signedRoundtrip: true,
          partyCount: partyExpShareCount(),
          expectedPartyCount: Math.min(8, 1 + activeAllies),
          expDivisor: partyExpShareDivisor(),
          expectedExpDivisor: 1 + Math.min(7, activeAllies) * 0.4,
          rewardMult: partyRewardMult(),
          dropMult: partyDropMult(),
          expectedDropMult: 1 + Math.min(7, activeAllies) * 0.6,
          dropRate: partyDropRate(0.125),
          expectedDropRate: Math.min(1, 0.125 * (1 + Math.min(7, activeAllies) * 0.6)),
          employmentKeys,
          safeAreaBlocked: mercenaryRoleBattleBlocked('dragon_valley', false),
          rehireCosts: [mercRehireCost(1), mercRehireCost(50), mercRehireCost(100)],
          legacyPolicy: window.__legacyMercPolicy && window.__legacyMercPolicy.version,
          townRefresh: window.__legacyMercPolicy && window.__legacyMercPolicy.townRefresh,
          paidManualRehire: window.__legacyMercPolicy && window.__legacyMercPolicy.paidManualRehire,
          townRefreshUsesCore: typeof refreshAllAllies === 'function' && refreshAllAllies !== mercBankAlliesAtTown,
          townRefreshCalls,
          townRefreshGoldDelta,
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
        if (got.warehouseProvided &&
            (got.loadedWarehouseTotal !== got.expectedWarehouseTotal ||
             got.loadedWarehouseGold !== got.expectedWarehouseGold)) {
          failures.push(`倉庫資料載入後不一致（物品 ${got.expectedWarehouseTotal} → ${got.loadedWarehouseTotal}；金幣 ${got.expectedWarehouseGold} → ${got.loadedWarehouseGold}）`);
        }
        if (got.loadWarehouseCalls !== 1) failures.push(`載入角色期間重複解析倉庫 ${got.loadWarehouseCalls} 次`);
        if (got.version !== 'v3.8.34') failures.push('核心版本不是 PP v3.8.34');
        if (got.partyCount !== got.expectedPartyCount) failures.push('傭兵存活成員數相容值錯誤');
        if (Math.abs(got.expDivisor - got.expectedExpDivisor) > 1e-12) failures.push('傭兵經驗 0.4 權重分母錯誤');
        if (got.rewardMult !== 1) failures.push('金幣仍有隊伍人數加乘');
        if (Math.abs(got.dropMult - got.expectedDropMult) > 1e-12 ||
            Math.abs(got.dropRate - got.expectedDropRate) > 1e-12) {
          failures.push(`傭兵掉寶倍率錯誤（${got.dropMult}/${got.dropRate}，預期 ${got.expectedDropMult}/${got.expectedDropRate}）`);
        }
        if (got.employmentKeys.length) failures.push('仍寫入反向受僱登記');
        if (got.safeAreaBlocked !== false) failures.push('受僱角色仍被鎖在安全區');
        if (JSON.stringify(got.rehireCosts) !== JSON.stringify([0, 0, 0])) failures.push('免費更新快照費率錯誤');
        if (got.legacyPolicy !== 'weighted-exp04-royal30-drop60-town-refresh-on-pp-v3.8.34') failures.push('傭兵混合政策層未啟動');
        if (got.townRefresh !== true || got.paidManualRehire !== false || !got.townRefreshUsesCore) {
          failures.push('回城免費自動刷新快照政策未完整啟動：' + JSON.stringify({
            townRefresh: got.townRefresh,
            paidManualRehire: got.paidManualRehire,
            townRefreshUsesCore: got.townRefreshUsesCore
          }));
        }
        if (got.townRefreshCalls !== 1 || got.townRefreshGoldDelta !== 0) {
          failures.push(`回城刷新呼叫／費用錯誤（calls=${got.townRefreshCalls}, goldDelta=${got.townRefreshGoldDelta}）`);
        }
        if (got.mercElementRestriction !== false || got.mismatchedElfSkillAllowed !== true) failures.push('妖精傭兵仍受目前屬性限制');
        if (got.offlineVersion !== '2.3.0-jesper-rift-offline' || got.offlineOwner !== true) failures.push('裂痕離線安全引擎未獨占啟動');
        if (got.siegeStages !== 5 || !got.threatEnabled || got.mercThreatKey !== 'A:test' || !got.bindMercSupported || !got.guardLoaded) {
          failures.push('PP v3.8.34 戰鬥模組未完整作用於傭兵');
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
