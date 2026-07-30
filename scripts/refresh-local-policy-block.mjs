import { readFileSync, writeFileSync } from 'node:fs';

const INDEX = 'index.html';
const TEMPLATE = 'scripts/local-policy-block.html';
const BEGIN = '<!-- BEGIN JESPER LOCAL POLICY -->';
const END = '<!-- END JESPER LOCAL POLICY -->';

let index = readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
let block = readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n').trimEnd();

const versionedSources = new Map();
for (const match of index.matchAll(/<script src="(afk-[^"?]+\.js)(\?v=[^"]+)?"><\/script>/g)) {
  if (match[2]) versionedSources.set(match[1], match[1] + match[2]);
}
block = block.replace(/<script src="(afk-[^"?]+\.js)"><\/script>/g, (tag, file) => {
  const source = versionedSources.get(file);
  return source ? `<script src="${source}"></script>` : tag;
});

let start = index.indexOf(BEGIN);
let end = index.indexOf(END);
if (start >= 0 || end >= 0) {
  if (start < 0 || end < start || index.indexOf(BEGIN, start + BEGIN.length) >= 0 ||
      index.indexOf(END, end + END.length) >= 0) {
    throw new Error('index.html 的 Jesper 本地政策標記不完整或重複，拒絕改寫。');
  }
  start = index.lastIndexOf('\n', start) + 1;
  end += END.length;
} else {
  const legacyStart = index.search(/^[ \t]*<!-- Jesper 本地層：/m);
  const legacyEndMatch = /[ \t]*<script src="afk-powersave-inventory\.js(?:\?v=[^"]*)?"><\/script>[ \t]*/g;
  legacyEndMatch.lastIndex = Math.max(0, legacyStart);
  const match = legacyEndMatch.exec(index);
  if (legacyStart < 0 || !match) {
    throw new Error('index.html 找不到既有 Jesper 本地政策區塊，拒絕猜測插入位置。');
  }
  start = legacyStart;
  end = match.index + match[0].length;
}

const next = index.slice(0, start) + block + index.slice(end);
const localFiles = [...block.matchAll(/<script src="(afk-[^"?]+\.js)/g)].map(match => match[1]);
for (const file of localFiles) {
  const count = [...next.matchAll(new RegExp(`<script src="${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?v=[^"]*)?">`, 'g'))].length;
  if (count !== 1) throw new Error(`${file} 在 index.html 中出現 ${count} 次，拒絕寫入。`);
}
const offlineAt = next.indexOf('<script src="afk-offline.js');
if (offlineAt < 0 || next.indexOf('<script src="afk-junk-autosell-policy.js') > offlineAt) {
  throw new Error('廢品政策檔必須載於 PP afk-offline.js 前。');
}

if (next !== index) {
  writeFileSync(INDEX, next);
  console.log('✅ index.html 的 Jesper 本地政策區塊已由模板更新。');
} else {
  console.log('✅ index.html 的 Jesper 本地政策區塊已是最新。');
}
