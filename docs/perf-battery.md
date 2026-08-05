# 手機耗電/發熱：效能熱點盤點（2026-08-05）

> **一句話結論：耗電來源分三塊——①切到背景後遊戲仍全速模擬（上游刻意設計）、②前景每 0.1 秒的無差別 DOM 全量重寫、③大量常駐 CSS 濾鏡/混合模式讓 GPU 每幀重算。外掛層另有一批「便宜但永不停」的輪詢與熱路徑 localStorage 讀取疊在上面。**
>
> 本文是靜態掃描結果（核心 `js/*.js`＋外掛 65 支＋`css/`），嚴重度是「頻率 × 單次工作量 × 背景是否照跑」的推估；**除省電模式的選項已實測（見「實測結果」節）外，其餘未經 profiler 量測**。要動手前先看文末「量測與驗證」。

---

## 現有省電機制與缺口

| 已有的 | 位置 | 缺口 |
|---|---|---|
| 省電模式面板七開關（關動畫/關光暈濾鏡/關特效/降更新頻率/關傷害數字/關音樂/關音效） | `afk-powersave.js` | 全部**預設關**；實測（見「實測結果」節）**降更新頻率與關傷害數字省不到電**，真正有效的是關動畫／光暈濾鏡／特效。`renderStatusEffects` 走 `js/03:699` 直呼、不經 `updateUI`，**不受 lowfps 管** |
| sprite ticker 的 `document.hidden` 守衛 | `js/09:2461`、`js/27:2012` | 整個核心**只有 3 處**；寵物 ticker（`js/22:1501`）、城鎮 NPC ticker（`js/11:2348`）、BGM 輪詢（`js/17:689`）、2 秒 session 心跳（`js/13:434`）都沒有 |
| `prefers-reduced-motion` | `css/style.css:454-457` | 只覆蓋 2 條動畫；其餘 24 條 infinite 動畫不受保護 |
| 外掛層 | — | 65 支裡**沒有任何一支**在分頁隱藏時停下自己的 setInterval |

---

## 一、背景耗電（切出去/鎖屏還在燒）

| # | 熱點 | 位置 | 事實 | 嚴重度 |
|---|---|---|---|---|
| A1 | **背景全速心跳 Worker** | `js/01-drops-config.js:1419-1437` | 上游 v3.7.33 刻意用 Web Worker 每秒喚醒主執行緒跑 `gameLoop()`，繞過瀏覽器背景節流——切分頁/縮小視窗/鎖屏後**戰鬥模擬完整照跑不停**。這是「背景掛機」功能本體，不能直接拔，但正是手機切出去還發熱的第一主因 | **高** |
| A2 | 回前景差額補跑 | `js/03-combat-core.js:344-346,417-420` | `FF_BUDGET_MS=80`／`FF_YIELD_MS=8` ≈ **91% duty cycle** 直到債務清空；長時間背景後回前景會滿載數秒～數十秒（發熱最明顯的時刻） | 高 |
| A3 | BGM 常駐 loop 播放 | `js/17-audio.js:663` | `HTMLAudioElement` loop 播放，**無 hidden 暫停**——切背景仍持續解碼音訊 | 中～高 |
| A4 | 外掛層輪詢背景照跑 | 見「四」 | battlehud 300ms 鏡射、toggles 1s 版面量測、mobile 1.5s navTick…全無 hidden 守衛（只吃瀏覽器節流） | 中 |
| A5 | 2 秒 session 心跳 | `js/13-shop-save.js:434,404-413` | 每 2 秒 localStorage 讀＋`JSON.stringify`＋寫，無 hidden 守衛 | 中 |

> 註：背景期間 tick 走 ff/補跑路徑會跳過大部分 per-tick DOM（`js/03:696` 的 `if(!state.ff)`），所以背景燒的主要是**純模擬 CPU**＋音訊解碼，不是渲染。⚠️ 未逐行驗證背景路徑每一段都吃到 ff 旗標。

## 二、前景 CPU 熱點（核心）

| # | 熱點 | 位置 | 事實 | 嚴重度 |
|---|---|---|---|---|
| B1 | 主 tick 10Hz、前景無任何降級 | `js/01:1356`（`setInterval(gameLoop,100)`）、`js/03:587` | 每 tick：全狀態遞減、自動施法、主副手攻擊、5 隻怪 AI、傭兵/寵物/召喚行動、出怪排程…（這是遊戲邏輯本體，動它=改遊戲） | 基準 |
| B2 | **每 tick 無條件重寫狀態列** | `js/03:696-700` | `innerText`/`className` 每 tick 重設（同值的 `innerText` 賦值也會換掉 text node → layout 失效），再無條件呼叫 `renderStatusEffects()` | **高** |
| B3 | **`renderStatusEffects` 全量 innerHTML** | `js/08-items-equip.js:1301-1393` | 每 tick 1～2 次：遍歷全部 buffs＋約 100 條技能表→組字串→`innerHTML`，**內容沒變也照做**；最多 20 次/秒 | **高** |
| B4 | **`_updateUIImpl` 全狀態欄重寫** | `js/08:1395-1553` | 每 tick 最多一次：50+ 個 `getElementById`＋`innerText` 寫入，無「值有變才寫」守衛；含 **5 次全文件掃描**（`js/08:1502-1504` 的 `[data-grp=…]` ×3、`js/08:1540-1541` 的 `.alloc-±` ×2）與 2 處背景圖每次重設（`js/08:1447,1423→js/13:108-134`） | **高** |
| B5 | 怪物列每 tick 組字串重建 | `js/09:1234-1370` | 每 tick 為 5 格各組完整 HTML 再字串比對；HP 條寬度每次掉血必變 → 每 tick 至少 1 格 `outerHTML` 整棵重建（3~5 張 `<img>` 重生） | **高** |
| B6 | **戰鬥日誌每則強制 reflow** | `js/01:1848-1852,1889-1893` | 每則訊息 `insertAdjacentHTML` → 裁剪 → **`scrollTop = scrollHeight`**（同步強制 layout）；掛機約每秒 5~20 則 | **高** |
| B7 | 刷王每 5 秒全量存檔 | `js/05:596`＋`js/13:1498-1555`＋`js/00:162-179` | 頭目擊殺即 `saveGame()`；BOSS 房重生 5 秒 → 最快 5 秒一次「整包 stringify＋兩次逐字元簽章＋**2 次 localStorage 寫**（先明文後壓縮）」 | 高 |
| B8 | 8fps sprite ticker 的 layout 讀取 | `js/09:2461`（`_classFacing8` 於 `js/09:1781` 等 35 處 `getBoundingClientRect`）、`js/22:1410,1432` | 每 125ms ×（怪＋傭兵＋玩家＋寵物）強制 layout，與同 tick style 寫入交錯 → layout thrashing | 中～高 |
| B9 | 3 個永不停止的 rAF 空轉 | `index.html:148-158`、`js/13:1008-1030`、`js/13:1116-1129` | 登入頁/選角/創角動畫的 `requestAnimationFrame` 迴圈**無停止條件**——進遊戲後仍每幀跑（僅做 2 次 getElementById 就返回，但讓瀏覽器永遠不能進入靜止狀態） | 中 |
| B10 | 黑市每秒全文件掃描 | `js/24:1975→1816-1821` | 每秒 `document.querySelectorAll('.pandora-relic-cd[data-until]')`，不看面板是否開著，99% 時間結果是空的 | 中 |
| B11 | 500ms 面板簽章輪詢 ×2 | `js/23:785`、`js/31:368` | 簽章含 HP 5% 階 → 戰鬥中常常真的整區 `innerHTML` 重建（`js/10:2613`） | 中 |

## 三、前景 GPU/渲染熱點（CSS 為主）

| # | 熱點 | 位置 | 事實 | 嚴重度 |
|---|---|---|---|---|
| C1 | **全遊戲每張 `<img>` 常駐濾鏡** | `css/style.css:969` | `#game-screen img,… { filter: contrast(1.06) saturate(1.05) }`——場上 5 隻怪 ×4 層 sprite、玩家/傭兵/寵物 sprite、背包數十顆圖示全部各成一個 filter 層；任一張 8fps 換 src 就重跑一次 | **高** |
| C2 | 鎖定怪紅光暈疊在 8fps sprite 上 | `css/style.css:462-463` | `drop-shadow ×2` 套在每 125ms 換 src 的容器 → 每幀重算 alpha 模糊；掛機時 100% 時間在跑 | **高** |
| C3 | sprite 混合模式 | `css/style.css:538,541`（另 524/529/536） | 影子 `multiply`＋武器 `screen`——元素無法獨立快取，每幀與區域背景大圖重新混合 | **高** |
| C4 | 頭目狂暴三層動畫 | `css/style.css:933-950` | 本體 `drop-shadow ×2` 呼吸＋氣焰 **blur 半徑在動**＋`mix-blend-mode:screen`＋地面環 box-shadow；HP 低於門檻後持續到死 | **高**（刷王時） |
| C5 | **HP/MP/EXP 條 `transition:width`** | `css/style.css:597`＋`js/08:1455-1469` | 寬度每 100ms 進新值 → transition 永遠在跑、永不收斂，width 不可合成=每幀 layout+paint；手機常駐置頂細條（`index.html:167-168`）同病 | **高** |
| C6 | 背包/裝備光暈動畫群 | `css/style.css:356-450,681-836`（套用點 `js/08:373 getGlowClass`） | 十幾種 `drop-shadow`/`text-shadow` infinite 動畫，套在**每一顆**符合詞綴的物品圖示上；最貴的 `.tri-glow`（`:830`）單元素 5 層 filter 四色循環 | 高（背包/裝備頁開著時） |
| C7 | 日誌 inline 色字濾鏡 | `css/style.css:710` | `[style*="color:"]` 屬性子字串選擇器＋`filter`——最多 150 個獨立 filter span，清單每秒被插入/裁剪/捲動數次 | 高 |
| C8 | 粒子系統無硬上限＋全員 `will-change` | `js/09:596-645`（上限群 `js/09:170,365,556,578,593,698`）＋`css/style.css:851-960` | 每次命中 5~13 個 DOM 元素（傷害數字＋濺血 4~12 顆 WAAPI），軟上限 220；每個 `will-change` → 各自強制升合成層 | **高** |
| C9 | 投射物 rAF 用 `left/top` 位移 | `js/09:238-250` | 每幀寫 `style.left/top` → 每幀 layout+paint，完全放棄合成器 | 高（施法型職業） |
| C10 | modal 的 backdrop blur | `css/style.css:2312-2318`、`index.html:473-520` | 開收集冊等 modal 時全螢幕即時模糊，而底下戰鬥畫面仍 8fps 換幀 → 整片模糊每幀重算 | 高（modal 開著時） |
| C11 | 外掛注入動畫 | `afk-skin.js:112-118`（跑馬燈＋mask）、`afk-syncinfo.js:39-40`（漸層文字）、`afk-dograce.js:17`（脈動球） | 常駐首頁/大廳，transform 便宜但圖層永遠 active | 中 |
| C12 | 唯一 GIF：城主皇冠 | `assets/ui/castle-crown.gif`＋`css/style.css:530-535,2787-2797` | GIF 自動循環無法由 JS 停止，且每處都疊 `drop-shadow ×2` | 中 |

## 四、外掛層常駐成本（我們自己的，全部可自由改）

| # | 熱點 | 位置 | 事實 | 嚴重度 |
|---|---|---|---|---|
| D1 | **`AFK_TOGGLES.enabled()` 無快取** | `afk-toggles.js:38-44` | 每次呼叫 `localStorage.getItem`（有 parent 還遞迴再讀一次）；被 powersave/trackinfo/dollcursor/relicguard/anyclass/lzcache 掛在熱路徑上 | **高**（樞紐） |
| D2 | **`afk-powersave` 的 `on()` 無快取** | `afk-powersave.js:15,20-46` | 包了 4 支 sprite 函式＋`updateUI`/`renderMobs`，每次都讀 LS → **六個選項全關也每秒 40~60 次同步 localStorage 讀** | **高**（省電外掛自己在耗電，最諷刺的一條） |
| D3 | **`afk-itemsearch` 每次 renderTabs 全掃** | `afk-itemsearch.js:80-90,42-48` | 核心 `renderTabs` 有簽章短路（`js/10:173`），但 wrapper 在 `apply` 之後**無條件** `filterAll()`；空關鍵字也對每列 `style.removeProperty`——每次射箭/擊殺都來一輪，大背包=幾千次 style 操作 | **高** |
| D4 | battlehud 300ms 鏡射 | `afk-battlehud.js:34,334` | 每輪約 12 次 `getElementById`＋讀寫 ≈ **37 次/秒**，不分頁面狀態全程跑；另 `:330` 每秒 `placeStrip`（含 getBoundingClientRect）、`:356` ResizeObserver 寫 root 自訂屬性（全文件樣式失效），觀察對象 `#game-screen` 高度隨日誌一直變 | 高 |
| D5 | toggles 每秒版面量測 | `afk-toggles.js:242,281` | 每秒 `getComputedStyle`＋`getBoundingClientRect`＋**無條件寫** `btn.style.top` = 每秒一次 forced layout | 中 |
| D6 | mobile navTick 1.5s | `afk-mobile.js:469,505` | matchMedia＋UA regex＋querySelectorAll 迴圈＋getBoundingClientRect＋root 自訂屬性寫入 | 中 |
| D7 | bossring/bossavoid 常駐輪詢 | `afk-bossring.js:100,177`、`afk-bossavoid.js:298` | 1~1.5 秒查表/爬 DOM/配新陣列（GC churn） | 中 |
| D8 | lzcache 每命中重 parse | `afk-lzcache.js:144-172` | 快取命中仍 `JSON.parse` 整份血盟（68KB~830KB）＋用超長字串當 Map key（每次 hash）——**刻意設計**（防 mutator 汙染，見檔內 `:135-139`），省下的仍遠多於花的，但常駐成本存在 | 中 |
| D9 | traditional 每個掉落讀 LS | `afk-traditional.js:52-56,61-63` | `gainItem` 熱路徑上每次 `localStorage.getItem`，無快取 | 中 |
| D10 | trackinfo/battlebuffs 每 tick | `afk-trackinfo.js:70-77`、`afk-battlebuffs.js:94-100` | 包 `renderStatusEffects`（10~20 次/秒）：前者追蹤中每 tick createElement＋regex；後者每 tick 把整個狀態欄 `innerHTML` 序列化成字串比對 | 中 |
| D11 | warehouse 捲動監聽無早退 | `afk-warehouse.js:233,133` | document capture scroll、未標 passive、每次**無條件** DOM 寫（對照 `afk-touchtip.js:202-206` 有旗標早退） | 中 |
| D12 | offline 5 秒 stamp | `afk-offline.js:38,118-137,1524` | 每 5 秒 2 寫＋2 刪 localStorage（用途是離線結算的「最後在線」戳記，**動之前先讀 `docs/offline.md`**） | 中 |
| D13 | dograce 圓球 60fps rAF | `afk-dograce.js:768-790` | 開著小圓球時 60fps 迴圈只為更新每秒才變一次的倒數字 | 中（主動開啟才付） |
| D14 | 低頻但永不停的雜項 | `afk-invlist.js:71`（3s no-op）、`afk-quotawarn.js:74`（1s）、`afk-mobile.js:492-499`（touchmove 寫 scrollTop） | 單支便宜，疊起來讓瀏覽器永遠有事做 | 低 |

其餘約 28 支外掛（allyslim/attrbatch/cursebatch/dex/fullsave/locksafe/mapbar/ui/wiki…）**無常駐成本**（純 CSS、純資料、或只在 modal/冷路徑動作）。

---

## 改進方案（依「效果÷風險」排序）

架構鐵則不變：核心不手改，外掛 monkey-patch 首選、錨點補丁最後手段。

### 第一批：純外掛修正，不改任何行為（✅ 已全部實作，2026-08-05）

1. **`AFK_TOGGLES.enabled()` 加記憶體快取**（治 D1，連帶治 D2/D9 的一半）
   `set()` 時失效對應 id＋其子項即可；`register()` 時預填。開關本來就只透過 `set()` 改，快取不會過期。一次修掉每秒幾十次同步 LS 讀。
2. **`afk-powersave` 的 `on()` 加快取**（治 D2）：同一招，面板 change 事件時更新。
3. **`afk-itemsearch` 空關鍵字直接返回**（治 D3）：`filterAll()` 開頭 `if (!kw && !_wasFiltering) return;`——絕大多數玩家沒在搜尋，每次攻擊省掉整輪 style 掃描。進一步可比對核心的 `renderTabs._sig` 判斷這次是否真的重繪了。
4. **外掛輪詢加 `document.hidden` 早退**（治 A4/D4~D7/D14）：battlehud mirror/placeStrip、toggles syncEntryVisibility、mobile navTick、bossring、bossavoid、invlist、quotawarn 各加一行 `if (document.hidden) return;`。畫面看不到，鏡射/對位/注入檢查全是白做。⚠️ offline 的 stamp（D12）**不在此列**——它是離線結算的戳記，動之前先讀 `docs/offline.md`。
5. **`afk-warehouse` 捲動 handler 加旗標早退＋passive**（治 D11）：照 `afk-touchtip.js:202` 的既有寫法。
6. **`afk-traditional` 的 `isOn()` 加快取**（治 D9）：per-slot 快取，換角色時失效（對照組 `afk-bossring.js:34-41` 已有現成模式）。
7. **`afk-dograce` 圓球模式改 1 秒 setInterval**（治 D13）：倒數字每秒才變，不需要 60fps。

### 第二批：省電模式擴充（玩家自選，預設關，不動預設外觀）

8. **新選項「關閉光暈與濾鏡特效」**（✅ 已實作，2026-08-05）（治 C1/C2/C6/C7，另涵蓋 C4 的 drop-shadow/blur 兩層與 C10）：afk-powersave 的 `nofx` 選項注入覆寫樣式——**鏡射上游選擇器、靠後載入勝出、不用 `!important`**（剪影怪 `brightness(0)` 等功能性 filter 的勝負關係才不會被打亂）；鎖定改紅框 outline、狂暴保留地面紅環，玩法訊號不丟。C3（sprite 混合模式）刻意不動：拔掉 blend 會讓影子/武器層直接露出灰底黑框，視覺壞損大於省電收益。
9. **新選項「切到背景暫停戰鬥模擬」**（治 A1/A2 的耗電面）：包 `gameLoop`，選項開啟且 `document.hidden` 時早退——不碰核心 Worker（`_bgHeartbeatWorker` 是頂層 `let`，外掛也搆不到），只是讓它每秒的喚醒變 no-op。回前景走核心既有的差額補跑（上游本來就把它當 Worker 失敗時的退路，`js/01:1414`）；更長的離開由 afk-offline 接手。⚠️ 設計前必讀 `docs/offline.md`＋確認 `_ffHiddenAt` 的債務上限行為，並想清楚與離線結算的交接點——這是「背景掛機」與「省電」的取捨，必須是玩家自選。
10. **`lowfps` 加強**：②追加更狠的檔位（250~500ms）→ **❌ 實測否決**：節到 500ms 後怪物列重繪從 176 次/45 秒掉到 46 次、戰場新增貼圖 271→105，**行程 CPU 完全不動**。掛機的成本大頭不在「重繪幾次」，而在每幀照跑的合成/光柵（約 57fps）、8fps sprite 換圖與常駐濾鏡——那些都不受 `updateUI`/`renderMobs` 節流影響。①把 `renderStatusEffects` 也納入節流（它繞過 `updateUI`，現在管不到，治 B2/B3 的一半）未實測，但它與②同屬「減少重繪次數」方向，**先量再做**。
11. **新選項「關閉背景音樂於背景分頁」**（治 A3）：`visibilitychange` 時暫停/恢復 BGM。也可考慮直接併進「關閉背景音樂」的行為說明。

### 第三批：錨點補丁候選（最後手段，效益大但要背同步成本，待議）

12. **狀態列同值不寫**（治 B2）：`js/03:696-698` 在 tick 內聯、外掛包不到。補丁加一個「字串沒變就跳過」守衛。
13. **`renderStatusEffects` 簽章短路**（治 B3）：可先試 monkey-patch 版——wrapper 算一個 buffs/statuses 的輕量簽章，沒變就不呼叫原函式（核心每次都整包重寫，跳過呼叫=保留上次 DOM，語意安全）。成立的話不用動核心。
14. **日誌 scrollTop 批次化**（治 B6）:把「每則捲一次」改成「每幀捲一次」。`logCombat`/`logSys` 是全域函式，可外掛包裝：訊息照插，捲動合併到 rAF。
15. **`_updateUIImpl` 的 5 次全文件掃描**（治 B4 局部）：`[data-grp]` 那三行結果只跟「當前武器是否遠程」有關，補丁可快取 NodeList 或武器類型沒變就跳過。

### 刻意不動的

- **主 tick 10Hz 與戰鬥邏輯本體**（B1）：這是遊戲本身，動了=改遊戲平衡。
- **背景 Worker 本體**（A1）：上游的「背景掛機」賣點，只做成玩家可選的暫停（方案 9），不預設關。
- **刷王 5 秒一存**（B7）：存檔頻率牽涉資料安全（玩家斷線/閃退的損失窗口），省這點電不值得冒險。
- **lzcache 的字串快取設計**（D8）:檔內註解寫明是防 mutator 汙染的刻意設計，且淨效益為正。
- **預設視覺**：所有視覺降級一律走省電模式選項，預設外觀與上游一致。

---

## 實測結果：省電模式各選項省多少（2026-08-05）

真實存檔（`.testdata/_user_baseline_C`・法師 Lv.99 @ 龍之谷）在 412×915 視窗掛機 45 秒，量 CDP `Performance.getMetrics` 的 **`ProcessTime` 差分＝算圖行程全部執行緒的 CPU 秒數**（最接近耗電）。每個設定各跑數輪、**每輪全新分頁**，取中位數；兩批獨立測試各自帶自己的基準對照（批次之間的機器狀態會漂移，跨批比絕對秒數沒意義）。基準（全部不勾）在這台桌機是 23~26 秒／45 秒 ≈ 半顆核心常駐。

| 面板選項 | 第一批（3 輪） | 第二批（4 輪） | 判定 |
|---|---|---|---|
| 關閉戰鬥動畫 | 省 24% | 省 37% | 兩批都最省 |
| 關閉光暈與濾鏡 | 省 22% | 省 25% | 次之（真機只會更值錢，見下） |
| 關閉戰鬥特效 | 省 17% | 省 16% | 第三，兩批最一致 |
| 降低畫面更新頻率 | 省 4% | −2%～8% | **等於沒省**（加狠檔位也一樣，見方案 10） |
| 關閉傷害數字 | 省 0% | — | **量不出差別** |
| 五項全開 | 省 61% | — | 有疊加，不是彼此重複 |

**面板選項順序就是照這張表排的**（`afk-powersave.js` 的 `opts`）。直覺會把「降更新頻率」排第一——它砍掉的重繪次數最多——但那正是被實測推翻的那一個。

三個限制，看數字前先讀：

- **無頭瀏覽器沒有真 GPU**（軟體光柵）。「關閉光暈與濾鏡」拔掉的 filter／drop-shadow／mix-blend 在真手機是 GPU 每幀重算，這裡只量到被換算成 CPU 的那部分 → **是低估**，真機上它有機會超過「關閉戰鬥動畫」。
- **音樂／音效沒量到**：無頭環境沒有使用者手勢，BGM 根本不會播。它們排最後是依「音訊解碼常駐、切背景也不停」推估，不是實測。
- 「關閉戰鬥動畫」省的**不是**重建貼圖節點（戰場新增貼圖數只少 10%），而是 sprite 每 125ms 換 `src` 的重新解碼與重繪——換圖解碼是 CPU 工作，所以在無頭環境就量得出來。

「降更新頻率」與「關傷害數字」實測為零，但仍留在面板上（已勾的玩家關掉也無害）；要不要移除是另一個決定。

## 量測與驗證方式

- **改前先立基準**：Playwright（headless）＋ CDP `Performance.getMetrics`／`PerformanceObserver('longtask')`，掛機同一張圖固定 60~90 秒，記 CPU time / task 數。手機情境用 CPU 4x~6x throttle。真實存檔在 `.testdata/`（新角色量不出大背包/血盟的成本）。
- **每輪重新導航**，不要原地重複 `loadGame()`——計時器/監聽疊加會把數字全污染（踩過，見專案 CLAUDE.md）。
- **🚨 不可以用 Playwright 的 `page.route` 攔截來改寫要測的檔案**：光是開著攔截就讓算圖行程 CPU **+56%**、幀率 −7%，足以蓋過要量的東西，而且**看起來完全像是被測選項自己的效果**（2026-08-05 差點得出「畫面節流加狠反而更耗電」的假結論，靠加一組「改寫成原值」的對照組才抓到）。要改寫原始碼就在**測試用靜態伺服器那一端**替換字串。同理，為量測而加的探針（計數器、MutationObserver）必須每組都有才公平。
- **除了 CPU 也要記工作量指標**（擊殺數、重繪次數、戰場新增貼圖數）：分得出「有生效但沒省電」與「根本沒生效」。省電模式那批就是靠「重繪次數腰斬而 CPU 不動」才確定畫面節流方向無效——只看百分比會以為是噪音。
- GPU 面（C 系列）靜態掃描判不準：哪些動畫被合成器 offload、同值 style 寫入是否被引擎 dedupe，要開 DevTools Performance＋Layers 實測才算數。
- 省電選項的驗證＝「開關前後的 CPU time / paint 次數對比」，不是「畫面看起來有沒有變」。
- 附帶觀察：降低常駐 CPU/記憶體壓力，對 iOS「玩一分鐘白畫面自動重載」問題（見 memory `white-screen-investigation`）可能也有幫助——那個問題疑似資源壓力觸發的 PWA 重載。
