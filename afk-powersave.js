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

    // 設定讀進記憶體：動畫 ticker / 畫面刷新會高頻詢問，不能每次都同步讀 localStorage。
    var _prefs = Object.create(null);
    function on(k) {
        if (Object.prototype.hasOwnProperty.call(_prefs, k)) return _prefs[k];
        try { _prefs[k] = localStorage.getItem('afk_ps_' + k) === '1'; }
        catch (e) { _prefs[k] = false; }
        return _prefs[k];
    }
    function set(k, v) {
        _prefs[k] = !!v;
        try { localStorage.setItem('afk_ps_' + k, v ? '1' : '0'); } catch (e) {}
    }
    window.addEventListener('storage', function (ev) {
        if (ev.key && ev.key.indexOf('afk_ps_') === 0) _prefs[ev.key.slice(7)] = ev.newValue === '1';
    });

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

    // ③ 背包增量更新 / 隱藏分頁延遲重建
    //
    // 核心 renderTabs() 會同時重建裝備、技能、武器、防具、道具五個分頁。戰鬥中箭矢/肉的
    // 數量或掉落每次變動都會走這條，重背包在手機上會持續製造大量 DOM / style / layout。
    //
    // 外掛層策略：
    //   - 戰鬥 tick 內只排一次 250ms 的輕量檢查；只有數量變動就原地改角標。
    //   - 結構真的變動（新增/刪除/排序/強化/鎖定/裝備/技能）才做完整 renderTabs，
    //     且連續戰鬥時最多每 1 秒一次。
    //   - 分頁沒顯示，或手機目前不在「背包」欄時，完全不碰隱藏 DOM；玩家切回時立即補一次。
    //   - tick 外的玩家主動操作維持立即 renderTabs，不增加點擊延遲。
    var TAB_COUNT_PATCH_MS = 250;
    var TAB_FULL_REBUILD_MS = 1000;
    var TAB_INVENTORY = { items: true, weapons: true, armors: true };
    var TAB_MANAGED = { items: true, weapons: true, armors: true, equip: true, skill: true };
    var _tabSnapshot = null;
    var _tabHiddenDirty = false;
    var _tabCountTimer = null;
    var _tabFullTimer = null;
    var _tabLastFullAt = 0;
    var _tabFlushing = false;
    var _tabRenderEpoch = 0;

    function noteForwardedTabRender() {
        _tabRenderEpoch++;
        if (window.__afkPsInventory) window.__afkPsInventory.renderEpoch = _tabRenderEpoch;
    }

    function activeManagedTab() {
        // 手機只有 mview-right 真正顯示背包欄；其他兩欄即使 tab 自己沒有 .hidden 也不可重繪。
        if (document.body && document.body.classList.contains('m-mobile') &&
            !document.body.classList.contains('mview-right')) return '';
        var ids = ['items', 'weapons', 'armors', 'equip', 'skill'];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById('tab-' + ids[i]);
            if (el && !el.classList.contains('hidden')) return ids[i];
        }
        return '';
    }

    function safeItemSig(item) {
        try { if (typeof itemSig === 'function') return itemSig(item); } catch (e) {}
        return [
            item && item.id, item && item.en, item && item.bless, item && item.anc,
            item && item.attr, item && item.seteff, item && item.element
        ].join('.');
    }

    // 對齊核心 renderTabs 的非數量顯示依賴：技能、等級或 buff 改變時，
    // 可裝備狀態、裝備欄與技能欄也必須重建，不能只更新物品數量角標。
    function tabContextSig() {
        if (typeof player === 'undefined' || !player) return '';
        var d = player.d || {};
        var statSum = ['str', 'dex', 'con', 'int', 'wis'].reduce(function (sum, key) {
            return sum + (Number(d[key]) || 0);
        }, 0);
        return [
            (player.skills || []).join(','), (player.grantedSkills || []).join(','),
            player.cls || '', player.lv || 0, player.elfEle || '', player.mastery || '',
            statSum, d.weightPct || 0, d.loadTier || 0,
            Math.round(d.magicDmg || 0), Math.round(d.mr || 0)
        ].join('#');
    }

    function inventoryTabFor(item) {
        var d = null;
        try {
            if (typeof DB !== 'undefined' && DB && DB.items && item) d = DB.items[item.id];
        } catch (e) {}
        if (!d) return 'items';
        if (d.type === 'wpn') return 'weapons';
        if (d.type === 'arm' || d.type === 'acc') return 'armors';
        return 'items';
    }

    function inventoryStructSigs() {
        var rows = { items: [], weapons: [], armors: [] };
        if (typeof player === 'undefined' || !player || !Array.isArray(player.inv)) {
            return { items: '', weapons: '', armors: '' };
        }
        player.inv.forEach(function (item) {
            rows[inventoryTabFor(item)].push([
                item && item.uid, safeItemSig(item),
                item && item.lock ? 1 : 0, item && item.junk ? 1 : 0
            ].join(':'));
        });
        var ctx = '#ctx=' + tabContextSig();
        return {
            items: rows.items.join(';') + ctx,
            weapons: rows.weapons.join(';') + ctx,
            armors: rows.armors.join(';') + ctx
        };
    }

    function equipmentStructSig() {
        if (typeof player === 'undefined' || !player || !player.eq) return '';
        var rows = Object.keys(player.eq).map(function (key) {
            var item = player.eq[key];
            return item ? key + ':' + (item.uid || '') + ':' + safeItemSig(item) : key + ':';
        }).join(';');
        return rows + '#ctx=' + tabContextSig();
    }

    function skillStructSig() {
        if (typeof player === 'undefined' || !player) return '';
        return tabContextSig();
    }

    function countMapFor(source) {
        var out = Object.create(null);
        if (typeof player === 'undefined' || !player) return out;
        if (source === 'inv') {
            (player.inv || []).forEach(function (item) {
                if (item && item.uid != null) out[String(item.uid)] = item;
            });
        } else {
            Object.keys(player.eq || {}).forEach(function (key) {
                var item = player.eq[key];
                if (item && item.uid != null) out[String(item.uid)] = item;
            });
        }
        return out;
    }

    function captureTabSnapshot() {
        if (typeof player === 'undefined' || !player || !player.cls) { _tabSnapshot = null; return; }
        var inv = inventoryStructSigs();
        _tabSnapshot = {
            items: inv.items,
            weapons: inv.weapons,
            armors: inv.armors,
            equip: equipmentStructSig(),
            skill: skillStructSig()
        };
        _tabHiddenDirty = false;
        _tabLastFullAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    function activeStructSig(tab) {
        if (TAB_INVENTORY[tab]) return inventoryStructSigs()[tab];
        if (tab === 'equip') return equipmentStructSig();
        if (tab === 'skill') return skillStructSig();
        return '';
    }

    function snapshotStructSig(tab) {
        if (!_tabSnapshot) return null;
        return Object.prototype.hasOwnProperty.call(_tabSnapshot, tab) ? _tabSnapshot[tab] : null;
    }

    function patchVisibleCounts(tab) {
        var root = document.getElementById('tab-' + tab);
        if (!root) return;
        var source = TAB_INVENTORY[tab] ? 'inv' : (tab === 'equip' ? 'eq' : '');
        if (!source) return;
        var items = countMapFor(source);
        var rows = root.querySelectorAll('.list-item[data-tip-uid][data-tip-src="' + source + '"]');
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var item = items[String(row.getAttribute('data-tip-uid'))];
            if (!item) continue; // 新增/刪除會由結構簽章排完整重建
            var box = row.querySelector('.classic-icon-box');
            if (!box) continue;
            var badge = box.querySelector('.classic-icon-corner-value.is-count');
            var count = Math.max(1, Number(item.cnt) || 1);
            var showCount = !(Number(item.en) > 0) && count > 1;
            if (!showCount) {
                if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
                continue;
            }
            var text = count.toLocaleString();
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'classic-icon-corner-value is-count';
                box.appendChild(badge);
            }
            if (badge.textContent !== text) badge.textContent = text;
        }
    }

    function clearTabTimers() {
        if (_tabCountTimer) { clearTimeout(_tabCountTimer); _tabCountTimer = null; }
        if (_tabFullTimer) { clearTimeout(_tabFullTimer); _tabFullTimer = null; }
    }

    function flushFullTabsNow() {
        if (_tabFlushing || typeof window.renderTabs !== 'function') return;
        clearTabTimers();
        _tabFlushing = true;
        try {
            // 走當下最外層 wrapper（例如後載入的 afk-itemsearch），本 wrapper 以 _tabFlushing 透明放行核心。
            window.renderTabs(true);
        } finally {
            _tabFlushing = false;
        }
    }

    function scheduleFullTabs() {
        if (_tabFullTimer) return;
        var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var wait = Math.max(0, TAB_FULL_REBUILD_MS - (now - _tabLastFullAt));
        _tabFullTimer = setTimeout(function () {
            _tabFullTimer = null;
            if (!activeManagedTab()) { _tabHiddenDirty = true; return; }
            flushFullTabsNow();
        }, wait);
    }

    function inspectAndPatchTabs() {
        _tabCountTimer = null;
        var tab = activeManagedTab();
        if (!tab) { _tabHiddenDirty = true; return; }
        _tabHiddenDirty = false;
        if (!_tabSnapshot) { flushFullTabsNow(); return; }
        var currentSig = activeStructSig(tab);
        var previousSig = snapshotStructSig(tab);
        if (currentSig !== previousSig) {
            // 等完整刷新前，舊列仍可先補最新數量；新列最多 1 秒後出現。
            patchVisibleCounts(tab);
            scheduleFullTabs();
            return;
        }
        patchVisibleCounts(tab);
    }

    function scheduleTabInspection() {
        if (_tabCountTimer) return;
        _tabCountTimer = setTimeout(inspectAndPatchTabs, TAB_COUNT_PATCH_MS);
    }

    function syncVisibleTabNow() {
        if (_tabCountTimer) { clearTimeout(_tabCountTimer); _tabCountTimer = null; }
        if (_tabFullTimer) { clearTimeout(_tabFullTimer); _tabFullTimer = null; }
        var tab = activeManagedTab();
        if (!tab) { _tabHiddenDirty = true; return; }
        _tabHiddenDirty = false;
        if (!_tabSnapshot || activeStructSig(tab) !== snapshotStructSig(tab)) {
            flushFullTabsNow();
            return;
        }
        // 分頁隱藏期間若只有堆疊數量變動，開啟時直接補角標，不必完整重建。
        patchVisibleCounts(tab);
    }

    if (typeof window.renderTabs === 'function' && !window.__afkPsInventory) {
        var _renderTabsOrig = window.renderTabs;
        var _renderTabsWrapped = function () {
            if (_tabFlushing) {
                var flushResult = _renderTabsOrig.apply(this, arguments);
                noteForwardedTabRender();
                captureTabSnapshot();
                return flushResult;
            }
            var inCombatTick = false;
            try { inCombatTick = typeof state !== 'undefined' && !!state.inTick; } catch (e) {}
            // force=true 是核心明確要求立即同步（例如自動販售後）；保留原語意。
            if (inCombatTick && arguments[0] !== true) {
                if (!activeManagedTab()) _tabHiddenDirty = true;
                else scheduleTabInspection();
                return;
            }
            // 玩家主動操作、載入角色、切換裝備等維持立即完整刷新。
            var result = _renderTabsOrig.apply(this, arguments);
            noteForwardedTabRender();
            captureTabSnapshot();
            return result;
        };
        _renderTabsWrapped.__afkPsInventory = true;
        window.renderTabs = _renderTabsWrapped;

        if (typeof window.switchTab === 'function' && !window.switchTab.__afkPsInventory) {
            var _switchTabOrig = window.switchTab;
            window.switchTab = function () {
                var result = _switchTabOrig.apply(this, arguments);
                var tab = arguments[0];
                if (TAB_MANAGED[tab]) syncVisibleTabNow();
                return result;
            };
            window.switchTab.__afkPsInventory = true;
        }

        // 手機底部「背包」只切 mview-right，不會呼叫 switchTab；於按鈕事件完成後補延遲內容。
        document.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('#m-nav .m-nav-btn[data-view="right"]') : null;
            if (btn) setTimeout(syncVisibleTabNow, 0);
        });

        window.__afkPsInventory = {
            version: '1.0.0',
            countPatchMs: TAB_COUNT_PATCH_MS,
            fullRebuildMs: TAB_FULL_REBUILD_MS,
            renderEpoch: _tabRenderEpoch
        };
    }

    // ── 首頁設定面板 ──
    window.AFK_SETTINGS = window.AFK_SETTINGS || { _items: [], add: function (it) { this._items.push(it); } };
    AFK_SETTINGS.add({ label: '🔋 省電模式', onClick: openPanel });
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function openPanel() {
        if (document.getElementById('afk-ps-overlay')) return;
        var ov = document.createElement('div');
        ov.id = 'afk-ps-overlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.66);display:flex;align-items:flex-start;justify-content:center;padding:calc(var(--orig-bar-h,0px) + 14px) 12px 12px;';
        if (window.AFK_TOGGLES && AFK_TOGGLES.applyBannerPad) AFK_TOGGLES.applyBannerPad(ov);   // 開啟當下實測橫幅高度覆寫 padding-top
        var opts = [
            { k: 'noanim', name: '關閉戰鬥動畫', desc: '怪物/玩家/傭兵/寵物/召喚的逐幀動畫停止（省 CPU；傷害/戰鬥數值不變）' },
            { k: 'lowfps', name: '降低畫面更新頻率', desc: '畫面更新節流到約 8fps（更省電；遊戲邏輯照跑，只是畫面較不即時）' }
        ];
        var rows = opts.map(function (o) {
            return '<label style="display:flex;align-items:center;gap:12px;padding:10px;border:1px solid #1e293b;border-radius:10px;margin-bottom:8px;cursor:pointer;background:#0b1222;">'
                + '<input type="checkbox" data-ps="' + o.k + '" ' + (on(o.k) ? 'checked' : '') + ' style="width:18px;height:18px;flex:none;accent-color:#22c55e;">'
                + '<span><span style="font-weight:600;">' + esc(o.name) + '</span><span style="display:block;font-size:11px;color:#94a3b8;margin-top:2px;">' + esc(o.desc) + '</span></span></label>';
        }).join('');
        var card = document.createElement('div');
        card.style.cssText = 'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;max-width:460px;width:100%;';
        card.innerHTML = '<div style="padding:16px 18px;border-bottom:1px solid #1e293b;"><div style="font-size:17px;font-weight:700;">🔋 省電模式</div>'
            + '<div style="font-size:12px;color:#94a3b8;margin-top:3px;">效果較弱/耗電的裝置可開啟；純畫面/效能設定，不影響任何遊戲數值。（「戰鬥特效」「傷害數字」在首頁開始前另有開關。）</div></div>'
            + '<div style="padding:12px 14px;">' + rows + '</div>'
            + '<div style="padding:12px 16px;border-top:1px solid #1e293b;text-align:right;"><button id="afk-ps-close" style="background:#0ea5e9;border:none;color:#04263a;font-weight:700;border-radius:8px;padding:8px 16px;cursor:pointer;">完成</button></div>';
        ov.appendChild(card); document.body.appendChild(ov);
        function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        card.querySelector('#afk-ps-close').addEventListener('click', close);
        card.querySelectorAll('input[data-ps]').forEach(function (cb) {
            cb.addEventListener('change', function () { set(cb.getAttribute('data-ps'), cb.checked); });
        });
    }

    try { console.log('[AFK-powersave] hooks OK — 省電模式（關動畫/降更新頻率/背包增量更新）已就緒。'); } catch (e) {}
})();
