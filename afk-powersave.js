/**
 * afk-powersave.js — 省電模式（補回我方原本核心的 2 個省電選項）
 *
 * 上游首頁原生已有「✨戰鬥特效」「🔢傷害數字」兩顆開關（__vfxOff / __vfxNumOff）。我方原本核心還多兩個：
 *   ① 關戰鬥動畫：把 8fps sprite ticker 推進的動畫關掉（怪/玩家/傭兵/寵物/召喚 sprite 不再逐幀動）。
 *   ② 降畫面更新頻率：把 updateUI / renderMobs 節流成低幀（省 CPU/電；遊戲邏輯 tick 照跑，只是畫面更新變慢）。
 * 這支把這 2 個做成外掛：純包核心函式、不動核心；設定存本機（per 裝置的效能偏好，不進存檔）。
 *
 * 入口：首頁「⚙ 其他功能 → 🔋 省電模式」面板兩個勾選。關掉本外掛(開關) → 完全回原版。
 */
(function () {
    'use strict';
    if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('powersave')) return;   // 🎚️ 外掛開關

    function on(k) { try { return localStorage.getItem('afk_ps_' + k) === '1'; } catch (e) { return false; } }
    function set(k, v) { try { localStorage.setItem('afk_ps_' + k, v ? '1' : '0'); } catch (e) {} }

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
        // 由上而下＝省電效果由大到小(畫面整體節流 > 逐幀動畫 > 特效 > 浮動數字 > 音樂 > 音效)
        var opts = [
            { k: 'lowfps', name: '降低畫面更新頻率', desc: '畫面更新節流到約 8fps（遊戲邏輯照跑，只是畫面較不即時）' },
            { k: 'noanim', name: '關閉戰鬥動畫', desc: '怪物/玩家/傭兵/寵物/召喚的逐幀動畫停止（傷害/戰鬥數值不變）' },
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
