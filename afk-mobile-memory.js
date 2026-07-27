/**
 * afk-mobile-memory.js — 手機雙省電的圖片生命週期與解碼記憶體上限。
 *
 * 已確認的白屏來源不是 JS heap，而是瀏覽器程序持有的解碼圖片與存檔瞬間工作量：
 *   1. 原尺寸地圖、怪物、玩家／寵物動畫；
 *   2. 城鎮 NPC 與玩家收購 NPC 的永久 Image[] 快取；
 *   3. 已進遊戲後仍留在隱藏登入 DOM 的大圖；
 *   4. 圖鑑等非戰鬥畫面繞過戰鬥縮圖 hook。
 *
 * 手機同時開啟「關動畫＋低更新率」時，本檔把場景改為 CSS 漸層、怪物改用 96×96
 * 單層圖、城鎮只保留首幀、換圖／換角釋放所有動畫圖片快取，並在進遊戲後暫時卸下
 * 隱藏登入圖片。核心只保留由 apply-core-patches.mjs 重套的穩定掛點。
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

    var frameEpoch = 0;
    window.__afkMobileMemoryLite = lite;
    window.__afkMobileMemoryFrameEpoch = function () { return frameEpoch; };
    window.__afkMobileMemoryProbeCurrent = function (token) { return token == null || token === frameEpoch; };
    window.__afkMobileMemoryAcceptFrames = function (token) {
        return !lite() && (token == null || token === frameEpoch);
    };

    var LITE_BG = 'linear-gradient(135deg, #172033 0%, #101827 48%, #080d18 100%)';
    var LITE_MOB_FALLBACK = 'assets/mobile-mobs/_fallback.svg';
    var modeActive = null;
    var releaseCount = 0;
    var lastReleaseReason = '';
    var lastReleasedKeys = 0;
    var resizeTimer = 0;
    var lastMobileState = null;
    var staticActorsPending = false;
    var staticActorsTimer = 0;

    function injectStyle() {
        if (!document.head || document.getElementById('afk-mobile-memory-style')) return;
        var style = document.createElement('style');
        style.id = 'afk-mobile-memory-style';
        style.textContent =
            'body.afk-mobile-memory-lite{background-image:' + LITE_BG + '!important;background-attachment:scroll!important;}' +
            'body.afk-mobile-memory-lite #battle-view.has-bg{background-color:#101827;}';
        document.head.appendChild(style);
    }

    // js/09 的核心錨點會在產生任何 <img> 前詢問此 hook。必須在原圖 URL 進 DOM 前改寫，
    // 事後 display:none / 換 src 都太晚，Safari 已開始解碼原尺寸圖片。
    window.__afkMobileMobStill = function (name) {
        if (!lite()) return null;
        var dir = String(name || '');
        try {
            if (typeof window._animDir === 'function') dir = window._animDir(dir);
        } catch (e) {}
        return {
            src: 'assets/mobile-mobs/' + encodeURIComponent(dir) + '.png',
            fb: [LITE_MOB_FALLBACK]
        };
    };

    // 一般城鎮 NPC 的 idle_0 已直接寫入 DOM；雙省電不需要再建立完整 Image[]。
    window.__afkMobileTownNpcFrames = function () {
        return lite() ? [] : null;
    };

    // 玩家收購 NPC 同樣只交 body／shadow 首幀 URL，不先建立整套 classanim Image[]。
    window.__afkMobileWanderingBuyerStill = function (wanderer, folder) {
        if (!lite()) return null;
        var safeFolder = String(folder || ((wanderer && wanderer.avatar) || '男騎士'));
        var base = 'assets/classanim/' + safeFolder;
        return {
            folder: safeFolder,
            frames: [{ src: base + '/unarmed_idle_0.png' }],
            shadows: [{ src: base + '/unarmed_idle_s_0.png' }]
        };
    };

    function releaseImageValue(value, depth, seen) {
        if (!value || typeof value !== 'object' || depth > 5) return;
        if (seen && seen.indexOf(value) >= 0) return;
        if (seen) seen.push(value);
        try {
            if (typeof value.src === 'string' &&
                (typeof value.removeAttribute === 'function' || 'naturalWidth' in value || 'complete' in value)) {
                value.onload = null;
                value.onerror = null;
                if (typeof value.removeAttribute === 'function') {
                    value.removeAttribute('src');
                    value.removeAttribute('srcset');
                } else {
                    try { value.src = ''; } catch (e) {}
                    try { value.srcset = ''; } catch (e) {}
                }
                return;
            }
        } catch (e) {}
        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) releaseImageValue(value[i], depth + 1, seen);
            return;
        }
        try {
            Object.keys(value).forEach(function (key) {
                releaseImageValue(value[key], depth + 1, seen);
            });
        } catch (e) {}
    }

    function clearCache(cache) {
        if (!cache || typeof cache !== 'object') return 0;
        var keys = [];
        try { keys = Object.keys(cache); } catch (e) { return 0; }
        for (var i = 0; i < keys.length; i++) {
            // 先撤掉 Image 的 src/srcset，再移除 cache 持有權；生命週期呼叫前已停止／移除舊場景，
            // 不清空陣列本身，避免仍在當前 call stack 的讀取出現空幀除數。
            try { releaseImageValue(cache[keys[i]], 0, []); } catch (e) {}
            try { delete cache[keys[i]]; } catch (e) {}
        }
        return keys.length;
    }

    function releaseImageCaches(reason, forceMobileLifecycle) {
        // 換圖／換角在所有手機模式都必須形成資源邊界；雙省電另可隨時主動釋放。
        if (forceMobileLifecycle ? !isMobile() : !lite()) return 0;
        frameEpoch++;   // 先使所有在途 probe 失效，完成回呼不得把上一張圖／上一角色重新塞回 cache
        try {
            if (typeof window.__afkCancelImageProbes === 'function') {
                window.__afkCancelImageProbes();   // 同步取消 queued＋active，立即撤掉舊圖 src
            }
        } catch (e) {}
        var released = 0;
        try { if (typeof _mobAnimCache !== 'undefined') released += clearCache(_mobAnimCache); } catch (e) {}
        try { if (typeof _mob8Cache !== 'undefined') released += clearCache(_mob8Cache); } catch (e) {}
        try { if (typeof _morphBattleCache !== 'undefined') released += clearCache(_morphBattleCache); } catch (e) {}
        try { if (typeof _pet8Cache !== 'undefined') released += clearCache(_pet8Cache); } catch (e) {}
        try { if (typeof _spellFxCache !== 'undefined') released += clearCache(_spellFxCache); } catch (e) {}
        try { if (typeof _deathFxCache !== 'undefined') released += clearCache(_deathFxCache); } catch (e) {}
        try { if (typeof _mobAnchorCache !== 'undefined') released += clearCache(_mobAnchorCache); } catch (e) {}
        try { if (typeof _npcFrameCache !== 'undefined') released += clearCache(_npcFrameCache); } catch (e) {}
        try { if (typeof _npcWeaponFrameCache !== 'undefined') released += clearCache(_npcWeaponFrameCache); } catch (e) {}
        try {
            if (typeof _townNpcSprites !== 'undefined' && Array.isArray(_townNpcSprites)) {
                _townNpcSprites.forEach(function (sprite) {
                    if (!sprite) return;
                    releaseImageValue(sprite.frames, 0, []);
                    releaseImageValue(sprite.wframes, 0, []);
                    sprite.frames = [];
                    sprite.wframes = [];
                    sprite.last = -1;
                });
            }
        } catch (e) {}
        try {
            if (typeof window.__afkClearWanderingBuyerFrames === 'function') {
                window.__afkClearWanderingBuyerFrames();
            }
        } catch (e) {}
        releaseCount++;
        lastReleaseReason = String(reason || 'manual');
        lastReleasedKeys = released;
        return released;
    }

    function releaseActiveActorDom() {
        if (!isMobile()) return;
        try { if (typeof _vfxClearAll === 'function') _vfxClearAll(); } catch (e) {}
        try { if (typeof _playerMorphRemove === 'function') _playerMorphRemove(); } catch (e) {}
        try {
            if (typeof _allySpriteStates !== 'undefined' && _allySpriteStates) {
                Object.keys(_allySpriteStates).forEach(function (slot) {
                    var st = _allySpriteStates[slot];
                    if (st && st.el && typeof st.el.remove === 'function') st.el.remove();
                });
                _allySpriteStates = {};
            }
        } catch (e) {}
        try {
            var partySprites = document.querySelectorAll('.party-sprite');
            for (var i = 0; i < partySprites.length; i++) partySprites[i].remove();
        } catch (e) {}
        try {
            var petLayer = document.getElementById('pet-layer');
            if (petLayer) petLayer.remove();
        } catch (e) {}
    }

    function releaseTownSceneDom() {
        try {
            var map = document.getElementById('town-npc-map');
            if (map) {
                var images = map.querySelectorAll('img[src],img[srcset]');
                for (var i = 0; i < images.length; i++) {
                    images[i].removeAttribute('src');
                    images[i].removeAttribute('srcset');
                }
                map.replaceChildren();
                map.style.backgroundImage = '';
            }
            var town = document.getElementById('town-view');
            if (town) town.style.backgroundImage = '';
        } catch (e) {}
        try {
            if (typeof _townNpcSprites !== 'undefined' && Array.isArray(_townNpcSprites)) {
                _townNpcSprites.length = 0;
            }
        } catch (e) {}
    }

    function releasePanelBody(id) {
        var body = document.getElementById(id);
        if (!body) return;
        var images = body.querySelectorAll('img[src],img[srcset]');
        for (var i = 0; i < images.length; i++) {
            images[i].removeAttribute('src');
            images[i].removeAttribute('srcset');
        }
        body.replaceChildren();
    }

    function releaseCardBookBody() {
        releasePanelBody('card-book-body');
    }

    var bookBodies = [
        ['card-book', 'card-book-body'],
        ['equip-book', 'equip-book-body'],
        ['misc-book', 'misc-book-body'],
        ['relic-book', 'relic-book-body']
    ];

    function releaseHiddenImagePanels() {
        if (!isMobile()) return;
        bookBodies.forEach(function (entry) {
            var panel = document.getElementById(entry[0]);
            if (!panel || panel.classList.contains('hidden')) releasePanelBody(entry[1]);
        });
        var wiki = document.getElementById('m-wiki-modal');
        if (wiki && !wiki.classList.contains('open') && !wiki.getAttribute('data-standalone')) {
            releasePanelBody('m-wiki-body');
        }
    }

    function closeAndReleaseCardBook() {
        try {
            if (typeof window.closeCardBook === 'function') window.closeCardBook();
            else {
                if (typeof _cardBookOpen !== 'undefined') _cardBookOpen = false;
                var book = document.getElementById('card-book');
                if (book) book.classList.add('hidden');
            }
        } catch (e) {}
        releaseCardBookBody();
    }

    function closeAndReleaseImagePanels() {
        closeAndReleaseCardBook();
        [
            ['closeEquipBook', 'equip-book-body'],
            ['closeMiscBook', 'misc-book-body'],
            ['closeRelicBook', 'relic-book-body']
        ].forEach(function (entry) {
            try {
                if (typeof window[entry[0]] === 'function') window[entry[0]]();
            } catch (e) {}
            releasePanelBody(entry[1]);
        });
        try {
            var wiki = document.getElementById('m-wiki-modal');
            if (wiki && wiki.classList.contains('open') && !wiki.getAttribute('data-standalone')) {
                var close = document.getElementById('m-wiki-close');
                if (close) close.click();
            }
        } catch (e) {}
        releasePanelBody('m-wiki-body');
    }

    function installCardBookGuard() {
        var current = window.closeCardBook;
        if (typeof current !== 'function' || current.__afkMobileMemory) return;
        var wrapped = function () {
            var result = current.apply(this, arguments);
            if (isMobile()) releaseCardBookBody();
            return result;
        };
        wrapped.__afkMobileMemory = true;
        wrapped.__afkMobileMemoryOriginal = current;
        window.closeCardBook = wrapped;
    }

    function installBookCloseGuard(name, bodyId) {
        var current = window[name];
        if (typeof current !== 'function' || current.__afkMobileMemory) return;
        var wrapped = function () {
            var result = current.apply(this, arguments);
            if (isMobile()) releasePanelBody(bodyId);
            return result;
        };
        wrapped.__afkMobileMemory = true;
        wrapped.__afkMobileMemoryOriginal = current;
        window[name] = wrapped;
    }

    function installImagePanelGuards() {
        installCardBookGuard();
        installBookCloseGuard('closeEquipBook', 'equip-book-body');
        installBookCloseGuard('closeMiscBook', 'misc-book-body');
        installBookCloseGuard('closeRelicBook', 'relic-book-body');
        installBookCloseGuard('closeNpcInteraction', 'interaction-content');
        var wiki = document.getElementById('m-wiki-modal');
        if (!wiki || wiki.__afkMobileMemoryObserver || typeof MutationObserver !== 'function') return;
        var observer = new MutationObserver(function () {
            if (isMobile() && !wiki.classList.contains('open') && !wiki.getAttribute('data-standalone')) {
                releasePanelBody('m-wiki-body');
            }
        });
        observer.observe(wiki, { attributes: true, attributeFilter: ['class'] });
        wiki.__afkMobileMemoryObserver = observer;
    }

    function dehydrateCreationAssets() {
        if (!lite()) return;
        var screen = document.getElementById('creation-screen');
        if (!screen || !screen.classList.contains('hidden')) return;
        var images = screen.querySelectorAll('img[src],img[srcset]');
        for (var i = 0; i < images.length; i++) {
            var img = images[i];
            // 角色切換每次都要顯示 load-select；保留這兩張固定底圖比反覆 remove/restore 造成
            // WebKit native image churn 更省。只卸載主選單與創角面板的非當前資源。
            if (img.id === 'load-select-bg' || img.id === 'load-select-overlay') continue;
            var src = img.getAttribute('src');
            var srcset = img.getAttribute('srcset');
            if (src) img.setAttribute('data-afk-memory-src', src);
            if (srcset) img.setAttribute('data-afk-memory-srcset', srcset);
            img.removeAttribute('src');
            img.removeAttribute('srcset');
        }
    }

    function restoreImages(root) {
        if (!root) return;
        var images = root.querySelectorAll('img[data-afk-memory-src],img[data-afk-memory-srcset]');
        for (var i = 0; i < images.length; i++) {
            var img = images[i];
            var src = img.getAttribute('data-afk-memory-src');
            var srcset = img.getAttribute('data-afk-memory-srcset');
            if (src && !img.getAttribute('src')) img.setAttribute('src', src);
            if (srcset && !img.getAttribute('srcset')) img.setAttribute('srcset', srcset);
        }
    }

    function restoreCreationAssets(onlyVisible) {
        var screen = document.getElementById('creation-screen');
        if (!screen) return;
        if (onlyVisible && screen.classList.contains('hidden')) return;
        if (!onlyVisible) {
            restoreImages(screen);
            return;
        }
        var main = document.getElementById('main-menu');
        var load = document.getElementById('load-select-panel');
        var creation = document.getElementById('creation-panel');
        if (main && !main.classList.contains('hidden')) {
            restoreImages(document.getElementById('login-art-stage'));
        }
        if (load && !load.classList.contains('hidden')) restoreImages(load);
        if (creation && !creation.classList.contains('hidden')) restoreImages(creation);
    }

    function applyLiteBackground() {
        if (!lite()) return false;
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
        return true;
    }

    // afk-training 會在本檔之後再包 applyAreaBackground；DOM ready 時重包目前最外層，
    // 使木人場也先走雙省電判斷，不再繞過去解碼 1920×1080 背景。
    function installAreaGuard() {
        var current = window.applyAreaBackground;
        if (typeof current !== 'function' || current.__afkMobileMemoryOuter) return;
        var wrapped = function () {
            if (applyLiteBackground()) return;
            return current.apply(this, arguments);
        };
        wrapped.__afkMobileMemoryOuter = true;
        wrapped.__afkMobileMemoryOriginal = current;
        window.applyAreaBackground = wrapped;
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

    // 圖鑑等非戰鬥畫面也呼叫 mobStillImg；最外層改寫可讓它們共用 96×96 圖。
    function installMobStillGuard() {
        var current = window.mobStillImg;
        if (typeof current !== 'function' || current.__afkMobileMemory) return;
        var wrapped = function (name) {
            var mobile = window.__afkMobileMobStill(name);
            if (mobile) return mobile;
            return current.apply(this, arguments);
        };
        wrapped.__afkMobileMemory = true;
        wrapped.__afkMobileMemoryOriginal = current;
        window.mobStillImg = wrapped;
    }

    function actorStillSrc(form) {
        if (!form || !form.base) return '';
        return form.base + (form.wpn ? form.wpn + '_idle_0.png' : 'idle_0.png');
    }

    // 關動畫時直接建立 body idle_0 單幀；不進 _battleSpriteProbe/_pet8Probe，
    // 因此不會為了「畫一張靜態角色」解碼 idle/attack/skill/hurt/death 全套序列。
    function renderStaticActors() {
        if (!isMobile() || !settingOn('noanim')) return false;
        var game = document.getElementById('game-screen');
        var battle = document.getElementById('battle-view');
        if (!game || game.classList.contains('hidden') || !battle ||
            battle.classList.contains('hidden') || !battle.classList.contains('area-fit')) return false;
        // role-ready／map-change 可能在同一輪事件各排一次；建立前先收掉上一組，
        // 保證畫面永遠只有一份玩家、傭兵與寵物靜態 DOM。
        releaseActiveActorDom();
        var positions = null;
        try { if (typeof _partySpritePos === 'function') positions = _partySpritePos(); } catch (e) {}
        try {
            if (typeof player !== 'undefined' && player && player.cls &&
                typeof _playerBattleForm === 'function') {
                var form = _playerBattleForm();
                var src = actorStillSrc(form);
                if (form && src) {
                    var el = document.createElement('div');
                    el.id = 'player-morph-sprite';
                    el.className = 'afk-mobile-static-actor';
                    var sh = document.createElement('img'); sh.className = 'pm-shadow'; sh.style.visibility = 'hidden';
                    var bd = document.createElement('img'); bd.className = 'pm-body'; bd.src = src;
                    var wp = document.createElement('img'); wp.className = 'pm-weapon'; wp.style.visibility = 'hidden';
                    [sh, bd, wp].forEach(function (img) { img.alt = ''; img.draggable = false; });
                    el.append(sh, bd, wp);
                    var pp = positions && positions.P ? positions.P : { x: '45.5%', b: 2 };
                    var yoff = 0; try { if (typeof _playerMorphYOffset === 'function') yoff = _playerMorphYOffset(form) || 0; } catch (e) {}
                    el.style.width = '100px';
                    el.style.left = 'calc(' + pp.x + ' - 50px)';
                    el.style.bottom = (pp.b - yoff) + 'px';
                    el.style.zIndex = String(30 - pp.b);
                    battle.appendChild(el);
                    try {
                        if (typeof _pmState !== 'undefined' && _pmState) {
                            _pmState.el = el;
                            _pmState.imgs = { sh: sh, bd: bd, wp: wp, cr: null };
                            _pmState.name = form.domKey;
                            _pmState.act = null;
                            _pmState.prevHp = player.hp;
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}
        try {
            var allies = (typeof player !== 'undefined' && player && Array.isArray(player.allies)) ? player.allies : [];
            allies.forEach(function (ally, index) {
                if (!ally || typeof _actorBattleForm !== 'function') return;
                var form = _actorBattleForm(ally, index > 0);
                var src = actorStillSrc(form);
                if (!form || !src) return;
                var slot = String(ally._slot == null ? index : ally._slot);
                var el = document.createElement('div');
                el.className = 'party-sprite afk-mobile-static-actor';
                el.setAttribute('data-afk-ally-slot', slot);
                var sh = document.createElement('img'); sh.className = 'pm-shadow'; sh.style.visibility = 'hidden';
                var bd = document.createElement('img'); bd.className = 'pm-body'; bd.src = src;
                var wp = document.createElement('img'); wp.className = 'pm-weapon'; wp.style.visibility = 'hidden';
                [sh, bd, wp].forEach(function (img) { img.alt = ''; img.draggable = false; });
                el.append(sh, bd, wp);
                var ap = positions && positions.A && positions.A[index] ? positions.A[index] : { x: (20 + index * 12) + '%', b: 2 };
                var yoff = 0; try { if (typeof _playerMorphYOffset === 'function') yoff = _playerMorphYOffset(form) || 0; } catch (e) {}
                el.style.width = '100px';
                el.style.left = 'calc(' + ap.x + ' - 50px)';
                el.style.bottom = (ap.b - yoff) + 'px';
                el.style.zIndex = String(30 - ap.b);
                battle.appendChild(el);
                try {
                    if (typeof _allySpriteStates !== 'undefined') {
                        _allySpriteStates[slot] = {
                            act: null, t: 0, prevHp: ally.curHp || 0, el: el,
                            imgs: { sh: sh, bd: bd, wp: wp }, key: form.key, dkey: form.domKey,
                            skGen: false, pendAtk: false
                        };
                    }
                } catch (e) {}
            });
        } catch (e) {}
        try {
            var outs = [];
            if (typeof petsOutList === 'function') outs = petsOutList() || [];
            if (typeof summonRenderList === 'function') outs = outs.concat(summonRenderList() || []);
            if (typeof guardRenderList === 'function') outs = outs.concat(guardRenderList() || []);
            if (outs.length && typeof _petLayerEl === 'function' && typeof _petSpriteEl === 'function') {
                var layer = _petLayerEl();
                outs.filter(Boolean).forEach(function (pet, index) {
                    var el = _petSpriteEl(layer, pet);
                    var body = el.querySelector('.pet-body');
                    var shadow = el.querySelector('.pet-shadow');
                    var dir = pet._dir == null ? 6 : pet._dir;
                    var gfx = pet.formGfx || pet.form;
                    if (body && gfx) body.src = 'assets/anim/' + encodeURIComponent(gfx) + '/d' + dir + '/idle_0.png';
                    if (shadow) { shadow.removeAttribute('src'); shadow.style.visibility = 'hidden'; }
                    if (pet._px == null) pet._px = 0.15 + index * 0.08;
                    if (pet._py == null) pet._py = 0.72 + (index % 2) * 0.08;
                    el.style.left = (pet._px * 100) + '%';
                    el.style.top = (pet._py * 100) + '%';
                });
            }
        } catch (e) {}
        return true;
    }
    window.__afkMobileMemoryRenderStaticActors = renderStaticActors;

    function catchupActiveNow() {
        try {
            if (typeof state !== 'undefined' && state && state.ff) return true;
        } catch (e) {}
        try {
            return !!(window.__afk && typeof window.__afk.isCatchingUp === 'function' &&
                window.__afk.isCatchingUp());
        } catch (e) { return false; }
    }

    function scheduleStaticActors() {
        staticActorsPending = true;
        if (catchupActiveNow() || staticActorsTimer) return;
        staticActorsTimer = setTimeout(function () {
            staticActorsTimer = 0;
            if (catchupActiveNow()) return;
            staticActorsPending = false;
            renderStaticActors();
        }, 0);
    }

    // 離線結算尾端一定會重啟 live timers；包這個既有邊界，在 catchingUp/ff 清除後
    // 把期間合併掉的多次 map-change 靜態角色渲染只補一次。
    function installStartGameFlush() {
        var current = window.startGameTimers;
        if (typeof current !== 'function' || current.__afkMobileMemoryStaticFlush) return;
        var wrapped = function () {
            var result = current.apply(this, arguments);
            if (staticActorsPending) setTimeout(scheduleStaticActors, 0);
            return result;
        };
        wrapped.__afkMobileMemoryStaticFlush = true;
        wrapped.__afkMobileMemoryStaticFlushOriginal = current;
        window.startGameTimers = wrapped;
    }

    function rerenderActiveVisuals() {
        var game = document.getElementById('game-screen');
        if (!game || game.classList.contains('hidden')) return;
        try { if (typeof window.applyAreaBackground === 'function') window.applyAreaBackground(); } catch (e) {}
        try {
            if (typeof mapState !== 'undefined' && mapState && String(mapState.current || '').indexOf('town_') === 0 &&
                typeof window.renderTownNPCMap === 'function') {
                window.renderTownNPCMap(mapState.current);
            }
        } catch (e) {}
        try { if (typeof window.renderMobs === 'function') window.renderMobs(true); } catch (e) {}
        try {
            if (typeof _cardBookOpen !== 'undefined' && _cardBookOpen &&
                typeof window.renderCardBook === 'function') window.renderCardBook();
        } catch (e) {}
        try {
            if (catchupActiveNow()) staticActorsPending = true;
            else renderStaticActors();
        } catch (e) {}
    }

    function refreshMode(force) {
        injectStyle();
        installAreaGuard();
        installMobStillGuard();
        installImagePanelGuards();
        installStartGameFlush();
        var mobileNow = isMobile();
        var mobileCapShrank = lastMobileState === false && mobileNow;
        lastMobileState = mobileNow;
        if (mobileCapShrank) {
            // 桌機 probe 上限 12 縮成手機 6 時不能等舊請求自然結束：先推進 epoch、
            // 取消／卸載整批舊 Image 並清 cache，下一次 render 才會依新上限乾淨重建。
            releaseActiveActorDom();
            releaseImageCaches('mobile-cap-shrink', true);
        }
        try {
            if (typeof window.__afkEnforceImageProbeCap === 'function') {
                window.__afkEnforceImageProbeCap();
            }
        } catch (e) {}
        var active = lite();
        if (document.documentElement) document.documentElement.classList.toggle('afk-memory-lite-boot', active);
        if (document.body) document.body.classList.toggle('afk-mobile-memory-lite', active);
        if (!force && modeActive === active) {
            if (mobileCapShrank) rerenderActiveVisuals();
            return active;
        }
        var previous = modeActive;
        modeActive = active;
        if (active) {
            if (!mobileCapShrank) {
                releaseActiveActorDom();
                releaseImageCaches(previous === null ? 'initial-lite' : 'mode-enable');
            }
            setTimeout(dehydrateCreationAssets, 0);
        } else if (previous === true) {
            restoreCreationAssets(true);
        }
        rerenderActiveVisuals();
        try {
            window.dispatchEvent(new CustomEvent('afk-mobile-memory-change', { detail: { active: active } }));
        } catch (e) {}
        return active;
    }

    window.__afkMobileMemoryLifecycle = function (phase) {
        if (phase === 'character-select') {
            releaseActiveActorDom();
            closeAndReleaseImagePanels();
            releaseImageCaches(phase, true);
            restoreCreationAssets(true);
            try { window.dispatchEvent(new CustomEvent('afk-mobile-memory-login', { detail: { visible: true } })); } catch (e) {}
            return;
        }
        if (phase === 'role-load' || phase === 'role-start') {
            releaseActiveActorDom();
            closeAndReleaseImagePanels();
            releaseImageCaches(phase, true);
            if (lite()) setTimeout(dehydrateCreationAssets, 0);
            try { window.dispatchEvent(new CustomEvent('afk-mobile-memory-login', { detail: { visible: false } })); } catch (e) {}
            return;
        }
        if (phase === 'role-ready') {
            if (lite()) setTimeout(dehydrateCreationAssets, 0);
            scheduleStaticActors();
            try { window.dispatchEvent(new CustomEvent('afk-mobile-memory-login', { detail: { visible: false } })); } catch (e) {}
            return;
        }
        if (phase === 'map-change') {
            releaseActiveActorDom();
            releaseTownSceneDom();
            releaseHiddenImagePanels();
            releaseImageCaches(phase, true);
            scheduleStaticActors();
            return;
        }
        releaseImageCaches(phase, true);
    };
    window.__afkMobileMemoryRelease = releaseImageCaches;
    window.__afkMobileMemoryRefresh = refreshMode;
    window.__afkMobileMemoryStats = function () {
        return {
            active: lite(),
            releases: releaseCount,
            lastReason: lastReleaseReason,
            lastReleasedKeys: lastReleasedKeys,
            frameEpoch: frameEpoch
        };
    };

    // PP 的省電面板由閉包動態建立，外掛無法直接改 opts；開窗後補一行明確說明。
    function explainCombinedMode() {
        var overlay = document.getElementById('afk-ps-overlay');
        if (!overlay || document.getElementById('afk-ps-memory-note')) return;
        var rows = overlay.querySelector('div[style*="padding:12px 14px"]');
        if (!rows) return;
        var note = document.createElement('div');
        note.id = 'afk-ps-memory-note';
        note.style.cssText = 'font-size:11px;color:#7dd3fc;padding:2px 4px 8px;line-height:1.45;';
        note.textContent = '手機同時開啟兩項時，會限制圖片快取、簡化場景／怪物並讓未開啟的背包休眠，避免白屏重載。';
        rows.appendChild(note);
    }

    document.addEventListener('click', function () {
        setTimeout(function () {
            restoreCreationAssets(true);
            explainCombinedMode();
            installImagePanelGuards();
            refreshMode(false);
        }, 0);
    }, false);
    try {
        window.addEventListener('storage', function (event) {
            if (!event || event.key === 'afk_ps_noanim' || event.key === 'afk_ps_lowfps') refreshMode(false);
        });
        window.addEventListener('resize', function () {
            // cap 由 12→6 是資源安全邊界，立即處理；其餘一般 resize 仍維持 200ms 合併。
            if (lastMobileState === false && isMobile()) {
                if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = 0; }
                refreshMode(false);
                return;
            }
            try {
                if (typeof window.__afkEnforceImageProbeCap === 'function') {
                    window.__afkEnforceImageProbeCap();
                }
            } catch (e) {}
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () { resizeTimer = 0; refreshMode(false); }, 200);
        });
    } catch (e) {}

    installAreaGuard();
    installMobStillGuard();
    installImagePanelGuards();
    installStartGameFlush();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            // 所有後載外掛（含 afk-training）已完成，再把目前最外層包回來。
            installAreaGuard();
            installMobStillGuard();
            installImagePanelGuards();
            installStartGameFlush();
            refreshMode(true);
            setTimeout(installImagePanelGuards, 0);   // afk-wiki 在本檔之後的 DOMContentLoaded handler 才建立 modal
        }, { once: true });
    } else {
        refreshMode(true);
    }

    try {
        console.log('[AFK-mobile-memory] hooks OK — 手機雙省電已啟用圖片生命週期、城鎮首幀、登入卸載與場景縮圖。');
    } catch (e) {}
})();
