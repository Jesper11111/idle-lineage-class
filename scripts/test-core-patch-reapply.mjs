import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirAt = process.argv.indexOf('--source-dir');
const sourceRefAt = process.argv.indexOf('--source-ref');
if (sourceDirAt >= 0 && sourceRefAt >= 0) {
  throw new Error('--source-dir 與 --source-ref 只能擇一');
}
const sourceDir = sourceDirAt >= 0 ? resolve(process.argv[sourceDirAt + 1] || '') : '';
const sourceRef = sourceRefAt >= 0 ? process.argv[sourceRefAt + 1] : 'upstream/main';
if (sourceDir && (!isAbsolute(sourceDir) || !existsSync(join(sourceDir, 'index.html')))) {
  throw new Error('--source-dir 必須是含 index.html 的完整上游 checkout');
}

// 核心、外掛生命週期與離線安全補丁只讀寫這些檔案。
// 預演刻意不複製 assets，讓同步前檢查快速且不碰工作樹。
const TARGETS = [
  'index.html', 'sw.js', 'afk-pwa.js',
  'afk-bossring.js', 'afk-junkmgr.js', 'afk-mobile.js', 'afk-offline.js', 'afk-powersave.js',
  'afk-skin.js', 'afk-slotinfo.js', 'afk-synccompress.js', 'afk-toggles.js', 'afk-training.js',
  'afk-wiki.js',
  'js/00-data.js', 'js/01-drops-config.js', 'js/03-combat-core.js', 'js/05-kill-progression.js',
  'js/06-status-allies.js', 'js/07-skills-cast.js', 'js/08-items-equip.js',
  'js/09-vfx-render.js', 'js/10-ui-tabs.js', 'js/11-world-map.js',
  'js/13-shop-save.js', 'js/15-cards.js', 'js/22-pets.js',
  'js/24-pandora-relic-market.js', 'js/25-clan-system.js',
  'js/27-offline-rewards.js', 'js/28-pvp-arena.js',
];

function sourceBytes(relativePath) {
  if (sourceDir) return readFileSync(join(sourceDir, relativePath));
  return execFileSync('git', ['show', `${sourceRef}:${relativePath}`], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function treeHash(root) {
  const hash = createHash('sha256');
  for (const relativePath of TARGETS) {
    hash.update(relativePath);
    hash.update(readFileSync(join(root, relativePath)));
  }
  return hash.digest('hex');
}

function runPatch(root, args = []) {
  try {
    return execFileSync(process.execPath, ['scripts/apply-core-patches.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`乾淨上游套補丁失敗：\n${details || error.message}`);
  }
}

function runPluginPatch(root, args = []) {
  try {
    return execFileSync(process.execPath, ['scripts/apply-plugin-lifecycle-patches.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`乾淨上游外掛套補丁失敗：\n${details || error.message}`);
  }
}

function runOfflinePatch(root, args = []) {
  try {
    return execFileSync(process.execPath, ['scripts/apply-offline-safety-patches.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`乾淨上游離線安全補丁失敗：\n${details || error.message}`);
  }
}

const fixture = mkdtempSync(join(tmpdir(), 'afk-core-patch-'));
try {
  for (const relativePath of TARGETS) {
    const target = join(fixture, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, sourceBytes(relativePath));
  }
  mkdirSync(join(fixture, 'scripts'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'apply-core-patches.mjs'),
    join(fixture, 'scripts', 'apply-core-patches.mjs'));
  copyFileSync(join(ROOT, 'scripts', 'apply-plugin-lifecycle-patches.mjs'),
    join(fixture, 'scripts', 'apply-plugin-lifecycle-patches.mjs'));
  copyFileSync(join(ROOT, 'scripts', 'apply-offline-safety-patches.mjs'),
    join(fixture, 'scripts', 'apply-offline-safety-patches.mjs'));

  const first = runPatch(fixture);
  const firstPlugin = runPluginPatch(fixture);
  const firstOffline = runOfflinePatch(fixture);
  const patchedCore = readFileSync(join(fixture, 'js/03-combat-core.js'), 'utf8');
  for (const marker of [
    '_ffProgressUpdate(_ffAcc, _tickDebt, true);',
    'function _ffReanchorCatchupClock()',
    'const FF_PROGRESS_INTERVAL_MS = 250;',
    'if (player.dead || _ffAcc.aborted) _tickDebt = 0;',
    'let _ffResumeGeneration = 0;',
    '_ffResumeToken !== _ffResumeGeneration',
    '_ffResumeGeneration++;',
    '收尾重繪／大型存檔也屬於 housekeeping',
    '前景補跑讓步時間暫停遊戲鐘',
  ]) {
    assert.ok(patchedCore.includes(marker), `乾淨來源套補丁後缺少手機補算 marker: ${marker}`);
  }
  assert.doesNotMatch(patchedCore, /overloadDroppedMs|FF_MOBILE_MAX_CATCHUP_WALL_MS|adaptiveMinTicks/,
    '乾淨來源套補丁後不得產生會略過債務或強迫長任務的舊停損');
  const patchedDrops = readFileSync(join(fixture, 'js/01-drops-config.js'), 'utf8');
  assert.match(patchedDrops, /凍結前作廢前景續跑；回前景不得由逾期 callback 先吞掉 hidden elapsed/,
    '乾淨來源套補丁後，visibility hidden 必須作廢舊補跑 callback');
  assert.match(patchedDrops, /bfcache／pagehide 也作廢已排程的前景 callback/,
    '乾淨來源套補丁後，pagehide 必須作廢舊補跑 callback');
  const patchedSave = readFileSync(join(fixture, 'js/13-shop-save.js'), 'utf8');
  assert.match(patchedSave, /成功提示不是持久化交易的一部分/,
    '乾淨來源套補丁後必須隔離成功日誌例外');
  assert.match(patchedSave, /本次進度未完整寫入/,
    '乾淨來源套補丁後必須保留精確失敗提示');
  const firstHash = treeHash(fixture);
  const second = runPatch(fixture);
  const secondPlugin = runPluginPatch(fixture);
  const secondOffline = runOfflinePatch(fixture);
  const secondHash = treeHash(fixture);
  assert.equal(secondHash, firstHash, '第二次重套改變了檔案，補丁不具冪等性');
  assert.match(second, /新套用 0/, '第二次重套仍宣稱有新補丁');
  assert.match(secondPlugin, /新套用 0/, '第二次重套仍宣稱有外掛補丁');
  assert.match(secondOffline, /已套用 Jesper 離線安全政策/, '第二次重套離線安全補丁失敗');
  const check = runPatch(fixture, ['--check']);
  const pluginCheck = runPluginPatch(fixture, ['--check']);
  const offlineCheck = runOfflinePatch(fixture, ['--check']);
  assert.match(check, /全部 \d+ 個核心補丁均已就位/, '--check 未確認完整補丁');
  assert.match(pluginCheck, /8 支 PP 外掛生命週期修正完整/, '外掛 --check 未確認完整補丁');
  assert.match(offlineCheck, /--check：離線安全政策均已就位/, '離線安全 --check 未確認完整補丁');

  console.log(`✅ 乾淨上游核心／外掛／離線補丁預演：首次完整套用、第二次零變更、--check 通過（${sourceDir || sourceRef}）`);
  if (process.env.AFK_PATCH_TEST_VERBOSE === '1') {
    console.log(first.trim(), firstPlugin.trim(), firstOffline.trim());
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
