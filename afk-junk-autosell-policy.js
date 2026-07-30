/* ============================================================================
 * afk-junk-autosell-policy.js — Jesper 本地廢品標記／離線自動販賣安全層
 *
 * 保證：
 *   1. 單件廢品標記完成後立即存檔，避免 PWA 被系統直接關閉時遺失。
 *   2. 玩家明確記憶的 junkPrefs 優先於「每種保留 N 個」規則，規則不得反覆取消標記。
 *   3. 離線快速結算期間，以 state.ticks 推進剛產生廢品的等待時間。
 *
 * 本檔是本地政策檔，必須由 sync-upstream.mjs 保留並載於 PP afk-offline.js 前。
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.0.0-local';
  var required = ['toggleJunk', 'runQuickJunk', 'applyAutoSellRules', 'autoSellJunk', 'itemSig'];
  var missing = required.filter(function (name) { return typeof window[name] !== 'function'; });
  if (missing.length) {
    console.warn('[AFK-junk-autosell-policy] 核心掛點不存在，政策停用：' + missing.join(', '));
    return;
  }

  function inventory() {
    try { return player && Array.isArray(player.inv) ? player.inv : []; }
    catch (e) { return []; }
  }

  function findItem(uid) {
    return inventory().find(function (item) { return item && item.uid === uid; });
  }

  function isManualPreference(item) {
    try {
      return !!(item && player && player.junkPrefs && player.junkPrefs[itemSig(item)]);
    } catch (e) {
      return false;
    }
  }

  function validJunkSince(item) {
    var since = Number(item && item.junkSince);
    return Number.isFinite(since) && since > 0 ? since : null;
  }

  function prepareManualJunk(item, now) {
    if (!item) return;
    delete item._ruleJunk;
    delete item._autoSellQty;
    delete item._userKeep;
    if (validJunkSince(item) == null) item.junkSince = now;
  }

  function clearJunkTimer(item) {
    if (!item) return;
    delete item.junkSince;
    delete item._autoSellQty;
  }

  function persistRole() {
    try {
      if (player && player.cls && typeof saveGame === 'function') saveGame();
    } catch (error) {
      console.warn('[AFK-junk-autosell-policy] 廢品標記即時存檔失敗：', error);
    }
  }

  var coreToggleJunk = window.toggleJunk;
  function toggleJunkPolicy(uid) {
    var item = findItem(uid);
    var before = !!(item && item.junk);
    var def = item && typeof DB !== 'undefined' && DB.items ? DB.items[item.id] : null;
    if (item && !before && !item.lock && def && !def.noJunk) {
      prepareManualJunk(item, Date.now());
    }

    var result = coreToggleJunk.apply(this, arguments);
    item = findItem(uid);
    var after = !!(item && item.junk);
    if (item && after) {
      prepareManualJunk(item, Date.now());
    } else if (item && before !== after) {
      clearJunkTimer(item);
    }
    if (before !== after) persistRole();
    return result;
  }
  toggleJunkPolicy.__afkJunkAutosellPolicy = true;
  window.toggleJunk = toggleJunkPolicy;

  var coreRunQuickJunk = window.runQuickJunk;
  function runQuickJunkPolicy(type) {
    var now = Date.now();
    try {
      if (typeof _qjSync === 'function') _qjSync(type);
      var stateForType = typeof quickJunk !== 'undefined' && quickJunk ? quickJunk[type] : null;
      var eligible = typeof _qjEligibleItems === 'function' ? _qjEligibleItems(type) : [];
      eligible.forEach(function (item) {
        var want = !!(stateForType && stateForType.sel && stateForType.sel[item.uid]);
        if (want) prepareManualJunk(item, now);
        else if (item.junk) clearJunkTimer(item);
      });
    } catch (error) {
      console.warn('[AFK-junk-autosell-policy] 快速廢品前置整理失敗：', error);
    }
    return coreRunQuickJunk.apply(this, arguments);
  }
  runQuickJunkPolicy.__afkJunkAutosellPolicy = true;
  window.runQuickJunk = runQuickJunkPolicy;

  var coreApplyAutoSellRules = window.applyAutoSellRules;
  function applyAutoSellRulesPolicy() {
    var result = coreApplyAutoSellRules.apply(this, arguments);
    var now = Date.now();
    inventory().forEach(function (item) {
      if (!item || item.lock || !isManualPreference(item)) return;
      var def = typeof DB !== 'undefined' && DB.items ? DB.items[item.id] : null;
      if (!def || def.noJunk || def.noSell) return;
      item.junk = true;
      prepareManualJunk(item, now);
    });
    return result;
  }
  applyAutoSellRulesPolicy.__afkJunkAutosellPolicy = true;
  window.applyAutoSellRules = applyAutoSellRulesPolicy;

  var virtualAges = new Map();
  var virtualRole = '';

  function roleKey() {
    try {
      return String(typeof currentSlot === 'undefined' ? '' : currentSlot) + '|' +
        String(player && (player.enSeed || player.name || player.cls) || '');
    } catch (e) {
      return '';
    }
  }

  function catchingUp() {
    try {
      return !!(window.__afk && typeof window.__afk.isCatchingUp === 'function' &&
        window.__afk.isCatchingUp());
    } catch (e) {
      return false;
    }
  }

  function tickMs() {
    try {
      return Number.isFinite(Number(TICK_MS)) && Number(TICK_MS) > 0 ? Number(TICK_MS) : 100;
    } catch (e) {
      return 100;
    }
  }

  function advanceVirtualJunkAges() {
    var key = roleKey();
    if (key !== virtualRole) {
      virtualAges.clear();
      virtualRole = key;
    }
    var now = Date.now();
    var tick = Number(typeof state === 'undefined' || !state ? 0 : state.ticks) || 0;
    inventory().forEach(function (item) {
      if (!item || !item.junk || !item.uid) return;
      var record = virtualAges.get(item.uid);
      if (!record) {
        var since = validJunkSince(item);
        record = {
          ageMs: since == null ? 0 : Math.max(0, now - since),
          lastTick: tick
        };
      } else {
        record.ageMs += Math.max(0, tick - record.lastTick) * tickMs();
        record.lastTick = tick;
      }
      item.junkSince = now - record.ageMs;
      virtualAges.set(item.uid, record);
    });
  }

  function reconcileVirtualJunkAges() {
    var now = Date.now();
    var tick = Number(typeof state === 'undefined' || !state ? 0 : state.ticks) || 0;
    var alive = new Set();
    inventory().forEach(function (item) {
      if (!item || !item.junk || !item.uid) return;
      alive.add(item.uid);
      if (!virtualAges.has(item.uid)) {
        var since = validJunkSince(item);
        virtualAges.set(item.uid, {
          ageMs: since == null ? 0 : Math.max(0, now - since),
          lastTick: tick
        });
      }
    });
    Array.from(virtualAges.keys()).forEach(function (uid) {
      if (!alive.has(uid)) virtualAges.delete(uid);
    });
  }

  var coreAutoSellJunk = window.autoSellJunk;
  function autoSellJunkPolicy(manual) {
    var virtual = !manual && catchingUp();
    if (virtual) advanceVirtualJunkAges();
    else {
      virtualAges.clear();
      virtualRole = roleKey();
    }
    var result = coreAutoSellJunk.apply(this, arguments);
    if (virtual) reconcileVirtualJunkAges();
    return result;
  }
  autoSellJunkPolicy.__afkJunkAutosellPolicy = true;
  window.autoSellJunk = autoSellJunkPolicy;

  window.AFK_JUNK_AUTOSELL_POLICY = Object.freeze({
    version: VERSION,
    installed: true,
    immediatePersistence: true,
    manualPreferenceWins: true,
    offlineVirtualGrace: true
  });
  console.log('[AFK-junk-autosell-policy] hooks OK — 廢品即時存檔／手動意圖／離線等待時間已接管。');
})();
