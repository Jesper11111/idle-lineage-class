/**
 * afk-mobile-memory.js — 手機省電模式的圖片解碼記憶體上限。
 *
 * iOS 白屏重載的第二個已確認來源：換地圖會逐張解碼 1920×1080 場景圖。JS heap / DOM
 * 沒有增長，但瀏覽器程序私有記憶體會持續攀升。手機同時開啟「關動畫＋低更新率」時，
 * 狩獵區與城鎮改用 CSS 漸層，不再把新場景圖送進圖片解碼／合成快取。
 *
 * 此檔是 Jesper 本地政策層，由 sync-upstream.mjs 明確保留；核心角色預覽動畫則只讀
 * __afkMobileMemoryLite() 掛點，讓上游同步後的錨點補丁可重套。
 */
(function () {
    'use strict';

    function settingOn(key) {
        try { return localStorage.getItem('afk_ps_' + key) === '1'; } catch (e) { return false; }
    }

    function isMobile() {
        if (document.body && document.body.classList.contains('m-mobile')) return true;
        try {
            return window.innerWidth <= 900 &&
                (!!window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        } catch (e) {
            return window.innerWidth <= 900;
        }
    }

    function lite() {
        return isMobile() && settingOn('noanim') && settingOn('lowfps');
    }

    window.__afkMobileMemoryLite = lite;

    var LITE_BG = 'linear-gradient(135deg, #172033 0%, #101827 48%, #080d18 100%)';

    if (typeof window.applyAreaBackground === 'function' && !window.applyAreaBackground.__afkMobileMemory) {
        var originalAreaBackground = window.applyAreaBackground;
        window.applyAreaBackground = function () {
            if (!lite()) return originalAreaBackground.apply(this, arguments);

            var current = (typeof mapState !== 'undefined' && mapState.current) || '';
            var battle = document.getElementById('battle-view');
            if (battle) {
                if (String(current).indexOf('town_') === 0) {
                    battle.style.backgroundImage = '';
                    battle.style.backgroundSize = '';
                    battle.classList.remove('area-fit');
                    battle.classList.remove('has-bg');
                } else {
                    battle.style.backgroundImage = LITE_BG;
                    battle.style.backgroundSize = 'cover';
                    battle.classList.add('area-fit');
                    battle.classList.add('has-bg');
                }
            }
            var town = document.getElementById('town-view');
            if (town) {
                town.style.backgroundImage = '';
                town.classList.remove('has-bg');
            }
        };
        window.applyAreaBackground.__afkMobileMemory = true;
        window.applyAreaBackground.__afkMobileMemoryOriginal = originalAreaBackground;
    }

    if (typeof window._townMapBg === 'function' && !window._townMapBg.__afkMobileMemory) {
        var originalTownMapBg = window._townMapBg;
        window._townMapBg = function () {
            if (lite()) return LITE_BG;
            return originalTownMapBg.apply(this, arguments);
        };
        window._townMapBg.__afkMobileMemory = true;
        window._townMapBg.__afkMobileMemoryOriginal = originalTownMapBg;
    }

    // PP 的省電面板由閉包動態建立，外掛無法直接改 opts；開窗後補一行明確說明，
    // 避免玩家看到場景簡化卻不知道是兩個省電選項共同啟用的結果。
    function explainCombinedMode() {
        var overlay = document.getElementById('afk-ps-overlay');
        if (!overlay || document.getElementById('afk-ps-memory-note')) return;
        var rows = overlay.querySelector('div[style*="padding:12px 14px"]');
        if (!rows) return;
        var note = document.createElement('div');
        note.id = 'afk-ps-memory-note';
        note.style.cssText = 'font-size:11px;color:#7dd3fc;padding:2px 4px 8px;line-height:1.45;';
        note.textContent = '手機同時開啟兩項時，會簡化地圖背景並停止角色預覽動畫，降低圖片記憶體與白屏重載。';
        rows.appendChild(note);
    }
    document.addEventListener('click', function () {
        setTimeout(explainCombinedMode, 0);
    }, false);

    try {
        console.log('[AFK-mobile-memory] hooks OK — 手機雙省電啟用時限制地圖／角色預覽圖片解碼。');
    } catch (e) {}
})();
