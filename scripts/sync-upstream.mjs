/**
 * sync-upstream.mjs — 以 pp771007 完成品為新版基準，再套 Jesper 本地政策。
 *
 * <upstream-dir> 必須是 pp771007/idle-lineage-class 的 checkout。
 * assets/public 由呼叫端先用 rsync --delete（或本機等價方式）鏡像；本腳本處理：
 *   1. 鏡像 PP 的 js/css、全部 afk-*.js（保留 Jesper 專用政策／效能檔）、sw.js 與 wiki checkpoint。
 *   2. 直接採用 PP index.html，只在 PP afk-offline.js 前注入本地政策層。
 *   3. 驗存檔 I/O，補回既有核心鉤子、核准的 Shines 回移、舊傭兵獎勵政策與離線安全政策。
 *   4. 重產 manifest、版本戳與 upstream checkpoint，再跑 smoke。
 *
 * 用法：node scripts/sync-upstream.mjs <pp-upstream-clone-dir>
 */
import {
  readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, rmSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const UP = process.argv[2];
if (!UP || !existsSync(join(UP, 'index.html'))) {
  console.error('用法: node scripts/sync-upstream.mjs <pp771007 clone dir>');
  process.exit(1);
}

function displayArg(arg) {
  const value = String(arg);
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value);
}

function runNode(script, ...args) {
  console.log('$ ' + [process.execPath, script, ...args].map(displayArg).join(' '));
  execFileSync(process.execPath, [script, ...args], { stdio: 'inherit' });
}

function mirrorFlatDir(name, accept = () => true) {
  const srcDir = join(UP, name);
  const dstDir = name;
  const upstreamFiles = new Set(readdirSync(srcDir, { withFileTypes: true })
    .filter(e => e.isFile() && accept(e.name))
    .map(e => e.name));
  for (const f of upstreamFiles) copyFileSync(join(srcDir, f), join(dstDir, f));
  for (const e of readdirSync(dstDir, { withFileTypes: true })) {
    if (e.isFile() && accept(e.name) && !upstreamFiles.has(e.name)) rmSync(join(dstDir, e.name));
  }
  console.log(`[sync] 鏡像 ${name}/：${upstreamFiles.size} 檔`);
}

// 先直接預演外部 PP checkout；五層補丁全通過前不可覆蓋目前可用工作樹。
// 隔離 fixture 會依正式順序驗證首次可套、第二次零變更與五層 --check。
runNode('scripts/test-full-sync-preflight.mjs', '--source-dir', UP);
runNode('scripts/check-save-io.mjs', '--source-dir', UP);

// PP 完成品本身已含所有加掛核心鉤子；先鏡像最終 JS/CSS，再以 --check/錨點補丁驗證。
mirrorFlatDir('js', f => f.endsWith('.js'));
mirrorFlatDir('css');

const localAfkFiles = new Set([
  'afk-mobile-banner.js',
  'afk-offline-owner.js',
  'afk-merc-policy.js',
  'afk-mobile-memory.js',
  'afk-mobile-audio-memory.js',
  'afk-powersave-inventory.js'
]);
const ppAfkFiles = readdirSync(UP).filter(f => /^afk-.+\.js$/.test(f) && !localAfkFiles.has(f));
for (const f of ppAfkFiles) copyFileSync(join(UP, f), f);
for (const f of readdirSync('.').filter(f => /^afk-.+\.js$/.test(f))) {
  if (!localAfkFiles.has(f) && !ppAfkFiles.includes(f)) rmSync(f);
}
console.log(`[sync] 鏡像 PP 外掛：${ppAfkFiles.length} 支；保留 Jesper 本地檔 ${[...localAfkFiles].join(', ')}`);

for (const f of ['sw.js', 'wiki-checkpoint.json']) {
  if (existsSync(join(UP, f))) copyFileSync(join(UP, f), f);
}

// 存檔 I/O 契約要在本地政策改寫前檢查。
runNode('scripts/check-save-io.mjs');

// PP index 已含完整加掛載入順序；只注入 Jesper 政策檔，禁止重複。
let idx = readFileSync(join(UP, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const block = readFileSync('scripts/local-policy-block.html', 'utf8').replace(/\r\n/g, '\n').trimEnd();
if ([...localAfkFiles].some(f => idx.includes(f))) {
  throw new Error('PP index.html 已出現 Jesper 政策檔，拒絕重複注入。');
}
const offlineTag = idx.match(/^[ \t]*<script src="afk-offline\.js(?:\?v=[^"]*)?"><\/script>[ \t]*$/m);
if (!offlineTag) throw new Error('PP index.html 找不到 afk-offline.js 載入標籤，無法保證政策層載入順序。');
idx = idx.replace(offlineTag[0], block + '\n' + offlineTag[0]);
writeFileSync('index.html', idx);
console.log('[sync] index.html = PP 完成品 + Jesper 本地政策層');

// 固定重套順序：核心 → PP 外掛生命週期 → Shines 回移 → Jesper 政策 → 離線安全。
// 全部套完才跑 --check 與行為測試，避免只驗到半套中間狀態。
const patchScripts = [
  'scripts/apply-core-patches.mjs',
  'scripts/apply-plugin-lifecycle-patches.mjs',
  'scripts/apply-shines-backports.mjs',
  'scripts/apply-policy-patches.mjs',
  'scripts/apply-offline-safety-patches.mjs',
];
for (const script of patchScripts) runNode(script);
for (const script of patchScripts) runNode(script, '--check');
runNode('scripts/check-save-io.mjs', '--patched');

runNode('tools/gen-anim-manifest.js');
runNode('scripts/gen-manifests.mjs');
runNode('scripts/stamp-code-versions.mjs');

try {
  const upSha = execFileSync('git', ['-C', UP, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const upVer = (readFileSync(join(UP, 'js', '00-data.js'), 'utf8').match(/GAME_VERSION = '([^']+)'/) || [])[1] || '?';
  const ck = JSON.parse(readFileSync('upstream-checkpoint.json', 'utf8'));
  ck.upstreamRepo = 'https://github.com/pp771007/idle-lineage-class.git';
  ck.syncedUpstreamCommit = upSha;
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  ck.syncedAt = t.toISOString().slice(0, 16).replace('T', ' ') + ' (UTC+8)';
  ck.note = '由 sync-upstream.mjs 自動更新；新版基準=pp771007/main，PP 內含原版 ' + upVer +
    '。同步後固定套用 Jesper 舊傭兵獎勵政策、回城免費更新快照、離線安全政策、妖精傭兵不受目前屬性限制與全裝置隱藏來源橫幅。';
  writeFileSync('upstream-checkpoint.json', JSON.stringify(ck, null, 2) + '\n');
  console.log('[sync] upstream-checkpoint.json → pp771007 ' + upSha.slice(0, 10) + '（原版 ' + upVer + '）');
} catch (e) {
  throw new Error('[sync] upstream-checkpoint.json 更新失敗，拒絕把來源不明的半套同步標成完成：' + e.message);
}

// checkpoint 必須排在 stamp-sw-version 前，version.json 的 upstreamAt 才會反映本次同步。
runNode('scripts/stamp-sw-version.mjs');

// 同步完整性閘門：存檔併發、手機圖片／背包／Wiki 生命週期、PWA、離線與回移都要通過。
const regressionTests = [
  ['scripts/test-save-compression-queue.mjs'],
  ['scripts/test-mobile-memory.mjs'],
  ['scripts/test-mobile-stability-stress.mjs'],
  ['scripts/test-mobile-stability-stress.mjs', '--webkit'],
  ['scripts/test-mobile-audio-memory.mjs'],
  ['scripts/test-powersave-inventory.mjs'],
  ['scripts/test-wiki-mobile-memory.mjs'],
  ['scripts/test-pwa-versioned-cache.mjs'],
  ['scripts/test-offline-bossring.mjs'],
  ['scripts/test-shines-backports.mjs'],
];
const privateSaveDir = '.testdata';
const privateSaveAvailable = existsSync(privateSaveDir) &&
  readdirSync(privateSaveDir).some((name) => /\.json$/i.test(name) && !name.startsWith('_'));
if (privateSaveAvailable) {
  regressionTests.splice(regressionTests.length - 1, 0, ['scripts/test-offline-bossring-integration.mjs']);
} else {
  console.log('[sync] .testdata 私人存檔不存在 → 離線真實存檔 integration 不在 CI 假裝通過；保留單元測試與合成角色雙引擎壓測。');
}
for (const [script, ...args] of regressionTests) runNode(script, ...args);

if (process.env.AFK_SKIP_SMOKE === '1') {
  console.log('[sync] AFK_SKIP_SMOKE=1 → 跳過 smoke（呼叫端自行執行）');
} else {
  runNode('scripts/smoke-hooks.mjs');
}

console.log('\n✅ PP-first 同步完成：PP 最新版 + Jesper 固定政策。');
