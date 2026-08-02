/*
 * afk-slotinfo.js — 選角/載入畫面的「額外掛機資訊」掛載外掛(桌機 + 手機共用)
 *
 * 職責:在原作者 renderLoadSelect 渲染的選角卡片「底部疊一層」📍 目前掛在哪張地圖、
 *   ⏱ 已掛機多久、席琳世界狀態。
 *   只「疊加」、絕不清空 → 原作者的角色立繪與卡片內容原封不動,桌機與手機共用同一份邏輯。
 *   對外仍暴露 window.AFK_SLOTINFO.read(slot) → { mapName, idleText, sherine }(純資料、無 DOM)供他人取用。
 *
 * 資料來源:afk-offline 寫的即時地圖記錄 afk_map_<slot>(較準)、最後活躍心跳 afk_ts_<slot>;
 *   讀不到 afk_map_ 就退回存檔 blob 的 ms.current。地圖中文名與離線上限走 window.__afk。
 *   席琳世界狀態讀存檔 blob 的 player.sherineWorld / sherineMad。
 *
 * 優雅降級:renderLoadSelect / __afk 不存在就安靜停用,不弄壞畫面。
 */
(function () {
  if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('slotinfo')) return;   // 🎚️ 外掛開關:關掉就透明放行原版行為
  // 把離線毫秒數格式化成「X 天 Y 小時 / X 小時 Y 分 / X 分鐘 / 剛剛」
  function fmtIdle(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    if (s < 60) return '剛剛';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' 分鐘';
    var h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) return rm ? (h + ' 小時 ' + rm + ' 分') : (h + ' 小時');
    var d = Math.floor(h / 24), rh = h % 24;
    return rh ? (d + ' 天 ' + rh + ' 小時') : (d + ' 天');
  }

  // 唯一資料源:給一個存檔位編號,回「掛機地圖中文名」與「已掛機多久」文字(沒有就回空字串)
  function read(slot) {
    // 存檔解析一次:優先用原作的 _lzGet(解壓 LZ1) + _saveUnwrap(去簽章),才讀得到壓縮存檔的 ms/p。
    var save = null;
    try {
      var _raw = (typeof _lzGet === 'function') ? _lzGet('lineage_idle_save_' + slot) : localStorage.getItem('lineage_idle_save_' + slot);
      if (_raw && typeof _saveUnwrap === 'function') _raw = _saveUnwrap(_raw).payload;
      if (_raw) save = JSON.parse(_raw);
    } catch (e) {}

    // 🔒 Jesper offline migration visibility guard
    // 遷移完成前不讀凍結的 afk_ts_/afk_map_，避免選角頁先顯示假掛機時間。
    var legacyReady = !!(window.__afk && typeof window.__afk.migrationDoneFor === 'function' && window.__afk.migrationDoneFor(slot));
    var mapId = '';
    if (legacyReady) {
      try { mapId = localStorage.getItem('afk_map_' + slot) || ''; } catch (e) {}
      if (!mapId && save && save.ms) mapId = save.ms.current || '';
    }
    var mapName = '';
    if (mapId) mapName = (window.__afk && typeof window.__afk.mapName === 'function') ? window.__afk.mapName(mapId) : mapId;

    var ts = 0;
    if (legacyReady) { try { ts = +localStorage.getItem('afk_ts_' + slot) || 0; } catch (e) {} }
    var idleText = '';
    if (ts > 0) {
      var idleMs = Date.now() - ts;
      var capH = (window.__afk && window.__afk.capHours) || 24;   // 離線收益上限(小時),讀核心離線模組
      idleText = '⏱ 已掛機 ' + fmtIdle(idleMs);
      if (idleMs >= capH * 3600000) idleText += '（收益上限 ' + capH + ' 小時）';   // 顯示真實時間,超過上限時提醒收益封頂
    }

    // 🔮 席琳世界狀態:存於 player.sherineWorld / player.sherineMad(兩者互斥),回 '' / 'world' / 'mad'
    var p = save && save.p;
    var sherine = p ? (p.sherineMad ? 'mad' : (p.sherineWorld ? 'world' : '')) : '';

    return { mapName: mapName, idleText: idleText, sherine: sherine };
  }

  window.AFK_SLOTINFO = { version: '1.0.0', read: read };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // --- 卡片式選角(openLoadSelect/renderLoadSelect)：卡片在 #load-slot-grid，每張是角色立繪。
  //   掛機資訊直接疊在「每張卡底部」，一頁 4 張一眼全看到(使用者要求，不用只顯示選中角色的共用資訊面板)。
  //   read() 無資料的卡(空位)略過。
  var CAP_BASE = 'position:absolute;z-index:3;pointer-events:none;display:flex;flex-flow:column;align-items:center;gap:1px;padding:4px 5px 5px;font-size:.64rem;line-height:1.3;font-weight:700;text-align:center;text-shadow:0 1px 2px #000;';
  var CAP_ALONE = 'left:0;right:0;bottom:0;background:linear-gradient(to top,rgba(2,6,23,.95),rgba(2,6,23,.72) 62%,transparent);';
  var UPSTREAM_DETAIL_BOTTOM_PCT = 0.025;   // 上游 .load-offline-detail 的 bottom:2.5%

  // 上游 v3.7.39 起自己在卡片底部畫「離線 / 10分 · 經 xx 金 xx · 地圖名」(.load-offline-detail)，
  // 佔掉整條底緣 → 席琳標籤要疊到它上方，否則會把地圖名那行壓掉。該區塊由上游每 2 秒重繪
  // (出現/消失/高度都會變)，所以定位每次現量，並靠 grid 的 MutationObserver 跟著重算。
  function placeCaption(card, cap) {
    var det = card.querySelector('.load-offline-detail');
    if (!det) { cap.style.cssText = CAP_BASE + CAP_ALONE; return; }
    var gap = card.getBoundingClientRect().height * UPSTREAM_DETAIL_BOTTOM_PCT;
    cap.style.cssText = CAP_BASE
      + 'left:4%;right:4%;bottom:' + Math.round(det.getBoundingClientRect().height + gap) + 'px;'
      + 'background:rgba(2,6,23,.9);';
  }

  function decorateCards() {
    var grid = document.getElementById('load-slot-grid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.load-slot-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var old = card.querySelector('.afk-card-slotinfo'); if (old) old.remove();   // 每次重繪清舊的
      var staleNative = card.querySelector('.load-offline-status'); if (staleNative) staleNative.remove();   // 快取混搭後援：另一套離線狀態不顯示
      var slot = parseInt(card.getAttribute('data-slot'), 10);
      if (!slot) continue;
      var info = read(slot);
      if (!info.mapName && !info.idleText && !info.sherine) continue;
      try { if (getComputedStyle(card).position === 'static') card.style.position = 'relative'; } catch (e) {}
      var html = '';
      if (info.sherine) html += '<span style="color:' + (info.sherine === 'mad' ? '#fb7185' : '#4ade80') + ';">' + (info.sherine === 'mad' ? '🔥 瘋狂席琳' : '🔮 席琳世界') + '</span>';
      if (info.mapName) html += '<span style="color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">📍 ' + esc(info.mapName) + '</span>';
      if (info.idleText) html += '<span style="color:#cbd5e1;">' + esc(info.idleText.replace('⏱ 已掛機 ', '⏱ ')) + '</span>';
      var cap = document.createElement('span');
      cap.className = 'afk-card-slotinfo';
      cap.innerHTML = html;
      card.appendChild(cap);
      placeCaption(card, cap);
    }
    watchGrid(grid);
  }

  var _watched = null;
  function watchGrid(grid) {
    if (_watched === grid || typeof MutationObserver !== 'function') return;
    _watched = grid;
    new MutationObserver(function () {
      grid.querySelectorAll('.afk-card-slotinfo').forEach(function (cap) { placeCaption(cap.parentNode, cap); });
    }).observe(grid, { childList: true, subtree: true });
  }
  function wrapRenderLoad() {
    if (typeof window.renderLoadSelect !== 'function' || window.renderLoadSelect.__afkSlotInfo) return false;
    var orig = window.renderLoadSelect;
    var wrapped = function () { orig.apply(this, arguments); try { decorateCards(); } catch (e) {} };
    wrapped.__afkSlotInfo = true;
    window.renderLoadSelect = wrapped;
    return true;
  }

  if (wrapRenderLoad()) {            // 卡片式選角:每張卡底部疊掛機資訊
    console.log('[AFK-slotinfo] hooks OK — 選角卡片附加掛機地點/已掛機時間。');
  } else {
    console.warn('[AFK-slotinfo] 找不到 renderLoadSelect,選角畫面掛機資訊停用。');
  }
})();
