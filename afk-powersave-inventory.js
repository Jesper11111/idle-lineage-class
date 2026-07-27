/**
 * afk-powersave-inventory.js — Jesper 本地背包增量更新。
 *
 * PP 會在同步時鏡像覆蓋 afk-powersave.js，因此把本站的重背包效能優化獨立保存：
 *   - 戰鬥 tick 的純數量變動只更新目前分頁的角標。
 *   - 新增、刪除、排序、強化、鎖定、裝備與技能變動最多每秒完整重建一次。
 *   - 自動整理仍立即排序資料，但不再用 force=true 重建手機看不到的五個分頁。
 *   - 隱藏分頁與手機非背包欄不重建，切回時立即同步。
 *   - tick 外操作與 force=true 維持核心的立即重建語意。
 *
 * 本檔雖在 PP afk-offline 前載入，但刻意等 DOMContentLoaded 才安裝，確保它包在
 * afk-itemsearch 等後載入 wrapper 的最外層；純數量更新因此不會觸發隱藏分頁搜尋掃描。
 */
(function () {
    'use strict';

    var TAB_COUNT_PATCH_MS = 250;
    var TAB_FULL_REBUILD_MS = 1000;
    var TAB_INVENTORY = { items: true, weapons: true, armors: true };
    var TAB_MANAGED = { items: true, weapons: true, armors: true, equip: true, skill: true };

    function install() {
        if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('powersave')) return;
        if (window.__afkPsInventory) return;
        if (typeof window.renderTabs !== 'function') {
            try { console.warn('[AFK-powersave-inventory] 找不到 renderTabs，背包增量更新停用。'); } catch (e) {}
            return;
        }

        var _tabSnapshot = null;
        var _tabCountTimer = null;
        var _tabFullTimer = null;
        var _tabLastFullAt = 0;
        var _tabFlushing = false;
        var _tabRenderEpoch = 0;
        var _autoSortDepth = 0;

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

        // 對齊核心 renderTabs 的非數量顯示依賴。技能、等級或能力變動時，
        // 可裝備狀態、裝備欄與技能欄必須完整重建，不能只更新物品數量。
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
            if (typeof player === 'undefined' || !player || !player.cls) {
                _tabSnapshot = null;
                return;
            }
            var inv = inventoryStructSigs();
            _tabSnapshot = {
                items: inv.items,
                weapons: inv.weapons,
                armors: inv.armors,
                equip: equipmentStructSig(),
                skill: skillStructSig()
            };
            _tabLastFullAt = (typeof performance !== 'undefined' && performance.now)
                ? performance.now() : Date.now();
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
                if (!item) continue; // 新增／刪除交給結構簽章排完整重建。
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
            if (_tabCountTimer) {
                clearTimeout(_tabCountTimer);
                _tabCountTimer = null;
            }
            if (_tabFullTimer) {
                clearTimeout(_tabFullTimer);
                _tabFullTimer = null;
            }
        }

        function flushFullTabsNow() {
            if (_tabFlushing || typeof window.renderTabs !== 'function') return;
            clearTabTimers();
            _tabFlushing = true;
            try {
                // 呼叫目前最外層 wrapper；本 wrapper 看到 _tabFlushing 後會透明放行一次。
                window.renderTabs(true);
            } finally {
                _tabFlushing = false;
            }
        }

        function scheduleFullTabs() {
            if (_tabFullTimer) return;
            var now = (typeof performance !== 'undefined' && performance.now)
                ? performance.now() : Date.now();
            var wait = Math.max(0, TAB_FULL_REBUILD_MS - (now - _tabLastFullAt));
            _tabFullTimer = setTimeout(function () {
                _tabFullTimer = null;
                if (!activeManagedTab()) return;
                flushFullTabsNow();
            }, wait);
        }

        function inspectAndPatchTabs() {
            _tabCountTimer = null;
            var tab = activeManagedTab();
            if (!tab) return;
            if (!_tabSnapshot) {
                flushFullTabsNow();
                return;
            }
            if (activeStructSig(tab) !== snapshotStructSig(tab)) {
                // 完整刷新前，既有列仍先補最新數量；新列最多一秒後出現。
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
            clearTabTimers();
            var tab = activeManagedTab();
            if (!tab) return;
            if (!_tabSnapshot || activeStructSig(tab) !== snapshotStructSig(tab)) {
                flushFullTabsNow();
                return;
            }
            patchVisibleCounts(tab);
        }

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
            // 核心 autoSortInventory 每 10 秒固定 renderTabs(true)，會繞過本外掛的戰鬥／隱藏欄保護。
            // 只有這個已知來源降級成延遲同步；其他 force=true（玩家操作、裝備、載入）仍立即放行。
            if (inCombatTick && arguments[0] === true && _autoSortDepth > 0) {
                if (activeManagedTab()) scheduleTabInspection();
                return;
            }
            // force=true 是核心明確要求立即同步，例如自動販售後；保留原語意。
            if (inCombatTick && arguments[0] !== true) {
                if (activeManagedTab()) scheduleTabInspection();
                return;
            }
            // 玩家操作、載入角色、切換裝備等維持立即完整刷新。
            var result = _renderTabsOrig.apply(this, arguments);
            noteForwardedTabRender();
            captureTabSnapshot();
            return result;
        };
        _renderTabsWrapped.__afkPsInventory = true;
        window.renderTabs = _renderTabsWrapped;

        if (typeof window.autoSortInventory === 'function' && !window.autoSortInventory.__afkPsInventory) {
            var _autoSortInventoryOrig = window.autoSortInventory;
            var _autoSortInventoryWrapped = function () {
                _autoSortDepth++;
                try {
                    return _autoSortInventoryOrig.apply(this, arguments);
                } finally {
                    _autoSortDepth--;
                }
            };
            _autoSortInventoryWrapped.__afkPsInventory = true;
            window.autoSortInventory = _autoSortInventoryWrapped;
        }

        if (typeof window.switchTab === 'function' && !window.switchTab.__afkPsInventory) {
            var _switchTabOrig = window.switchTab;
            window.switchTab = function () {
                var result = _switchTabOrig.apply(this, arguments);
                if (TAB_MANAGED[arguments[0]]) syncVisibleTabNow();
                return result;
            };
            window.switchTab.__afkPsInventory = true;
        }

        // 手機底部「背包」只切 mview-right，不會呼叫 switchTab。
        document.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest
                ? ev.target.closest('#m-nav .m-nav-btn[data-view="right"]') : null;
            if (btn) setTimeout(syncVisibleTabNow, 0);
        });

        window.__afkPsInventory = {
            version: '1.2.0-local',
            countPatchMs: TAB_COUNT_PATCH_MS,
            fullRebuildMs: TAB_FULL_REBUILD_MS,
            autoSortDeferred: true,
            renderEpoch: _tabRenderEpoch
        };
        // 測試頁或熱載入情境可能已完成首次 DOM 建立；有有效角色時立即建立基準快照。
        captureTabSnapshot();
        try {
            console.log('[AFK-powersave-inventory] hooks OK — 戰鬥背包採數量增量更新，結構變動延遲合併。');
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install, { once: true });
    } else {
        install();
    }
})();
