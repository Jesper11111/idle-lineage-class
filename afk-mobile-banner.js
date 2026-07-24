/*
 * afk-mobile-banner.js — 手機隱藏原作「非官方轉載版本」橫幅。
 *
 * 只處理顯示政策：
 *   - 手機／觸控裝置隱藏 #_orig_pbar，釋放垂直空間。
 *   - 桌機保留 PP 原本的橫幅與 afk-banner 讓位行為。
 *   - 不依賴可停用的 afk-mobile，避免玩家關閉手機版面後橫幅又出現。
 */
(function () {
  'use strict';

  var ROOT_CLASS = 'afk-hide-origin-banner-mobile';
  var STYLE_ID = 'afk-mobile-banner-policy';

  function isMobile() {
    try {
      return (typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches) ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ||
        (window.innerWidth || 9999) <= 820;
    } catch (e) { return false; }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = 'html.' + ROOT_CLASS + ' #_orig_pbar{display:none !important;}';
    (document.head || document.documentElement).appendChild(style);
  }

  function sync() {
    var hide = isMobile();
    document.documentElement.classList.toggle(ROOT_CLASS, hide);
    // 橫幅顯示狀態改變後立刻重算讓位高度；手機應回到 0px，桌機恢復實際高度。
    try {
      if (window.AFK_BANNER && typeof window.AFK_BANNER.remeasure === 'function') {
        window.AFK_BANNER.remeasure();
      }
    } catch (e) {}
  }

  ensureStyle();
  sync();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);

  window.AFK_MOBILE_BANNER = Object.freeze({
    version: '1.0.0',
    hiddenOnThisDevice: isMobile,
    sync: sync
  });
  console.log('[AFK-mobile-banner] hooks OK — 手機隱藏非官方轉載橫幅，桌機保留。');
})();
