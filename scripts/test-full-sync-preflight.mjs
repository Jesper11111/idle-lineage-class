import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
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

const LOCAL_POLICY_FILES = [
  'afk-mobile-banner.js',
  'afk-offline-owner.js',
  'afk-merc-policy.js',
  'afk-mobile-memory.js',
  'afk-mobile-audio-memory.js',
  'afk-powersave-inventory.js',
];
const UPSTREAM_ASSET_FILES = [
  'assets/icons/items/無限火藥爆裂矢.png',
];
const PATCH_SCRIPTS = [
  'scripts/apply-core-patches.mjs',
  'scripts/apply-plugin-lifecycle-patches.mjs',
  'scripts/apply-shines-backports.mjs',
  'scripts/apply-policy-patches.mjs',
  'scripts/apply-offline-safety-patches.mjs',
];

function upstreamFileList() {
  let paths;
  if (sourceDir) {
    paths = [
      'index.html',
      ...(existsSync(join(sourceDir, 'sw.js')) ? ['sw.js'] : []),
      ...readdirSync(sourceDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && /^afk-.+\.js$/.test(entry.name))
        .map(entry => entry.name),
      ...readdirSync(join(sourceDir, 'js'), { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
        .map(entry => `js/${entry.name}`),
    ];
  } else {
    const rootPaths = execFileSync('git', ['ls-tree', '--name-only', sourceRef], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }).split(/\r?\n/).filter(path =>
      path === 'index.html' || path === 'sw.js' || /^afk-.+\.js$/.test(path)
    );
    const jsPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', sourceRef, '--', 'js'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    }).split(/\r?\n/).filter(path => /^js\/[^/]+\.js$/.test(path));
    paths = [...rootPaths, ...jsPaths];
  }
  return [...new Set(paths)].sort();
}

function sourceBytes(relativePath) {
  if (sourceDir) return readFileSync(join(sourceDir, relativePath));
  return execFileSync('git', ['show', `${sourceRef}:${relativePath}`], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function copyIntoFixture(fixture, relativePath, bytes) {
  const target = join(fixture, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

function treeHash(fixture, paths) {
  const hash = createHash('sha256');
  for (const relativePath of [...paths].sort()) {
    hash.update(relativePath);
    hash.update(readFileSync(join(fixture, relativePath)));
  }
  return hash.digest('hex');
}

function runPatch(fixture, script, args = []) {
  try {
    return execFileSync(process.execPath, [script, ...args], {
      cwd: fixture,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`完整同步預演失敗（${script}）：\n${details || error.message}`);
  }
}

function copyPreservedAssets(fixture) {
  const list = readFileSync(join(ROOT, 'scripts', 'shines-backport-assets.txt'), 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('/'));
  for (const listed of list) {
    const relativePath = `assets/${listed.replace(/^\/+|\/+$/g, '')}`;
    const source = join(ROOT, relativePath);
    if (!existsSync(source)) throw new Error(`保留資產不存在：${relativePath}`);
    const target = join(fixture, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    if (statSync(source).isDirectory()) {
      symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    } else {
      copyFileSync(source, target);
    }
  }
}

const upstreamFiles = upstreamFileList();
const hashedFiles = [...new Set([...upstreamFiles, ...LOCAL_POLICY_FILES])];
const fixture = mkdtempSync(join(tmpdir(), 'afk-full-sync-preflight-'));
try {
  for (const relativePath of upstreamFiles) {
    copyIntoFixture(fixture, relativePath, sourceBytes(relativePath));
  }
  for (const relativePath of UPSTREAM_ASSET_FILES) {
    copyIntoFixture(fixture, relativePath, sourceBytes(relativePath));
  }
  for (const relativePath of LOCAL_POLICY_FILES) {
    copyIntoFixture(fixture, relativePath, readFileSync(join(ROOT, relativePath)));
  }

  mkdirSync(join(fixture, 'scripts'), { recursive: true });
  for (const relativePath of PATCH_SCRIPTS) {
    copyFileSync(join(ROOT, relativePath), join(fixture, relativePath));
  }
  copyFileSync(join(ROOT, 'scripts', 'local-policy-block.html'),
    join(fixture, 'scripts', 'local-policy-block.html'));
  copyFileSync(join(ROOT, 'scripts', 'shines-backport-assets.txt'),
    join(fixture, 'scripts', 'shines-backport-assets.txt'));
  cpSync(join(ROOT, 'scripts', 'backports'), join(fixture, 'scripts', 'backports'), { recursive: true });
  copyPreservedAssets(fixture);

  let index = readFileSync(join(fixture, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const block = readFileSync(join(fixture, 'scripts', 'local-policy-block.html'), 'utf8')
    .replace(/\r\n/g, '\n').trimEnd();
  if (LOCAL_POLICY_FILES.some(file => index.includes(file))) {
    throw new Error('上游 index.html 已出現本地政策檔，拒絕重複注入');
  }
  const offlineTag = index.match(/^[ \t]*<script src="afk-offline\.js(?:\?v=[^"]*)?"><\/script>[ \t]*$/m);
  if (!offlineTag) throw new Error('上游 index.html 找不到 afk-offline.js 載入標籤');
  index = index.replace(offlineTag[0], block + '\n' + offlineTag[0]);
  writeFileSync(join(fixture, 'index.html'), index);

  const firstOutputs = PATCH_SCRIPTS.map(script => runPatch(fixture, script));
  const firstHash = treeHash(fixture, hashedFiles);
  const secondOutputs = PATCH_SCRIPTS.map(script => runPatch(fixture, script));
  const secondHash = treeHash(fixture, hashedFiles);
  assert.equal(secondHash, firstHash, '第二次完整重套改變了檔案，補丁鏈不具冪等性');
  assert.match(secondOutputs[0], /新套用 0/, '核心補丁第二次仍有變更');
  assert.match(secondOutputs[1], /新套用 0/, '外掛生命週期第二次仍有變更');
  assert.match(secondOutputs[2], /新套用 0/, 'Shines 回移第二次仍有變更');

  const checkOutputs = PATCH_SCRIPTS.map(script => runPatch(fixture, script, ['--check']));
  assert.match(checkOutputs[0], /全部 \d+ 個核心補丁均已就位/, '核心 --check 未通過');
  assert.match(checkOutputs[1], /\d+ 支 PP 外掛生命週期修正完整/, '外掛 --check 未通過');
  assert.match(checkOutputs[2], /全部 \d+ 個 Shines 回移契約均已就位/, 'Shines --check 未通過');
  assert.match(checkOutputs[3], /傭兵均分經驗、掉寶 \+60%/, '政策 --check 未通過');
  assert.match(checkOutputs[4], /離線安全政策均已就位/, '離線 --check 未通過');

  console.log(`✅ 完整同步隔離預演：核心 → 外掛 → Shines → 政策 → 離線，首次套用、二次零變更、五層 --check 通過（${sourceDir || sourceRef}）`);
  if (process.env.AFK_PATCH_TEST_VERBOSE === '1') {
    console.log(firstOutputs.map(output => output.trim()).join('\n'));
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
