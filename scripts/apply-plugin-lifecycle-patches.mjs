/**
 * PP 會在每次同步覆蓋 afk-*.js。本腳本只把本站已審核的有界生命週期修正精確重套回去。
 * 所有檔案先在記憶體完成錨點與結果驗證，任何一支不相容時整批不寫入。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const outputs = new Map();
let changed = 0;

function read(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function replaceOnce(source, from, to, file, label) {
  const at = source.indexOf(from);
  if (at < 0) throw new Error(`[${file}] 找不到「${label}」錨點`);
  if (source.indexOf(from, at + from.length) >= 0) {
    throw new Error(`[${file}] 「${label}」錨點不只一處，拒絕不確定替換`);
  }
  return source.slice(0, at) + to + source.slice(at + from.length);
}

function patch(file, markers, transform) {
  const before = read(file);
  const present = markers.filter((marker) => before.includes(marker));
  if (present.length === markers.length) {
    outputs.set(file, before);
    return;
  }
  if (present.length) {
    throw new Error(`[${file}] 生命週期修正只剩 ${present.length}/${markers.length} 個標記，拒絕靜默補半套`);
  }
  const after = transform(before);
  const missing = markers.filter((marker) => !after.includes(marker));
  if (missing.length) throw new Error(`[${file}] 修正後驗證失敗：${missing.join(' | ')}`);
  outputs.set(file, after);
  changed++;
}

patch('afk-junkmgr.js', [
  "var nameCacheRole = '';",
  'if (roleKey !== nameCacheRole)',
  'if (!seen[s]) delete nameCache[s];',
], (input) => {
  let source = replaceOnce(
    input,
    '  var nameCache = Object.create(null);   // sig → { html, plain, icon, order }（名稱不會變，跨重建共用）',
    "  var nameCache = Object.create(null);   // sig → { html, plain, icon, order }（名稱不會變，跨重建共用）\n" +
    "  var nameCacheRole = '';   // 跨角色不共用：不同角色的數千筆歷史簽章不可在同頁永久累積",
    'afk-junkmgr.js',
    '名稱快取宣告'
  );
  source = replaceOnce(
    source,
    '  function rebuild() {\n    var prefs = (player.junkPrefs = player.junkPrefs || {});',
    "  function rebuild() {\n" +
    "    var roleKey = '';\n" +
    "    try {\n" +
    "      roleKey = String((typeof currentSlot !== 'undefined' && currentSlot != null ? currentSlot : '') ||\n" +
    "        player.enSeed || player._roleEpoch || player.name || 'role');\n" +
    "    } catch (e) {}\n" +
    "    if (roleKey !== nameCacheRole) {\n" +
    "      nameCacheRole = roleKey;\n" +
    "      nameCache = Object.create(null);\n" +
    "    }\n" +
    "    var prefs = (player.junkPrefs = player.junkPrefs || {});",
    'afk-junkmgr.js',
    '換角色快取邊界'
  );
  return replaceOnce(
    source,
    "    Object.keys(prefs).forEach(function (s) {\n" +
    "      if (!prefs[s] || seen[s]) return;\n" +
    "      seen[s] = 1;\n" +
    "      rows.push({ sig: s });\n" +
    "    });\n" +
    "    rows.forEach(function (r) {",
    "    Object.keys(prefs).forEach(function (s) {\n" +
    "      if (!prefs[s] || seen[s]) return;\n" +
    "      seen[s] = 1;\n" +
    "      rows.push({ sig: s });\n" +
    "    });\n" +
    "    Object.keys(nameCache).forEach(function (s) {\n" +
    "      if (!seen[s]) delete nameCache[s];   // 同角色解除標記後也立即回收，不累積歷史強化簽章\n" +
    "    });\n" +
    "    rows.forEach(function (r) {",
    'afk-junkmgr.js',
    '解除標記快取回收'
  );
});

patch('afk-offline.js', [
  'var _ticker = null, _tickerBad = false, _tickerReq = 0;',
  'var tickerUrl = null;',
  '_ticker = new Worker(tickerUrl);',
  'finally { if (tickerUrl)',
  'requestId = ++_tickerReq;',
  "if (w && on) { try { w.removeEventListener('message', on); }",
  'event.data.id !== requestId',
  'timer = setTimeout(fin, gap + 2000);',
], (input) => {
  let source = replaceOnce(
    input,
    '  var _ticker = null, _tickerBad = false;',
    '  var _ticker = null, _tickerBad = false, _tickerReq = 0;',
    'afk-offline.js',
    '背景 ticker request id'
  );
  source = replaceOnce(
    source,
    "  function ticker() {\n" +
    "    if (_ticker || _tickerBad) return _ticker;\n" +
    "    try {\n" +
    "      var src = 'onmessage=function(e){setTimeout(function(){postMessage(1)},(e.data&&e.data.gap)||0)}';\n" +
    "      _ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));\n" +
    "    } catch (e) { _tickerBad = true; _ticker = null; }\n" +
    "    return _ticker;\n" +
    "  }",
    "  function ticker() {\n" +
    "    if (_ticker || _tickerBad) return _ticker;\n" +
    "    var tickerUrl = null;\n" +
    "    try {\n" +
    "      var src = 'onmessage=function(e){var d=e.data||{};setTimeout(function(){postMessage({id:d.id})},d.gap||0)}';\n" +
    "      tickerUrl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));\n" +
    "      _ticker = new Worker(tickerUrl);\n" +
    "    } catch (e) { _tickerBad = true; _ticker = null; }\n" +
    "    finally { if (tickerUrl) { try { URL.revokeObjectURL(tickerUrl); } catch (e) {} } }\n" +
    "    return _ticker;\n" +
    "  }",
    'afk-offline.js',
    '背景 ticker Worker'
  );
  return replaceOnce(
    source,
    "  function workerGap(gap) {\n" +
    "    return new Promise(function (resolve) {\n" +
    "      var w = ticker(), done = false;\n" +
    "      var fin = function () { if (done) return; done = true; resolve(); };\n" +
    "      if (!w) { setTimeout(fin, gap); return; }   // Worker 不可用 → 退回 setTimeout\n" +
    "      var on = function () { try { w.removeEventListener('message', on); } catch (e) {} fin(); };\n" +
    "      w.addEventListener('message', on);\n" +
    "      setTimeout(fin, gap + 2000);                 // 保險:Worker 沒回(被凍/出錯)也不會卡死\n" +
    "      try { w.postMessage({ gap: gap }); } catch (e) { fin(); }\n" +
    "    });\n" +
    "  }",
    "  function workerGap(gap) {\n" +
    "    return new Promise(function (resolve) {\n" +
      "      var w = ticker(), done = false, timer = null, on = null, requestId = ++_tickerReq;\n" +
    "      var fin = function () {\n" +
    "        if (done) return;\n" +
    "        done = true;\n" +
    "        if (timer !== null) { try { clearTimeout(timer); } catch (e) {} timer = null; }\n" +
    "        if (w && on) { try { w.removeEventListener('message', on); } catch (e) {} }\n" +
    "        resolve();\n" +
    "      };\n" +
    "      if (!w) { setTimeout(fin, gap); return; }   // Worker 不可用 → 退回 setTimeout\n" +
      "      on = function (event) {\n" +
      "        if (!event || !event.data || event.data.id !== requestId) return;\n" +
      "        fin();\n" +
      "      };\n" +
      "      w.addEventListener('message', on);\n" +
      "      timer = setTimeout(fin, gap + 2000);         // 保險:Worker 沒回(被凍/出錯)也不會卡死；逾時當下同步解除 listener\n" +
      "      try { w.postMessage({ gap: gap, id: requestId }); } catch (e) { fin(); }\n" +
    "    });\n" +
    "  }",
    'afk-offline.js',
    '背景 ticker slice listener'
  );
});

patch('afk-powersave.js', [
  "cb.addEventListener('change', function () {\n                set(cb.getAttribute('data-ps'), cb.checked);",
  "typeof window.__afkMobileMemoryRefresh === 'function'",
  'window.__afkMobileMemoryRefresh(false);',
], (input) => replaceOnce(
  input,
  "            cb.addEventListener('change', function () { set(cb.getAttribute('data-ps'), cb.checked); });",
  "            cb.addEventListener('change', function () {\n" +
  "                set(cb.getAttribute('data-ps'), cb.checked);\n" +
  "                if (typeof window.__afkMobileMemoryRefresh === 'function') {\n" +
  "                    window.__afkMobileMemoryRefresh(false);\n" +
  "                }\n" +
  "            });",
  'afk-powersave.js',
  '省電設定即時刷新'
));

patch('afk-skin.js', [
  'var _modalEscBound = false;',
  "var current = document.getElementById('afk-plugin-modal');",
  "modeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });",
], (input) => {
  let source = replaceOnce(
    input,
    '  var _busy = false;',
    "  var _busy = false;\n  var _modalEscBound = false;",
    'afk-skin.js',
    'ESC listener guard'
  );
  source = replaceOnce(
    source,
    "    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });",
    "    if (!_modalEscBound) {\n" +
    "      _modalEscBound = true;\n" +
    "      document.addEventListener('keydown', function (e) {\n" +
    "        if (e.key !== 'Escape') return;\n" +
    "        var current = document.getElementById('afk-plugin-modal');\n" +
    "        if (current) current.classList.remove('is-open');\n" +
    "      });\n" +
    "    }",
    'afk-skin.js',
    '單一 ESC listener'
  );
  return replaceOnce(
    source,
    "      var obs = new MutationObserver(function () { apply(); });\n" +
    "      obs.observe(menu, { childList: true });\n" +
    "    }",
    "      var obs = new MutationObserver(function () { apply(); });\n" +
    "      obs.observe(menu, { childList: true });\n" +
    "      if (document.body) {\n" +
    "        var modeObs = new MutationObserver(function () { apply(); });\n" +
    "        modeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });\n" +
    "      }\n" +
    "    }",
    'afk-skin.js',
    '手機版型 class observer'
  );
});

patch('afk-synccompress.js', [
  "typeof _cancelLzCompressionKey === 'function'",
  '_cancelLzCompressionKey(key);',
  '在途／待處理的舊 Worker',
], (input) => replaceOnce(
  input,
  "    try { if (typeof _lzWorkerRev !== 'undefined' && _lzWorkerRev) _lzWorkerRev[key] = (_lzWorkerRev[key] || 0) + 1; } catch (e) {}   // 讓任何在途的舊 Worker 結果失效(rev 不符→其 onmessage 放棄),不會回頭用舊原文蓋掉我們剛壓好的版本",
  "    try {\n" +
  "      if (typeof _lzWorkerRev !== 'undefined' && _lzWorkerRev) _lzWorkerRev[key] = (_lzWorkerRev[key] || 0) + 1;\n" +
  "      if (typeof _cancelLzCompressionKey === 'function') _cancelLzCompressionKey(key);\n" +
  "    } catch (e) {}   // 讓任何在途／待處理的舊 Worker 結果失效並放掉 raw 參照，不會回頭蓋掉同步壓縮版",
  'afk-synccompress.js',
  '同步壓縮取消舊 queue'
));

patch('afk-training.js', [
  "window.__afkMobileMemoryLifecycle('map-change')",
  '假地圖同樣先釋放上一張圖與在途動畫 probe',
], (input) => replaceOnce(
  input,
  "    if (player.dead) { player.dead = false; player.hp = player.mhp; }\n" +
  "    mapState.current = TRAIN_MAP;   // ← 設了這個 inTrain() 就成立(零旗標)",
  "    if (player.dead) { player.dead = false; player.hp = player.mhp; }\n" +
  "    if (typeof window.__afkMobileMemoryLifecycle === 'function') window.__afkMobileMemoryLifecycle('map-change');   // 🔌 假地圖同樣先釋放上一張圖與在途動畫 probe\n" +
  "    mapState.current = TRAIN_MAP;   // ← 設了這個 inTrain() 就成立(零旗標)",
  'afk-training.js',
  '木人場直接進圖生命週期'
));

patch('afk-wiki.js', [
  'equipPage: 0',
  'var EQUIP_PAGE_SIZE = 48;',
  'data-equippage=',
  "det.innerHTML = linkifyTabs(equipDetailHTML(eqHead.getAttribute('data-eq')), 'equip');",
  '列表固定分頁，避免手機一次載入數千張取得來源圖片',
  'function equipSearchRows(terms)',
  'data-eqsearch-card="1"',
  'var equipVisible = equipRows.slice(0, 80);',
], (input) => {
  let source = replaceOnce(
    input,
    "  var state = { tab: 'equipbook', cls: 'knight', q: '', magicCls: 'all', magicChar: '', collMode: null, equipCls: 'all', equipSlot: 'all', equipRegion: 'all', relicRegion: 'all' };",
    "  var state = { tab: 'equipbook', cls: 'knight', q: '', magicCls: 'all', magicChar: '', collMode: null, equipCls: 'all', equipSlot: 'all', equipRegion: 'all', equipPage: 0, relicRegion: 'all' };",
    'afk-wiki.js',
    '裝備分頁狀態'
  );
  source = replaceOnce(
    source,
    "      var eqHead = e.target.closest ? e.target.closest('[data-eq]') : null;\n" +
    "      if (eqHead) {\n" +
    "        var det = eqHead.parentNode ? eqHead.parentNode.querySelector('.m-eq-detail') : null;\n" +
    "        if (det) det.style.display = (det.style.display === 'none') ? '' : 'none';\n" +
    "        return;\n" +
    "      }",
    "      var eqHead = e.target.closest ? e.target.closest('[data-eq]') : null;\n" +
    "      if (eqHead) {\n" +
    "        var det = eqHead.parentNode ? eqHead.parentNode.querySelector('.m-eq-detail') : null;\n" +
    "        if (det) {\n" +
    "          var opening = det.style.display === 'none';\n" +
    "          document.querySelectorAll('#m-wiki-body .m-eq-detail').forEach(function (other) {\n" +
    "            if (other === det) return;\n" +
    "            other.querySelectorAll('img[src],img[srcset]').forEach(function (img) {\n" +
    "              img.removeAttribute('src'); img.removeAttribute('srcset');\n" +
    "            });\n" +
    "            other.innerHTML = '';\n" +
    "            other.style.display = 'none';\n" +
    "          });\n" +
    "          if (opening) {\n" +
    "            det.innerHTML = linkifyTabs(equipDetailHTML(eqHead.getAttribute('data-eq')), 'equip');\n" +
    "            det.style.display = '';\n" +
    "          } else {\n" +
    "            det.querySelectorAll('img[src],img[srcset]').forEach(function (img) {\n" +
    "              img.removeAttribute('src'); img.removeAttribute('srcset');\n" +
    "            });\n" +
    "            det.innerHTML = '';\n" +
    "            det.style.display = 'none';\n" +
    "          }\n" +
    "        }\n" +
    "        return;\n" +
    "      }",
    'afk-wiki.js',
    '裝備詳情單例惰性載入'
  );
  source = replaceOnce(
    source,
    "      if (eqslot) { state.equipSlot = eqslot.getAttribute('data-equipslot'); render(); return; }",
    "      if (eqslot) { state.equipSlot = eqslot.getAttribute('data-equipslot'); state.equipPage = 0; render(); return; }",
    'afk-wiki.js',
    '部位篩選歸零頁碼'
  );
  source = replaceOnce(
    source,
    "      if (eqcls) { state.equipCls = eqcls.getAttribute('data-equipcls'); render(); return; }",
    "      if (eqcls) { state.equipCls = eqcls.getAttribute('data-equipcls'); state.equipPage = 0; render(); return; }",
    'afk-wiki.js',
    '職業篩選歸零頁碼'
  );
  source = replaceOnce(
    source,
    "      if (eqrg) { state.equipRegion = eqrg.getAttribute('data-equipregion'); render(); return; }",
    "      if (eqrg) { state.equipRegion = eqrg.getAttribute('data-equipregion'); state.equipPage = 0; render(); return; }\n" +
    "      var eqpage = e.target.closest ? e.target.closest('[data-equippage]') : null;\n" +
    "      if (eqpage) { state.equipPage = Math.max(0, Number(eqpage.getAttribute('data-equippage')) || 0); render(); return; }",
    'afk-wiki.js',
    '裝備頁碼事件'
  );
  source = replaceOnce(
    source,
    "    body.innerHTML = linkifyTabs((state.tab === 'magic') ? renderMagic(state.magicCls) : (state.tab === 'equip') ? renderEquip(state.equipCls, state.equipSlot, state.equipRegion) : tabHTML(state.tab, state.cls), state.tab);",
    "    body.innerHTML = linkifyTabs((state.tab === 'magic') ? renderMagic(state.magicCls) : (state.tab === 'equip') ? renderEquip(state.equipCls, state.equipSlot, state.equipRegion, state.equipPage) : tabHTML(state.tab, state.cls), state.tab);",
    'afk-wiki.js',
    '裝備頁碼渲染'
  );
  source = replaceOnce(
    source,
    '  // 詳情與整頁 HTML 都建一次就快取(_equipDetail/_equipHtml)→ 搜尋每次重渲染 441 件也不卡。',
    '  // 詳情只在玩家實際展開時建立；列表每頁固定數量，避免一次把所有裝備的取得圖與怪物圖塞進 DOM。',
    'afk-wiki.js',
    '裝備記憶體策略註解'
  );
  source = replaceOnce(source, '  var _equipDetail = {};\n', '', 'afk-wiki.js', '裝備詳情全量快取宣告');
  source = replaceOnce(source, '    if (_equipDetail[id] !== undefined) return _equipDetail[id];\n', '', 'afk-wiki.js', '裝備詳情全量快取讀取');
  source = replaceOnce(source, '    _equipDetail[id] = html;\n', '', 'afk-wiki.js', '裝備詳情全量快取寫入');
  source = replaceOnce(
    source,
    "  var _equipHtml = {};\n" +
    "  function renderEquip(cls, slot, region) {\n" +
    "    cls = cls || 'all'; slot = slot || 'all'; region = region || 'all';\n" +
    "    if (slot !== RELIC_SLOT) region = 'all';   // 區域篩選只在遺物檢視有意義;其餘部位固定 all,避免生出一堆同內容的快取\n" +
    "    var ckey = cls + '|' + slot + '|' + region;\n" +
    "    if (_equipHtml[ckey] !== undefined) return _equipHtml[ckey];",
    "  var EQUIP_PAGE_SIZE = 48;\n" +
    "  function renderEquip(cls, slot, region, page) {\n" +
    "    cls = cls || 'all'; slot = slot || 'all'; region = region || 'all'; page = Math.max(0, Number(page) || 0);\n" +
    "    if (slot !== RELIC_SLOT) region = 'all';   // 區域篩選只在遺物檢視有意義;其餘部位固定 all,避免生出一堆同內容的快取",
    'afk-wiki.js',
    '裝備固定分頁入口'
  );
  source = replaceOnce(
    source,
    '    var note = \'<div class="m-wiki-note">選<b>部位</b>與<b>職業</b>篩選;<b>點任一件展開完整數值與取得方式</b>。搜尋會跨全部裝備、連展開內容一起命中。\'',
    '    var note = \'<div class="m-wiki-note">選<b>部位</b>與<b>職業</b>篩選;<b>點任一件才載入完整數值與取得方式</b>。列表固定分頁，避免手機一次載入數千張取得來源圖片。\'',
    'afk-wiki.js',
    '裝備分頁說明'
  );
  source = replaceOnce(
    source,
    "        '<div class=\"m-eq-detail\" style=\"display:none;border-top:1px solid #1e293b;margin-top:6px;padding-top:6px;\">' + equipDetailHTML(id) + '</div>' +",
    "        '<div class=\"m-eq-detail\" style=\"display:none;border-top:1px solid #1e293b;margin-top:6px;padding-top:6px;\"></div>' +",
    'afk-wiki.js',
    '裝備詳情空容器'
  );
  source = replaceOnce(
    source,
    "    var html = slotRow + clsRow + regionRow + note + relicCard;\n" +
    "    var total = 0;\n" +
    "    EQUIP_GROUPS.forEach(function (g) {\n" +
    "      var list = buckets[g.k]; if (!list || !list.length) return;\n" +
    "      list.sort(function (a, b) { return (b.d.p || 0) - (a.d.p || 0) || String(a.d.n).localeCompare(String(b.d.n)); });\n" +
    "      total += list.length;\n" +
    "      html += '<div class=\"m-wiki-sub\">' + g.n + '（' + list.length + '）</div>' + list.map(card).join('');\n" +
    "    });\n" +
    "    if (!total) html += '<div class=\"m-wiki-hint\">沒有符合的裝備。</div>';\n" +
    "    _equipHtml[ckey] = html;\n" +
    "    return html;",
    "    var html = slotRow + clsRow + regionRow + note + relicCard;\n" +
    "    var ordered = [];\n" +
    "    EQUIP_GROUPS.forEach(function (g) {\n" +
    "      var list = buckets[g.k]; if (!list || !list.length) return;\n" +
    "      list.sort(function (a, b) { return (b.d.p || 0) - (a.d.p || 0) || String(a.d.n).localeCompare(String(b.d.n)); });\n" +
    "      list.forEach(function (entry) { ordered.push({ group: g, groupCount: list.length, entry: entry }); });\n" +
    "    });\n" +
    "    var total = ordered.length;\n" +
    "    var pageCount = Math.max(1, Math.ceil(total / EQUIP_PAGE_SIZE));\n" +
    "    page = Math.min(page, pageCount - 1);\n" +
    "    var controls = '';\n" +
    "    if (pageCount > 1) {\n" +
    "      controls = '<div class=\"m-wiki-mfilter m-eq-pages\">' +\n" +
    "        '<button type=\"button\" class=\"m-wiki-mfbtn\" data-equippage=\"' + Math.max(0, page - 1) + '\"' + (page <= 0 ? ' disabled' : '') + '>上一頁</button>' +\n" +
    "        '<span style=\"align-self:center;color:#94a3b8;font-size:12px;\">' + (page + 1) + ' / ' + pageCount + '（共 ' + total + ' 件）</span>' +\n" +
    "        '<button type=\"button\" class=\"m-wiki-mfbtn\" data-equippage=\"' + Math.min(pageCount - 1, page + 1) + '\"' + (page >= pageCount - 1 ? ' disabled' : '') + '>下一頁</button>' +\n" +
    "        '</div>';\n" +
    "      html += controls;\n" +
    "    }\n" +
    "    var visible = ordered.slice(page * EQUIP_PAGE_SIZE, (page + 1) * EQUIP_PAGE_SIZE);\n" +
    "    var lastGroup = '';\n" +
    "    visible.forEach(function (row) {\n" +
    "      if (lastGroup !== row.group.k) {\n" +
    "        lastGroup = row.group.k;\n" +
    "        html += '<div class=\"m-wiki-sub\">' + row.group.n + '（' + row.groupCount + '）</div>';\n" +
    "      }\n" +
    "      html += card(row.entry);\n" +
    "    });\n" +
    "    if (controls) html += controls;\n" +
    "    if (!total) html += '<div class=\"m-wiki-hint\">沒有符合的裝備。</div>';\n" +
    "    return html;",
    'afk-wiki.js',
    '裝備固定頁面輸出'
  );
  const equipSearchPatch = `  // 裝備列表改分頁後，搜尋不能再靠 renderEquip() 的第一頁 DOM。
  // 直接掃 DB 的文字欄位與精簡數值；命中卡不放圖片，點擊時才沿用既有 equipDetailHTML 載入詳情。
  function equipSearchRows(terms) {
    var rows = [];
    if (typeof DB === 'undefined' || !DB.items) return rows;
    Object.keys(DB.items).forEach(function (id) {
      var d = DB.items[id];
      if (!d || !d.n || (d.type !== 'wpn' && d.type !== 'arm' && d.type !== 'acc')) return;
      var group = equipGroupKey(id, d);
      var groupName = group;
      for (var gi = 0; gi < EQUIP_GROUPS.length; gi++) {
        if (EQUIP_GROUPS[gi].k === group) { groupName = EQUIP_GROUPS[gi].n; break; }
      }
      var text = [
        id, d.n, d.d || '', d.req || '', d.slot || '', d.type || '',
        groupName, equipCompact(d), JSON.stringify(d)
      ].join(' ').toLowerCase();
      if (terms.every(function (word) { return text.indexOf(word) >= 0; })) {
        rows.push({ id: id, d: d, groupName: groupName });
      }
    });
    rows.sort(function (a, b) { return String(a.d.n).localeCompare(String(b.d.n)); });
    return rows;
  }
  function equipSearchCard(row) {
    var relic = isRelicItem(row.d);
    var nameCls = relic ? 'c-relic' : (row.d.legend ? 'c-legend' : 'text-slate-100');
    return '<div class="m-wiki-card m-eq-card" data-eqsearch-card="1">' +
      '<div class="m-eq-head" data-eq="' + esc(row.id) + '" style="cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">' +
        '<span class="' + nameCls + ' font-bold">' + esc(row.d.n) + (relic ? ' 🏺' : (row.d.legend ? ' ✦' : '')) + '</span>' +
        '<span class="m-eq-compact" style="color:#94a3b8;font-size:12px;text-align:right;">' + esc(row.groupName + '　' + equipCompact(row.d)) + '</span>' +
      '</div><div class="m-eq-detail" style="display:none;border-top:1px solid #1e293b;margin-top:6px;padding-top:6px;"></div></div>';
  }
`;
  source = replaceOnce(
    source,
    '  // 供掉落查詢統一搜尋呼叫:輕量回傳「哪些分頁/區塊」含關鍵字(只取標題,不渲染整頁結果)',
    equipSearchPatch + '\n  // 供掉落查詢統一搜尋呼叫:輕量回傳「哪些分頁/區塊」含關鍵字(只取標題,不渲染整頁結果)',
    'afk-wiki.js',
    '裝備完整輕量搜尋索引'
  );
  source = replaceOnce(
    source,
    "      SEARCH_SOURCES.forEach(function (s) {\n" +
    "        if (out.length >= max) return;\n" +
    "        var clsList =",
    "      SEARCH_SOURCES.forEach(function (s) {\n" +
    "        if (out.length >= max) return;\n" +
    "        if (s.key === 'equip') {\n" +
    "          equipSearchRows(terms).slice(0, max - out.length).forEach(function (row) {\n" +
    "            out.push({ tab: 'equip', cls: null, label: s.label, title: row.d.n });\n" +
    "          });\n" +
    "          return;\n" +
    "        }\n" +
    "        var clsList =",
    'afk-wiki.js',
    '輕量搜尋涵蓋全部裝備'
  );
  return replaceOnce(
    source,
    "    SEARCH_SOURCES.forEach(function (s) {\n" +
    "      // cls 分頁逐職業各搜一次;",
    "    SEARCH_SOURCES.forEach(function (s) {\n" +
    "      if (s.key === 'equip') {\n" +
    "        var equipRows = equipSearchRows(terms);\n" +
    "        if (equipRows.length) {\n" +
    "          var equipVisible = equipRows.slice(0, 80);\n" +
    "          parts.push('<div class=\"m-wiki-sub\">' + esc(s.label) +\n" +
    "            ' <span class=\"m-wiki-cnt\">' + equipRows.length + '</span></div>' +\n" +
    "            equipVisible.map(equipSearchCard).join('') +\n" +
    "            (equipRows.length > equipVisible.length\n" +
    "              ? '<div class=\"m-wiki-hint\">結果過多，僅顯示前 ' + equipVisible.length + ' 件；請再加一個關鍵字縮小範圍。</div>'\n" +
    "              : ''));\n" +
    "        }\n" +
    "        return;\n" +
    "      }\n" +
    "      // cls 分頁逐職業各搜一次;",
    'afk-wiki.js',
    '全域搜尋涵蓋全部裝備'
  );
});

if (CHECK) {
  if (changed) {
    console.error(`❌ --check：${changed} 支 PP 外掛的生命週期修正尚未重套`);
    process.exit(1);
  }
  console.log(`✅ --check：${outputs.size} 支 PP 外掛生命週期修正完整。`);
} else {
  for (const [file, source] of outputs) writeFileSync(file, source);
  console.log(`✅ PP 外掛生命週期修正：新套用 ${changed}、已存在 ${outputs.size - changed}。`);
}
