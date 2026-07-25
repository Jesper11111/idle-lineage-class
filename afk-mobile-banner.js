/*
 * afk-mobile-banner.js — 全裝置隱藏原作「非官方轉載版本」橫幅。
 *
 * 只處理顯示政策：
 *   - 手機、平板與桌機一律隱藏 #_orig_pbar，不保留垂直空間。
 *   - 保留原 DOM 作為 PP 的已建立標記，避免核心反覆插入同一橫幅。
 *   - 不依賴任何可停用的版面外掛。
 */
(function () {
  'use strict';

  var ROOT_CLASS = 'afk-hide-origin-banner';
  var STYLE_ID = 'afk-mobile-banner-policy';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = 'html.' + ROOT_CLASS + ' #_orig_pbar{display:none !important;}';
    (document.head || document.documentElement).appendChild(style);
  }

  function sync() {
    document.documentElement.classList.add(ROOT_CLASS);
    // 橫幅隱藏後立刻重算讓位高度；所有裝置都應回到 0px。
    try {
      if (window.AFK_BANNER && typeof window.AFK_BANNER.remeasure === 'function') {
        window.AFK_BANNER.remeasure();
      }
    } catch (e) {}
  }

  ensureStyle();
  sync();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);

  window.AFK_MOBILE_BANNER = Object.freeze({
    version: '2.0.0',
    hiddenOnThisDevice: function () { return true; },
    sync: sync
  });
  console.log('[AFK-mobile-banner] hooks OK — 全裝置隱藏非官方轉載橫幅。');
})();
