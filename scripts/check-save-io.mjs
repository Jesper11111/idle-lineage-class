/* ============================================================================
 * check-save-io.mjs — 盯住上游的「存檔寫入/壓縮」那段，改了就大聲失敗
 *
 * 為什麼要這支:`afk-synccompress`(存檔即時壓縮)是全專案唯一會「替換掉核心存檔寫入函式」
 *   的外掛——它把 `_lzSet` 換成同步壓縮版,並自己去動 `_lzWorkerRev`、直接呼叫 `_lsSet`、
 *   自己拼 `'LZ1:' + LZString.compressToUTF16(...)` 的格式。這些全是「上游現在剛好長這樣」
 *   的假設。作者一旦改了存檔格式/前綴/Worker 對帳邏輯,外掛還照舊寫,寫出去的就是
 *   **格式不對的存檔** → 玩家讀不回來 = 存檔損壞,而且 smoke 只驗掛點、驗不到這個。
 *
 * 做法:保留兩套不可混用的基準：
 *   - 預設：PP 原始核心，供 sync-upstream 在 apply-core 前把關。
 *   - --patched：本站套完 apply-core 後的核心，確認本地存檔補丁沒有漂移。
 *     - 完全一致 → exit 0(同步照常往下走)
 *     - 有任何一支變了/不見了 → exit 1,列出是哪幾支,要求人工比對 diff 後再決定
 * 函式 sha 之外，也驗整個 Worker 區塊與關頁存檔區塊，避免上游新增 helper 後被整段補丁靜默刪除。
 *
 * 用法:
 *   node scripts/check-save-io.mjs                         # 檢查 PP 原始核心
 *   node scripts/check-save-io.mjs --patched               # 檢查本站補丁後核心
 *   node scripts/check-save-io.mjs --source-ref <git-ref>  # 讀指定 commit 的兩個核心檔
 *   node scripts/check-save-io.mjs --source-dir <PP目錄>   # 同步覆蓋前先讀外部 checkout
 *   人工複核後只能明確使用 --accept-upstream 或 --accept-patched，禁止混收兩套基準。
 * ========================================================================== */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const SRC = 'js/00-data.js';
const CLOSE_SRC = 'js/13-shop-save.js';
const CKPT = 'upstream-checkpoint.json';
const ACCEPT_UPSTREAM = process.argv.includes('--accept-upstream');
const ACCEPT_PATCHED = process.argv.includes('--accept-patched');
const EXPLICIT_PATCHED = process.argv.includes('--patched');
if (process.argv.includes('--accept') || (ACCEPT_UPSTREAM && ACCEPT_PATCHED) ||
    (ACCEPT_UPSTREAM && EXPLICIT_PATCHED)) {
  console.error('❌ 禁止模糊的 --accept；請明確使用 --accept-upstream 或 --accept-patched。');
  process.exit(1);
}
const PATCHED = process.argv.includes('--patched') || ACCEPT_PATCHED;
const sourceRefAt = process.argv.indexOf('--source-ref');
const sourceRef = sourceRefAt >= 0 ? process.argv[sourceRefAt + 1] : null;
const sourceDirAt = process.argv.indexOf('--source-dir');
const sourceDir = sourceDirAt >= 0 ? process.argv[sourceDirAt + 1] : null;
if ((sourceRefAt >= 0 && !sourceRef) || (sourceDirAt >= 0 && !sourceDir) || (sourceRef && sourceDir)) {
  console.error('❌ --source-ref／--source-dir 必須擇一，且後面要有值。');
  process.exit(1);
}

// 這幾支＝afk-synccompress 的假設所繫。少一支或內容變了都要人工看過。
const UPSTREAM_WATCHED = [
  '_lsSet',              // 外掛直接呼叫它寫 localStorage
  '_lzSet',              // 外掛整支覆寫它(同步壓縮版)
  '_lzGet',              // 讀取端:'LZ1:' 前綴的解讀方式
  '_lzSetStoredRaw',     // 直接覆寫原文時如何讓在途 Worker 結果失效
  '_lzRemoveStored',
  '_getLzWorker',        // 背景壓縮 Worker 本體(壓出來的格式)
  '_queueLzCompression', // rev/raw 對帳機制(外掛靠 bump rev 讓舊結果失效)
];
const PATCHED_WATCHED = [
  ...UPSTREAM_WATCHED,
  '_cancelLzCompressionKey',
  '_drainLzCompression',
];
const WATCHED = PATCHED ? PATCHED_WATCHED : UPSTREAM_WATCHED;
// 全域變數宣告那行(外掛會去 bump `_lzWorkerRev`)
const WATCHED_DECL = '_lzWorker';

function fnSource(src, name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) return null;
  const start = at + 1;
  let i = src.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}
function declSource(src, name) {
  const m = new RegExp('^var ' + name + ' = .*$', 'm').exec(src);
  return m ? m[0] : null;
}
const sha = (s) => createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

function readSource(file) {
  if (sourceRef) {
    return execFileSync('git', ['show', `${sourceRef}:${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  }
  return readFileSync(sourceDir ? join(sourceDir, file) : file, 'utf8');
}
function between(src, startText, endText) {
  const start = src.indexOf(startText);
  const end = src.indexOf(endText, start);
  return start >= 0 && end > start ? src.slice(start, end) : null;
}

const src = readSource(SRC);
const closeSrc = readSource(CLOSE_SRC);
const hasPatchedQueue = src.includes('_lzWorkerPending = Object.create(null)');
const hasPatchedFlush = closeSrc.includes('function _closeFlushClock()');
const structureMatches = PATCHED
  ? (hasPatchedQueue && hasPatchedFlush)
  : (!hasPatchedQueue && !hasPatchedFlush);
if (!structureMatches) {
  console.error(`❌ 目前來源是${hasPatchedQueue || hasPatchedFlush ? '補丁後／混合' : 'PP 原始'}結構，不能當成${PATCHED ? '補丁後' : 'PP 原始'}基準。`);
  process.exit(1);
}
const now = {};
const missing = [];
for (const name of WATCHED) {
  const body = fnSource(src, name);
  if (body == null) { missing.push('function ' + name); continue; }
  now[name] = sha(body);
}
const decl = declSource(src, WATCHED_DECL);
if (decl == null) missing.push('var ' + WATCHED_DECL); else now['var ' + WATCHED_DECL] = sha(decl);
const workerBlock = between(src, 'var _lzWorker =', '// 一次性遷移：');
const closeStart = PATCHED ? 'let _lastCloseFlushAt =' : 'function _flushSaveNow(){';
const closeFlushBlock = between(
  closeSrc,
  closeStart,
  "if(typeof document !== 'undefined' && document.addEventListener)"
);
if (!workerBlock) missing.push('workerBlock');
if (!closeFlushBlock) missing.push('closeFlushBlock');
const nowBlocks = {
  workerBlock: workerBlock ? sha(workerBlock) : null,
  closeFlushBlock: closeFlushBlock ? sha(closeFlushBlock) : null,
};

const ck = JSON.parse(readFileSync(CKPT, 'utf8'));

if (ACCEPT_UPSTREAM || ACCEPT_PATCHED) {
  if (missing.length) {
    console.error('❌ 還有抓不到的目標,不能收下:' + missing.join('、'));
    console.error('   代表上游把它改名/移除了 → 先確認 afk-synccompress.js 要怎麼跟上,再更新本腳本的 WATCHED。');
    process.exit(1);
  }
  const t = new Date(Date.now() + 8 * 3600 * 1000);   // 台灣時間(不可依賴 TZ 環境變數)
  ck.saveIo = ck.saveIo || {};
  ck.saveIo.note = '存檔 I/O 保留 PP 原始與本站補丁後兩套 sha(見 scripts/check-save-io.mjs)，同步前後分開把關。';
  ck.saveIo.reviewedAt = t.toISOString().slice(0, 16).replace('T', ' ') + ' (UTC+8)';
  ck.saveIo[PATCHED ? 'patchedFns' : 'fns'] = now;
  ck.saveIo[PATCHED ? 'patchedBlocks' : 'blocks'] = nowBlocks;
  writeFileSync(CKPT, JSON.stringify(ck, null, 2) + '\n');
  console.log(`✅ 已收下${PATCHED ? '本站補丁後' : 'PP 原始'}存檔 I/O 基準(${Object.keys(now).length} 項)。`);
  process.exit(0);
}

const base = (ck.saveIo && ck.saveIo[PATCHED ? 'patchedFns' : 'fns']) || null;
const baseBlocks = (ck.saveIo && ck.saveIo[PATCHED ? 'patchedBlocks' : 'blocks']) || null;
if (!base || !baseBlocks) {
  console.error(`❌ upstream-checkpoint.json 還沒有${PATCHED ? '本站補丁後' : 'PP 原始'} saveIo 基準。`);
  console.error(`   先人工確認相容性，再跑：node scripts/check-save-io.mjs --accept-${PATCHED ? 'patched' : 'upstream'}`);
  process.exit(1);
}

const changed = Object.keys(now).filter((k) => base[k] && base[k] !== now[k]);
const added = Object.keys(now).filter((k) => !base[k]);
const gone = Object.keys(base).filter((k) => !(k in now));
const changedBlocks = Object.keys(nowBlocks).filter((k) => baseBlocks[k] !== nowBlocks[k]);

if (!missing.length && !changed.length && !added.length && !gone.length && !changedBlocks.length) {
  console.log(`✅ ${PATCHED ? '本站補丁後' : 'PP 原始'}存檔 I/O 與基準一致(${Object.keys(now).length} 函式／宣告 + 2 整段)。`);
  process.exit(0);
}

console.error(`❌ ${PATCHED ? '本站補丁後' : 'PP 原始'}「存檔寫入/壓縮」與基準不一致。`);
if (missing.length) console.error('   找不到(改名/移除?):' + missing.join('、'));
if (changed.length) console.error('   內容變了:' + changed.join('、'));
if (added.length) console.error('   新增受監控項:' + added.join('、'));
if (gone.length) console.error('   基準裡有、現在抓不到:' + gone.join('、'));
if (changedBlocks.length) console.error('   整段內容變了:' + changedBlocks.join('、'));
console.error('');
console.error('   要做的事:');
console.error('     1. 讀上游這幾支的 diff(js/00-data.js),看存檔前綴/Worker 對帳/失敗退路有沒有變。');
console.error('     2. 對照 afk-synccompress.js:它覆寫 _lzSet、bump _lzWorkerRev、自己拼 "LZ1:"+compressToUTF16、退路呼叫 _lsSet。');
console.error(`     3. 有影響就先改外掛／補丁；沒影響再跑：node scripts/check-save-io.mjs --accept-${PATCHED ? 'patched' : 'upstream'}`);
process.exit(1);
