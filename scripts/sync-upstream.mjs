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
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const UP = process.argv[2];
if (!UP || !existsSync(join(UP, 'index.html'))) {
  console.error('用法: node scripts/sync-upstream.mjs <pp771007 clone dir>');
  process.exit(1);
}

function run(cmd) {
  console.log('$ ' + cmd);
  execSync(cmd, { stdio: 'inherit' });
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

// PP 完成品本身已含所有加掛核心鉤子；先鏡像最終 JS/CSS，再以 --check/錨點補丁驗證。
mirrorFlatDir('js', f => f.endsWith('.js'));
mirrorFlatDir('css');

const localAfkFiles = new Set([
  'afk-mobile-banner.js',
  'afk-offline-owner.js',
  'afk-merc-policy.js',
  'afk-mobile-memory.js',
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
run('node scripts/check-save-io.mjs');

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

run('node scripts/apply-core-patches.mjs');
run('node scripts/apply-shines-backports.mjs');
run('node scripts/apply-policy-patches.mjs');
run('node scripts/apply-offline-safety-patches.mjs');

run('node tools/gen-anim-manifest.js');
run('node scripts/gen-manifests.mjs');
run('node scripts/stamp-code-versions.mjs');

try {
  const upSha = execSync('git -C "' + UP + '" rev-parse HEAD', { encoding: 'utf8' }).trim();
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
  console.warn('[sync] ⚠ upstream-checkpoint.json 未更新：' + e.message);
}

// checkpoint 必須排在 stamp-sw-version 前，version.json 的 upstreamAt 才會反映本次同步。
run('node scripts/stamp-sw-version.mjs');

if (process.env.AFK_SKIP_SMOKE === '1') {
  console.log('[sync] AFK_SKIP_SMOKE=1 → 跳過 smoke（呼叫端自行執行）');
} else {
  run('node scripts/smoke-hooks.mjs');
}

console.log('\n✅ PP-first 同步完成：PP 最新版 + Jesper 固定政策。');
