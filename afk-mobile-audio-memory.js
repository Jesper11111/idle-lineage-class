/**
 * afk-mobile-audio-memory.js — 手機雙省電模式的音效解碼記憶體上限。
 *
 * PP 音效引擎會為每種怪物受傷／死亡／攻擊／技能音各預載四個 Audio 元素，且跨地圖
 * 後永不釋放。手機同時開啟「關動畫＋低更新率」時，改以固定六個 Audio 通道串流所有
 * 音效；每個音效 key 只留不含媒體元素的輕量代理，不再逐怪物預載與保留解碼緩衝。
 *
 * 此檔是 Jesper 本地政策層，由 sync-upstream.mjs 明確保留。
 */
(function () {
    'use strict';

    var CHANNEL_COUNT = 6;
    var NORMAL_POOL_SIZE = 4;
    var virtualDefs = new Map();
    var channels = [];
    var channelCursor = 0;
    var lastLiteMode = null;

    function powersaveEnabled() {
        try {
            if (window.AFK_TOGGLES && typeof window.AFK_TOGGLES.enabled === 'function') {
                return !!window.AFK_TOGGLES.enabled('powersave');
            }
            var stored = localStorage.getItem('afk_toggle_powersave');
            return stored === null || stored === '1';
        } catch (e) {
            return true;
        }
    }

    function lite() {
        if (typeof window.__afkMobileMemoryLite === 'function') {
            return window.__afkMobileMemoryLite();
        }
        try {
            var mobile = typeof window.__afkIsMobileDevice === 'function' ? !!window.__afkIsMobileDevice() :
                ((!!window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
                /Android|iPhone|iPad|iPod|Mobile/i.test((window.navigator && window.navigator.userAgent) || '') ||
                (window.innerWidth || 9999) <= 820);
            return powersaveEnabled() && mobile &&
                localStorage.getItem('afk_ps_noanim') === '1' &&
                localStorage.getItem('afk_ps_lowfps') === '1';
        } catch (e) {
            return false;
        }
    }

    function releaseAudio(audio) {
        if (!audio) return;
        try { audio.pause(); } catch (e) {}
        try { audio.removeAttribute('src'); } catch (e) {}
        try { audio.load(); } catch (e) {}
    }

    function setPoolSize(size) {
        try { SFX_POOL_N = size; } catch (e) {}
    }

    function sourceUrl(def) {
        return 'assets/sfx/' + def.file + '.' + def.exts[def.extIndex];
    }

    function ensureChannels() {
        while (channels.length < CHANNEL_COUNT) {
            var audio = new Audio();
            audio.preload = 'none';
            channels.push(audio);
        }
    }

    function playVirtual(key, volume) {
        var def = virtualDefs.get(key);
        if (!def) return Promise.resolve();
        if (!lite()) {
            restoreNormalKey(key);
            return Promise.resolve();
        }
        if (def.failed) return Promise.resolve();
        ensureChannels();

        var audio = channels[channelCursor++ % channels.length];
        var token = (audio.__afkAudioToken || 0) + 1;
        audio.__afkAudioToken = token;
        audio.__afkAudioOwner = key;

        function start() {
            var url = sourceUrl(def);
            try {
                audio.pause();
                if (audio.__afkAudioUrl !== url) {
                    try {
                        audio.removeAttribute('src');
                        audio.load();
                    } catch (e) {}
                    audio.__afkAudioUrl = url;
                    audio.src = url;
                    try { audio.load(); } catch (e) {}
                } else {
                    try { audio.currentTime = 0; } catch (e) {}
                }
                audio.volume = Math.max(0, Math.min(1, Number(volume) || 0));
                var promise = audio.play();
                if (promise && promise.catch) promise.catch(function () {});
                return promise || Promise.resolve();
            } catch (e) {
                return Promise.resolve();
            }
        }

        audio.onerror = function () {
            if (audio.__afkAudioToken !== token) return;
            if (def.extIndex >= def.exts.length - 1) {
                def.failed = true;
                return;
            }
            def.extIndex++;
            audio.__afkAudioUrl = '';
            start();
        };
        return start();
    }

    function releaseChannels() {
        channels.forEach(releaseAudio);
        channels = [];
        channelCursor = 0;
    }

    function stopVirtual(key) {
        channels.forEach(function (audio) {
            if (audio.__afkAudioOwner !== key) return;
            try { audio.pause(); audio.currentTime = 0; } catch (e) {}
        });
    }

    function makeVirtual(key, file) {
        var def = virtualDefs.get(key);
        if (!def) {
            def = { file: String(file || key), exts: ['ogg', 'mp3', 'wav'], extIndex: 0 };
            virtualDefs.set(key, def);
        }
        var proxy = {
            __afkMobileAudioVirtual: true,
            volume: 0.5,
            currentTime: 0,
            paused: true,
            ended: true,
            play: function () { return playVirtual(key, proxy.volume); },
            pause: function () { stopVirtual(key); },
            removeAttribute: function () {},
            load: function () {}
        };
        _sfxPool[key] = [proxy];
        _sfxIdx[key] = 0;
        return proxy;
    }

    function fileFromPool(key, pool) {
        var audio = pool && pool[0];
        var src = audio && (audio.currentSrc || audio.src) || '';
        var match = String(src).match(/\/assets\/sfx\/([^/?#]+)\.(ogg|mp3|wav)(?:[?#]|$)/i);
        if (match) {
            try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
        }
        var numeric = String(key).match(/^(?:mob|kill|atk|wpnatk|mobsk|spell)_(.+)$/);
        return numeric ? numeric[1] : key;
    }

    function restoreNormalKey(key) {
        var def = virtualDefs.get(key);
        var pool = _sfxPool[key];
        if (!def || !Array.isArray(pool) || !pool[0] || !pool[0].__afkMobileAudioVirtual) return;
        setPoolSize(NORMAL_POOL_SIZE);
        releaseChannels();
        delete _sfxPool[key];
        delete _sfxIdx[key];
        virtualDefs.delete(key);
        originalTryLoad(key, { file: def.file });
    }

    // 使用者在頁面開啟後才切換雙省電時，把已存在的媒體池也轉為代理。
    function convertLoadedPools() {
        Object.keys(_sfxPool).forEach(function (key) {
            var pool = _sfxPool[key];
            if (!Array.isArray(pool) || !pool.length || pool[0].__afkMobileAudioVirtual) return;
            var file = fileFromPool(key, pool);
            pool.forEach(releaseAudio);
            makeVirtual(key, file);
        });
    }

    function enforce() {
        var active = lite();
        if (active === lastLiteMode) {
            setPoolSize(active ? 1 : NORMAL_POOL_SIZE);
            return;
        }
        lastLiteMode = active;
        if (!active) {
            setPoolSize(NORMAL_POOL_SIZE);
            releaseChannels();
            return;
        }
        setPoolSize(1);
        convertLoadedPools();
    }

    if (typeof window._sfxTryLoad !== 'function' ||
        typeof window._sfxDynLoad !== 'function' ||
        typeof window._sfxPlayPool !== 'function' ||
        typeof window._sfxPool !== 'object') {
        console.error('[AFK-mobile-audio-memory] hook 失敗：PP 音效引擎介面已變更。');
        return;
    }

    var originalTryLoad = window._sfxTryLoad;
    window._sfxTryLoad = function (key, def) {
        if (!lite()) return originalTryLoad.apply(this, arguments);
        makeVirtual(key, def && def.file ? def.file : key);
    };
    window._sfxTryLoad.__afkMobileAudioMemory = true;
    window._sfxTryLoad.__afkMobileAudioMemoryOriginal = originalTryLoad;

    var originalDynLoad = window._sfxDynLoad;
    window._sfxDynLoad = function (poolKey, file) {
        if (!lite()) return originalDynLoad.apply(this, arguments);
        if (typeof catchupActive === 'function' && catchupActive()) return;
        if (_sfxDynTried[poolKey]) return;
        _sfxDynTried[poolKey] = true;
        makeVirtual(poolKey, file || poolKey);
    };
    window._sfxDynLoad.__afkMobileAudioMemory = true;
    window._sfxDynLoad.__afkMobileAudioMemoryOriginal = originalDynLoad;

    window.__afkMobileAudioMemory = {
        lite: lite,
        enforce: enforce,
        stats: function () {
            var virtualPools = Object.values(_sfxPool).filter(function (pool) {
                return Array.isArray(pool) && pool[0] && pool[0].__afkMobileAudioVirtual;
            }).length;
            return {
                active: lite(),
                poolSize: typeof SFX_POOL_N === 'number' ? SFX_POOL_N : null,
                channelLimit: CHANNEL_COUNT,
                channelsCreated: channels.length,
                virtualPools: virtualPools,
                realAudioElements: Object.values(_sfxPool)
                    .filter(function (pool) {
                        return Array.isArray(pool) && (!pool[0] || !pool[0].__afkMobileAudioVirtual);
                    })
                    .reduce(function (sum, pool) { return sum + pool.length; }, 0) + channels.length
            };
        }
    };

    enforce();
    function explainAudioMode() {
        var note = document.getElementById('afk-ps-memory-note');
        if (!note || note.dataset.audioMemory) return;
        note.dataset.audioMemory = '1';
        note.textContent += '；音效改用固定共用通道，避免跨地圖累積。';
    }
    document.addEventListener('click', function () {
        setTimeout(function () { enforce(); explainAudioMode(); }, 0);
    }, false);
    console.log('[AFK-mobile-audio-memory] hooks OK — 手機雙省電以固定通道播放音效。');
})();
