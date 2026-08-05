/**
 * afk-powersave.js — 省電模式（補回我方原本核心的 2 個省電選項＋光暈濾鏡開關）
 *
 * 上游首頁原生已有「✨戰鬥特效」「🔢傷害數字」兩顆開關（__vfxOff / __vfxNumOff）。我方原本核心還多兩個：
 *   ① 關戰鬥動畫：把 8fps sprite ticker 推進的動畫關掉（怪/玩家/傭兵/寵物/召喚 sprite 不再逐幀動）。
 *   ② 降畫面更新頻率：把 updateUI / renderMobs 節流成低幀（省 CPU/電；遊戲邏輯 tick 照跑，只是畫面更新變慢）。
 *   ③ 關閉光暈與濾鏡：注入覆寫樣式拔掉常駐的 GPU 熱點（全域圖片濾鏡、鎖定光暈、物品光暈動畫、
 *      modal 背景模糊…）。手機發熱的主力是這些每幀重算的 filter，詳見 docs/perf-battery.md。
 * 這支把這 3 個做成外掛：純包核心函式＋注入 CSS、不動核心；設定存本機（per 裝置的效能偏好，不進存檔）。
 *
 * 入口：首頁「⚙ 其他功能 → 🔋 省電模式」面板勾選。關掉本外掛(開關) → 完全回原版。
 */
(function () {
    'use strict';
    if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('powersave')) return;   // 🎚️ 外掛開關

    // on() 掛在 sprite ticker / updateUI 的熱路徑上（每秒數十次），不能每次同步讀 localStorage。
    // 唯一寫入者是本檔 set()（面板勾選），快取不會過期。
    var _ps = {};
    function on(k) {
        if (k in _ps) return _ps[k];
        try { return (_ps[k] = localStorage.getItem('afk_ps_' + k) === '1'); } catch (e) { return false; }
    }
    function set(k, v) { try { localStorage.setItem('afk_ps_' + k, v ? '1' : '0'); } catch (e) {} _ps[k] = !!v; }

    // ① 關戰鬥動畫：包住 8fps ticker 會呼叫的 sprite 函式，開啟時直接 no-op（畫面停在當前幀、不再逐幀動）。
    //   _petAnimApply=寵物/召喚物 sprite(js/22 自己的 ticker,已改間接呼叫讓 wrapper 生效);漏包它=關動畫後召喚物照樣跑(踩過)。
    ['_mobAnimApply', '_allySpritesApply', '_playerMorphApply', '_petAnimApply'].forEach(function (fn) {
        if (typeof window[fn] === 'function' && !window[fn].__afkPs) {
            var o = window[fn];
            window[fn] = function () { if (on('noanim')) return; return o.apply(this, arguments); };
            window[fn].__afkPs = true;
        }
    });

    // ② 降畫面更新頻率：時間節流 updateUI / renderMobs（開啟時 ~最多 8fps）。遊戲邏輯(tick)不受影響。
    var _last = {};
    var MIN_MS = 125;   // 約 8fps
    ['updateUI', 'renderMobs'].forEach(function (fn) {
        if (typeof window[fn] === 'function' && !window[fn].__afkPsThrottle) {
            var o = window[fn];
            window[fn] = function () {
                // ⚡ 離線補跑期間(catchupActive)透明放行：核心 updateUI/renderMobs 此時本就早退，
                //   而每殺一隻怪都會呼叫它們 → 這裡每次 on('lowfps') 讀 localStorage 純浪費（離線結算 profile 佔 ~2%）。
                if (typeof catchupActive === 'function' && catchupActive()) return o.apply(this, arguments);
                if (on('lowfps')) {
                    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    if (_last[fn] && (now - _last[fn]) < MIN_MS) return;   // 太密就跳過這次渲染（下次 gameLoop 會再來）
                    _last[fn] = now;
                }
                return o.apply(this, arguments);
            };
            window[fn].__afkPsThrottle = true;
        }
    });

    // ③ 關閉光暈與濾鏡：鏡射上游選擇器覆寫、靠「後載入者勝出」而**不用 !important**——
    //    功能性 filter（剪影怪 brightness(0)、reduced-motion 的 !important 靜態光）的勝負關係才不會被打亂。
    var NOFX_CSS = [
        /* 全遊戲每張 <img> 的常駐濾鏡：任一張 8fps 換幀都整層重算，是最大範圍的 GPU 熱點 */
        '#game-screen img, #creation-screen img, #battle-view img { filter: none; }',
        /* 鎖定紅光暈疊在 8fps 換幀的 sprite 上 → 拔掉，改用便宜的外框標示鎖定中的怪 */
        '#battle-view.has-bg .mob-target.active .mob-img-inner { filter: none; }',
        '#battle-view.has-bg .mob-target.active .mob-img-inner.mob-shadow-tint { filter: brightness(0); }',
        '#battle-view.has-bg .mob-target.active { outline: 2px solid rgba(239,68,68,.75); outline-offset: -2px; }',
        /* 物品/怪物光暈：drop-shadow 動畫每幀重算；靜態多層光也一併拔（背包開著就是整片） */
        '.legend-glow, .mana-glow, .relic-glow, .bless-glow, .curse-glow, .ancient-glow,',
        '.anc-bless-glow, .ancient-glow-strong, .bless-glow-strong, .tri-glow,',
        '.attr-glow-fr5, .attr-glow-wa5, .attr-glow-wi5, .attr-glow-ea5,',
        '.sherine-glow-icon, .rem-slot-dim .sherine-glow-icon, .grace-glow { animation: none; filter: none; }',
        '.c-sherine { animation: none; }',
        '.attr-glow-fr1, .attr-glow-fr2, .attr-glow-fr3, .attr-glow-fr4,',
        '.attr-glow-wa1, .attr-glow-wa2, .attr-glow-wa3, .attr-glow-wa4,',
        '.attr-glow-wi1, .attr-glow-wi2, .attr-glow-wi3, .attr-glow-wi4,',
        '.attr-glow-ea1, .attr-glow-ea2, .attr-glow-ea3, .attr-glow-ea4 { filter: none; }',
        /* 遺物星芒/遺骸與套裝掃光/稀有掉落脈動：停動畫、留靜態（掃光比照上游 reduced-motion 的降級寫法） */
        '.classic-icon-box:has(.relic-glow)::before, .classic-icon-box:has(.relic-glow)::after,',
        '.equipment-visual-slot:has(.relic-glow)::before, .equipment-visual-slot:has(.relic-glow)::after,',
        '.relic-glow-wrap::before, .relic-glow-wrap::after { animation: none; }',
        '.rem-slot-lit::after, .set-slot-lit::after { animation: none; transform: none; opacity: .18; width: 100%; }',
        '#sys-log .sys-item-gain .sys-drop-rare { animation: none; }',
        /* 日誌 inline 色字的整批 filter：最多 150 個 span，每秒插入訊息時整段跟著重繪 */
        '#combat-log [style*="color:"], #sys-log [style*="color:"] { filter: none; }',
        /* 頭目狂暴：拔本體 drop-shadow 呼吸與 blur 氣焰（最貴的兩層），保留地面紅環當狂暴標示 */
        '#battle-view .mob-target.mob-raging .mob-img-wrap { animation: none; }',
        '#battle-view .mob-target.mob-raging .mob-img-inner::before { display: none; }',
        /* modal 的全螢幕背景模糊：底下戰鬥還在 8fps 換幀，開著就每幀重算整片模糊 */
        ':is(#autosell-rule-modal, #autosell-preview-modal, #poly-modal, #osiris-box-modal,',
        '    #summon-select-overlay, #pet-evo-overlay, #pet-gear-overlay,',
        '    #pvp-arena-modal, #pvp-result-modal,',
        '    #card-book, #equip-book, #misc-book, #relic-book, #collection-panel) { backdrop-filter: none; }',
        '.backdrop-blur-sm { backdrop-filter: none; -webkit-backdrop-filter: none; }'
    ].join('\n');
    function applyNofx() {
        var el = document.getElementById('afk-ps-nofx');
        if (on('nofx')) {
            if (!el) {
                el = document.createElement('style'); el.id = 'afk-ps-nofx'; el.textContent = NOFX_CSS;
                (document.head || document.documentElement).appendChild(el);
            }
        } else if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    applyNofx();

    // ── 首頁設定面板 ──
    window.AFK_SETTINGS = window.AFK_SETTINGS || { _items: [], add: function (it) { this._items.push(it); } };
    AFK_SETTINGS.add({ label: '🔋 省電模式', onClick: openPanel });
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    // ── 原版本來就有的四個開關,收進同一個面板 ─────────────────────
    // 音樂/音效在遊戲中的音量列、戰鬥特效/傷害數字在標題畫面,分散在三個地方,而玩家想省電時
    // 是「四個一起關」。這裡**不另存一份設定**——一律讀寫核心自己的狀態並呼叫核心的 setter,
    // 所以原本那三處的顯示會跟著變、關掉本外掛也不會留下孤兒設定。
    // 勾選＝省電(該效果關閉),與上面兩項語意一致。
    var CORE = {
        vfx:    { get: function () { return !window.__vfxOff; },
                  set: function (want) { if (!!window.__vfxOff === !want) return; toggleVfxPref(); } },
        vfxnum: { get: function () { return !window.__vfxNumOff; },
                  set: function (want) { if (!!window.__vfxNumOff === !want) return; toggleVfxNumPref(); } },
        bgm:    { get: function () { return !!(window._bgmCfg && _bgmCfg.on); },
                  set: function (want) { setBgmOn(want); try { _bgmSyncUI(); } catch (e) {} } },
        sfx:    { get: function () { return !!(window._sfxCfg && _sfxCfg.on); },
                  set: function (want) { setSfxOn(want); try { _sfxSyncUI(); } catch (e) {} } }
    };
    // 核心少了哪一支就不列那一列(上游改版時安靜少一項,不會整個面板壞掉)
    function coreReady(k) {
        try {
            if (k === 'vfx') return typeof toggleVfxPref === 'function';
            if (k === 'vfxnum') return typeof toggleVfxNumPref === 'function';
            if (k === 'bgm') return typeof setBgmOn === 'function' && typeof _bgmCfg === 'object';
            if (k === 'sfx') return typeof setSfxOn === 'function' && typeof _sfxCfg === 'object';
        } catch (e) {}
        return false;
    }

    function openPanel() {
        if (document.getElementById('afk-ps-overlay')) return;
        var ov = document.createElement('div');
        ov.id = 'afk-ps-overlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.66);display:flex;align-items:flex-start;justify-content:center;padding:calc(var(--orig-bar-h,0px) + 14px) 12px 12px;';
        if (window.AFK_TOGGLES && AFK_TOGGLES.applyBannerPad) AFK_TOGGLES.applyBannerPad(ov);   // 開啟當下實測橫幅高度覆寫 padding-top
        // 由上而下＝省電效果由大到小(畫面整體節流 > 逐幀動畫 > 光暈濾鏡 > 特效 > 浮動數字 > 音樂 > 音效)
        var opts = [
            { k: 'lowfps', name: '降低畫面更新頻率', desc: '畫面更新節流到約 8fps（遊戲邏輯照跑，只是畫面較不即時）' },
            { k: 'noanim', name: '關閉戰鬥動畫', desc: '怪物/玩家/傭兵/寵物/召喚的逐幀動畫停止（傷害/戰鬥數值不變）' },
            { k: 'nofx', name: '關閉光暈與濾鏡', desc: '裝備與怪物的發光、畫面濾鏡等裝飾效果關閉（鎖定改用紅框標示）' },
            { core: 'vfx', name: '關閉戰鬥特效', desc: '不再播放技能與攻擊的特效動畫' },
            { core: 'vfxnum', name: '關閉傷害數字', desc: '不再跳出傷害/治療的浮動數字' },
            { core: 'bgm', name: '關閉背景音樂', desc: '同遊戲中音量列的音樂開關' },
            { core: 'sfx', name: '關閉音效', desc: '同遊戲中音量列的音效開關' }
        ].filter(function (o) { return !o.core || coreReady(o.core); });
        var rows = opts.map(function (o) {
            var checked = o.core ? !CORE[o.core].get() : on(o.k);   // 核心那四項:勾選＝該效果關閉
            var attr = o.core ? ('data-pscore="' + o.core + '"') : ('data-ps="' + o.k + '"');
            return '<label style="display:flex;align-items:center;gap:12px;padding:10px;border:1px solid #1e293b;border-radius:10px;margin-bottom:8px;cursor:pointer;background:#0b1222;">'
                + '<input type="checkbox" ' + attr + ' ' + (checked ? 'checked' : '') + ' style="width:18px;height:18px;flex:none;accent-color:#22c55e;">'
                + '<span><span style="font-weight:600;">' + esc(o.name) + '</span><span style="display:block;font-size:11px;color:#94a3b8;margin-top:2px;">' + esc(o.desc) + '</span></span></label>';
        }).join('');
        var card = document.createElement('div');
        card.style.cssText = 'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;max-width:460px;width:100%;';
        card.innerHTML = '<div style="padding:16px 18px;border-bottom:1px solid #1e293b;"><div style="font-size:17px;font-weight:700;">🔋 省電模式</div>'
            + '<div style="font-size:12px;color:#94a3b8;margin-top:3px;">由上往下省電效果遞減，覺得耗電或卡就從上面開始勾；不影響任何遊戲數值。</div></div>'
            + '<div style="padding:12px 14px;">' + rows + '</div>'
            + '<div style="padding:12px 16px;border-top:1px solid #1e293b;text-align:right;"><button id="afk-ps-close" style="background:#0ea5e9;border:none;color:#04263a;font-weight:700;border-radius:8px;padding:8px 16px;cursor:pointer;">完成</button></div>';
        ov.appendChild(card); document.body.appendChild(ov);
        function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        card.querySelector('#afk-ps-close').addEventListener('click', close);
        card.querySelectorAll('input[data-ps]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                set(cb.getAttribute('data-ps'), cb.checked);
                applyNofx();
                if (typeof window.__afkMobileMemoryRefresh === 'function') {
                    window.__afkMobileMemoryRefresh(false);
                }
            });
        });
        card.querySelectorAll('input[data-pscore]').forEach(function (cb) {
            // 勾選＝省電＝把該效果關掉 → 傳給核心的是「要不要開啟」,所以取反
            cb.addEventListener('change', function () {
                try { CORE[cb.getAttribute('data-pscore')].set(!cb.checked); } catch (e) {}
            });
        });
    }

    try { console.log('[AFK-powersave] hooks OK — 省電模式（關動畫/降更新頻率）已就緒。'); } catch (e) {}
})();
