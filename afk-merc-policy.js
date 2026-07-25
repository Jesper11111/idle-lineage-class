/*
 * afk-merc-policy.js — 在 PP 最新版上保留 v3.7.61 的傭兵獎勵／招募／受僱政策，另採回城免費刷新。
 *
 * 戰鬥本體仍使用 PP 最新核心（威脅值、綁定、城堡護衛等照常作用）。
 * 這裡只覆寫政策層：
 *   - 招募維持收費
 *   - 回村免費自動結算累積經驗並刷新戰力快照
 *   - 不建立反向受僱登記、不限制同一角色只能受僱一次、不鎖安全區
 * 經驗均分、金幣與掉落倍率在核心 js/05 由 apply-policy-patches.mjs 固定。
 */
(function () {
  'use strict';

  function emptyEmploymentMap() { return Object.create(null); }
  function noEmployer() { return null; }
  function noBattleBlock() { return false; }
  function noRegistryWrite() { return true; }
  function allowAllMercElementSkills() { return true; }

  function allyCostLegacy(slotN) {
    var sum = slotSummary(slotN);
    return sum ? (sum.lv || 1) * 10000 : 0;
  }

  function mercRehireMultPolicy() { return 0; }
  function mercRehireCostPolicy() { return 0; }

  function mercBankAlliesAtTownLegacy() {
    try {
      var settled = 0;
      ((player && player.allies) || []).forEach(function (ally) {
        var msg = _settleAllyExp(ally, 'town');
        if (msg) { logSys(msg); settled++; }
      });
      if (settled > 0) {
        try { saveGame(); } catch (e) {}
      }
      return settled;
    } catch (e) { return 0; }
  }

  // 相容舊存檔或殘留 UI 的手動呼叫；與回城自動刷新共用核心單名刷新，永遠不收費。
  function rehireAllyPolicy(slotN) {
    slotN = String(slotN);
    var cur = (player.allies || []).find(function (a) { return a && a._slot === slotN; });
    if (!cur) return;
    var result = refreshAllyOnce(slotN);
    if (result && result.msg) logSys(result.msg);
    if (result && result.kind === 'refresh') {
      logSys('<span class="text-sky-300">' + (cur._allyName || ('存檔 ' + slotN)) +
        ' 的戰力快照已免費更新。</span>');
    }
    saveGame(); updateUI();
    var panel = document.getElementById('interaction-content');
    if (panel) renderAllyNPC(panel);
  }

  function toggleAllyLegacy(slotN) {
    slotN = String(slotN);
    if (!player.allies) player.allies = [];
    if (isAllyActive(slotN)) {
      var dismissed = player.allies.find(function (a) { return a && a._slot === slotN; });
      if (dismissed) snapshotMercPrefs(dismissed);
      var expMsg = dismissed ? _settleAllyExp(dismissed, 'dismiss') : '';
      player.allies = player.allies.filter(function (a) { return a && a._slot !== slotN; });
      logSys('協力傭兵（存檔 ' + slotN + '）已解散（招募費用不退還）。' + expMsg);
    } else {
      var cap = allyActiveCap();
      if ((player.allies.length || 0) >= cap) {
        logSys('<span class="text-red-400">協力傭兵最多同時上場 ' + cap + ' 名，請先解除一名再招募。</span>');
        saveGame(); updateUI();
        var capPanel = document.getElementById('interaction-content');
        if (capPanel) renderAllyNPC(capPanel);
        return;
      }
      var sum = slotSummary(slotN);
      if (!sum) {
        logSys('<span class="text-red-400">存檔 ' + slotN + ' 沒有可用的角色。</span>');
      } else if (!!sum.classic !== !!player.classicMode) {
        logSys('<span class="text-red-400">只能招募與本角色「相同模式（一般／經典）」的存檔傭兵。</span>');
      } else if (typeof antharasHelperSlots === 'function' && antharasHelperSlots().includes(slotN)) {
        logSys('<span class="text-red-400">' + sum.name +
          ' 目前擔任侵蝕的安塔瑞斯巢穴助戰者，無法招募；請先到威頓村找多魯嘉貝爾解除助戰。</span>');
      } else {
        var cost = allyCostLegacy(slotN);
        if ((player.gold || 0) < cost) {
          logSys('<span class="text-red-400">招募 ' + sum.name + '（Lv.' + sum.lv + '）需要 ' +
            cost.toLocaleString() + ' 金幣，你的金幣不足。</span>');
        } else {
          var ally = buildAlly(slotN);
          if (!ally) {
            logSys('<span class="text-red-400">存檔 ' + slotN + ' 沒有可用的角色。</span>');
          } else {
            player.gold -= cost;
            player.allies.push(ally);
            logSys('<span class="text-emerald-300 font-bold">花費 ' + cost.toLocaleString() + ' 金幣招募 ' +
              ally._allyName + '（存檔 ' + slotN + '，Lv.' + sum.lv + '）加入作戰！</span>');
          }
        }
      }
    }
    saveGame(); updateUI();
    var panel = document.getElementById('interaction-content');
    if (panel) renderAllyNPC(panel);
  }

  function dismissAllyLegacy(slotN) {
    slotN = String(slotN);
    var ally = (player.allies || []).find(function (a) { return a && String(a._slot) === slotN; });
    if (!ally) {
      logSys('<span class="text-slate-400">存檔 ' + slotN + ' 的協力傭兵目前不在隊伍中。</span>');
      var missingPanel = document.getElementById('interaction-content');
      if (missingPanel) renderAllyNPC(missingPanel);
      return;
    }
    var name = ally._allyName || ('存檔 ' + slotN);
    if (!confirm('確定要解散協力傭兵「' + name +
      '」嗎？\n（招募費用不退還，累積經驗會記入待領帳本，該角色下次載入或回村時領取）')) return;
    toggleAllyLegacy(slotN);
  }

  function renderAllyNPCLegacy(div) {
    var activeCap = allyActiveCap();
    var royalCha = Math.max(0, Math.floor((player.d && player.d.cha) || 0));
    var capHint = player.cls === 'royal'
      ? '<br><span class="text-amber-300">王族魅力不影響傭兵能力；每滿 15 點魅力可多帶 1 名。目前魅力 ' +
        royalCha + '，可同時帶 ' + activeCap + '/7 名。</span>'
      : '<br><span class="text-slate-400">目前可同時帶 ' + activeCap + ' 名傭兵。</span>';

    var rows = allySlotList().map(function (n) {
      var sum = slotSummary(n);
      var active = isAllyActive(n);
      if (!sum) return '<div class="w-full text-left py-2 px-3 text-sm bg-slate-900/60 border border-slate-700 rounded opacity-60">' +
        '存檔 ' + n + '：<span class="text-slate-500">（空）</span></div>';
      var classic = !!sum.classic;
      var modeMatch = classic === !!player.classicMode;
      var tag = classic ? '<span style="color:#fbbf24;font-weight:bold;">⚔經典</span> ' : '';
      var nameStyle = classic ? 'style="color:#fbbf24;"' : 'class="text-amber-300"';
      var button = active
        ? '<div class="flex flex-wrap justify-end gap-1.5 shrink-0">' +
            '<button onclick="dismissAlly(\'' + n + '\')" class="btn py-1 px-3 text-sm font-bold bg-red-950 border-red-700 text-red-200" ' +
              'title="只解散這名協力傭兵（招募費用不退還）">解散</button></div>'
        : (modeMatch
          ? '<button onclick="toggleAlly(\'' + n + '\')" class="btn py-1 px-4 text-sm font-bold bg-emerald-900 border-emerald-700 text-emerald-200">' +
            '召喚　' + allyCostLegacy(n).toLocaleString() + '金</button>'
          : '<span class="text-xs text-slate-500 px-2 text-right">非同模式存檔<br>不可招募</span>');
      var resource = '';
      if (active) {
        var live = (player.allies || []).find(function (a) { return a && String(a._slot) === String(n); });
        if (live) {
          if (live.cls === 'dragon') resource = '　<span class="text-rose-300 font-bold">HP ' +
            Math.max(0, Math.floor(live.curHp || 0)) + '/' + Math.floor(live.mhp || 0) + '</span>';
          else if (live.cls !== 'knight' && live.cls !== 'warrior') resource =
            '　<span class="text-sky-300 font-bold">MP ' + Math.max(0, Math.floor(live.mp || 0)) + '/' +
            Math.floor(live.mmp || 0) + '</span>';
        }
      }
      return '<div class="flex items-center justify-between gap-2 bg-slate-800/60 border ' +
        (classic ? 'border-amber-600/70' : 'border-slate-600') + ' rounded p-3 text-sm">' +
        '<span>' + tag + '存檔 ' + n + '：<b ' + nameStyle + '>' + sum.cls + ' Lv.' + sum.lv +
        '</b>　' + sum.name + resource + '</span>' + button + '</div>';
    }).join('');

    div.innerHTML = '<div class="flex flex-col gap-3 p-1">' +
      '<div class="text-slate-300 text-sm leading-relaxed">招募其他存檔位的角色一起作戰，' +
      '<b class="text-amber-300">費用＝該角色等級 × 10000 金幣</b>。協力傭兵戰鬥中不會陣亡，' +
      '<b class="text-emerald-300">你死亡並回城／原地復活後仍會留在身邊，可使用「解散」或「⚠ 全員退出」（費用不退還）</b>；' +
      '存讀檔不會使其消失。' + capHint +
      '<br><span class="text-slate-400">每次進入安全區（含載入存檔回到村莊）都會免費結算累積經驗，' +
      '並依來源存檔的最新狀態自動重建戰力快照，不需要重新招募。</span></div>' +
      '<div class="flex items-center justify-between gap-2"><div class="text-sm">你的金幣：' +
      '<span class="text-yellow-400 font-bold">' + (player.gold || 0).toLocaleString() + '</span></div>' +
      ((player.allies || []).length
        ? '<button onclick="dismissAllAllies()" class="btn py-1 px-3 text-xs font-bold bg-red-950 border-red-700 text-red-200">' +
          '⚠ 全員退出（' + player.allies.length + '）</button>'
        : '') + '</div>' + rows + '</div>';
  }

  // 受僱登記與安全區限制全部停用；原函式保留在官方核心中，僅由此政策層覆寫入口。
  window.syncMercenaryEmploymentRegistry = noRegistryWrite;
  window.currentRoleMercenaryEmployer = noEmployer;
  window.currentRoleIsMercenary = noBattleBlock;
  window.mercRoleSafeAreaOnly = noBattleBlock;
  window.mercEmployerOfSlot = noEmployer;
  window.mercEmploymentMap = emptyEmploymentMap;
  window.mercSlotHiredByOther = noEmployer;
  window.mercClaimLosesTo = noBattleBlock;
  window.mercenaryRoleNotifySafeAreaOnly = noBattleBlock;
  window.mercenaryRoleBattleBlocked = noBattleBlock;
  window.enforceMercenarySafeArea = noBattleBlock;
  // 使用者指定不跟進 v3.8.5 妖精傭兵屬性閘：已學技能不因目前 elfEle 不符而隱藏或停用。
  window.allySkillElementOk = allowAllMercElementSkills;

  window.allyCost = allyCostLegacy;
  window.mercRehireMult = mercRehireMultPolicy;
  window.mercRehireCost = mercRehireCostPolicy;
  window.mercBankAlliesAtTown = mercBankAlliesAtTownLegacy;
  // refreshAllAllies 保留 PP 核心單一掛點：changeMap 進安全區時結算並重建快照。
  window.rehireAlly = rehireAllyPolicy;
  window.toggleAlly = toggleAllyLegacy;
  window.dismissAlly = dismissAllyLegacy;
  window.renderAllyNPC = renderAllyNPCLegacy;

  window.__legacyMercPolicy = Object.freeze({
    version: '3.7.61-hybrid-town-refresh-on-pp-v3.8.5',
    rewardShare: true,
    paidRecruit: true,
    paidManualRehire: false,
    townRefresh: true,
    exclusiveEmployment: false,
    safeAreaLock: false,
    elementRestriction: false
  });
  console.log('[AFK-merc-policy] hooks OK — 保留舊版傭兵獎勵／受僱規則，回城免費更新快照。');
})();
