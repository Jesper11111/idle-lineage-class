/*
 * afk-offline-owner.js — 舊版離線結算的獨占握手。
 *
 * 官方 v3.8.1 已不再載入 js/27-offline-rewards.js；因此不能再依賴修改 js/27
 * 才產生獨占標記。此檔必須排在 afk-offline.js 前面，而且只在確認官方新版
 * 離線鉤子皆未安裝時授權舊引擎啟動。若未來官方重新加入離線結算，這裡會
 * fail closed，舊引擎不啟動，避免兩套機制重複發獎。
 */
(function () {
  var nativeHooks = [
    'offlineCatchupSaveCommitted',
    'offlineSettleCatchup',
    'offlinePrepareCharacterSelect'
  ];
  var conflict = nativeHooks.some(function (name) {
    return typeof window[name] === 'function';
  });

  if (conflict) {
    window.__afkLegacyOfflineOwnsSettlement = false;
    console.error('[AFK-offline-owner] 偵測到官方離線結算鉤子；舊版離線引擎已停用，避免重複結算。');
    return;
  }

  window.__afkLegacyOfflineOwnsSettlement = true;
})();
