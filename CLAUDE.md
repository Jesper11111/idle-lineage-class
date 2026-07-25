# 放置天堂（加掛版）— 專案規則

## 專案性質與架構（2026-07-24 起・PP 鏡像＋本地政策層）

- 網頁放置遊戲。遊戲本體由原作者(巴哈姆特 秋玥)製作,原版:**https://shines871.github.io/idle-lineage-class/**;直接上游:**https://github.com/pp771007/idle-lineage-class**;本站:https://jesper11111.github.io/idle-lineage-class/。
- **架構=「PP 完整成品鏡像＋本地政策層」**:PP 的核心、外掛、`index.html`、`sw.js`、`assets/`、`public/` 都整包同步;本站只以冪等補丁保留傭兵經驗均分、金幣 ×1、每名未倒地傭兵掉寶 +60%／招募／受僱政策、回城免費更新快照、離線安全、妖精傭兵技能例外與全裝置隱藏來源橫幅。
- PP 已負責跟進 shines871;本站不再直接從 shines 組裝。日常同步來源固定為 `pp771007/main`。
- 本 repo 的 `upstream` remote 指向 PP。**引用上游做任何判斷前先 `git fetch upstream --tags --prune`**。
- 同步狀態記在 `upstream-checkpoint.json`(`syncedUpstreamCommit`=目前鏡像的 PP commit)。

## ⭐ 修改原則(鐵則)

**🚨 絕不直接手改 PP 同步檔——下次同步會整包覆蓋。** 要動遊戲行為,依序考慮:

1. **外掛 monkey-patch(首選)**:核心函式都是全域,外掛包裝(`var _orig = fn; fn = function(){...}`)能解決絕大多數需求。afk-offline 連整套離線結算都是這樣掛的。
2. **錨點式補丁(最後手段)**:靠 PP 原文特徵定位、冪等、錨點找不到就 exit 1。一般相容補丁放 `apply-core-patches.mjs`;傭兵政策放 `apply-policy-patches.mjs`;離線互斥/遷移/禁圖放 `apply-offline-safety-patches.mjs`。
   | # | 檔 | 內容 |
   |---|---|---|
   | 1 | js/03 | `maybeSpawnMobs` 抽出(tick 出怪塊→具名函式,離線快速結算共用同一份排程) |
   | 2 | js/08 | `gainItem` 自帶強化值鉤子 `__afkTradRollEn`(afk-traditional 偽傳統) |
   | 3 | js/13+js/06+js/25+js/28 | 存檔位 8→16(`SAVE_SLOT_MAX`;匯入重複掃描/傭兵招募/血盟成員掃描/PVP 對手清單) |
   | 4 | js/22 | 寵/召 sprite ticker 改間接呼叫(讓 afk-powersave 包得住) |
   | 5 | js/07 | 迴避頭目 × 自動找BOSS 互斥(`AFK_BOSSRING.huntActive`) |
   | 6 | js/08 | `useItem` 加 `keepModal` 參數(自動瞬移不關玩家視窗) |
   | 7 | js/10 | 「立即賣出」總開關關閉時不強制套規則(免誤賣沒標記的裝備) |
3. **index.html 不手改**:它=PP index,僅在 PP 的 `afk-offline.js` 前注入 `scripts/local-policy-block.html` 三支本站政策外掛。PP 自帶外掛及順序全部照 PP;本站外掛順序固定為 hide-banner → owner → merc-policy → PP offline。
4. **CSS 覆寫**寫在外掛注入的 `<style>` 裡(如 afk-mobile),不改 `css/*.css`。

**外掛開關(afk-toggles.js,載入順序第一)**:每支外掛可被玩家單獨關掉——某支壞掉時玩家關掉它就能用原版繼續玩(逃生門)。契約:
- 純新增型外掛檔頭 `if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('<id>')) return;`;包核心函式型在 wrapper 內每次先問 `enabled()`,關掉就透明放行原函式。
- 載入時 `AFK_TOGGLES.register({id,name,desc,group,def})` 進開關面板。讀不到 AFK_TOGGLES 一律當開啟。afk-toggles 自己不可被關、不依賴任何外掛。

**🚨 不可停用的基礎設施,不能依賴「可被關掉的外掛」提供的東西**:afk-toggles 是逃生門(設計上不可停用),但它的左上角按鈕位置讀 `--orig-bar-h`,而那變數當時**全專案只有 afk-mobile 在設**(現已搬到不可停用的 `afk-banner.js`);afk-skin 判斷手機也只看 afk-mobile 掛的 `body.m-mobile`。玩家一關「手機版面」→ 逃生門縮到橫幅底下點不到(遊戲橫幅 z-index 是 int 上限 2147483647,壓得過任何外掛)、入口全被收進手機上失準的 fixed Modal ——**壞掉後連「把外掛開回來」的入口都沒了,是死結**(2026-07-20 玩家回報)。判準:**寫 `var(--某變數)` 或讀 `body.某class` 前,先問「這誰設的?那支能不能被關?」** 能被關就要自己有保底(自己量一次/用同一組規則自己判)。⚠️ 這類「A 外掛量測、B 外掛使用」的跨外掛耦合在全開狀態下永遠測得過 → smoke 已加**第三輪**(手機+關掉 afk-mobile)驗逃生門可點與入口可見,新增這類耦合時順手擴充該輪。

**同一個雷第二次(2026-07-23 平板玩家回報)**:「讓開橫幅」整組規則(量橫幅→`--orig-bar-h`→位移 `#app-stage`/`#creation-screen`/`#game-screen`)當時也寫在 afk-mobile 裡 → 平板玩家為了換回三欄版面把「手機版面」關掉,頂端整排被橫幅蓋住。讓位已抽成 `afk-banner.js`(基礎設施、無開關);2026-07-25 起另由不可停用的 `afk-mobile-banner.js` 在所有裝置隱藏橫幅，因此手機、平板與桌機的 `--orig-bar-h` 都應為 0。smoke 固定驗「手機版面關閉仍隱藏」與「桌機也隱藏且不留空白」兩條。

**新增「釘在畫面上」(fixed/sticky)的元素仍要分裝置驗證**:全裝置政策會把來源橫幅隱藏並令 `--orig-bar-h=0`。smoke 的假橫幅必須帶 `/shines871|官方|非官方|轉載/` 文字，否則其他 findBanner 相容邏輯不會辨識。新增固定元素時仍要同時驗手機與桌機皆為零橫幅。

**外掛通用守則**(沿用、仍然有效):
- 優雅降級:需要的全域函式/元素不存在就 `console.warn` 後安靜停用,不可弄壞遊戲。
- **🚨 絕不可盲呼叫「會寫入玩家存檔」的原作函式**(踩過:主選單狀態呼叫 `saveGame()` 把玩家第 1 格蓋成 Lv.1 null、無備份可救)。要存檔資料**直接讀 `localStorage`**(`lineage_idle_save_<n>`);非寫不可時先驗 `player && player.cls`。任何會動玩家 localStorage 的操作,都要假設可能在「未載入角色/currentSlot 不是預期那格」被觸發。
- 外掛插 DOM 錨「穩定容器 id」,不要錨父子關係——錨不到只會安靜消失,smoke 驗不到,改過首頁版面要人工掃。
- 覆寫「會被 `.hidden` 切換」的容器 display 時一律加 `:not(.hidden)`,否則畫面關不掉(踩過)。
- **覆寫上游「寫在 media query 裡」的樣式時,自己的規則要包進同一條 media query**:afk-mobile 的 `detectMobile()`(`pointer:coarse` 或 UA 或寬 ≤820)跟上游 CSS 的手機斷點(`max-width:768px` 或 `max-height:520px and pointer:coarse`)**判定範圍不一樣**——觸控平板在我們眼中是手機、在上游 CSS 眼中是桌機。只寫 `body.m-mobile` 就去覆寫上游手機版的 `top`/`height`,平板會拿到「我們的定位＋上游的桌機 transform」→ 兩套幾何混搭,元素被 `translate(-50%,-50%)` 推出畫面(城鎮 NPC 視窗踩過,top 到 −489、上半截全在畫面外,**手機與桌機都測不出來**)。判準:**要覆寫的上游宣告是包在 media query 裡的嗎?** 是 → 自己的規則也包同一條;只有純位移／封頂(padding、max-height)這種「哪種幾何都成立」的才可以裸寫。
- 外掛自建遊戲物件(如木人場 spawn 怪)欄位要對齊核心 `spawnMob`,缺欄位(如 `_born`)會整個系統安靜失效。
- 上游改版後外掛的「字串/DOM 結構假設」可能失效——同步後 smoke＋人工掃一輪首頁/手機版面。

## 🔄 同步上游 SOP → 跑 `/sync-upstream` skill

使用者說「同步 PP/更新上游」就跑 `.claude/skills/sync-upstream/`。摘要:
1. `git fetch upstream --tags --prune` + checkout `upstream/main` 到獨立 worktree。
2. **assets 鏡像**:比對要用 **blob sha**(`git ls-files -s`),不能只比檔名——「兩邊都有但內容不同」佔過大宗(踩過:一次 10,149 檔)。補檔用 tar 走檔案清單(中文檔名不經 exe 參數);**上游沒有的檔要刪**(assets 已於 2026-07-19 達成純鏡像,刪前仍 grep `afk-*.js`+`scripts/` 確認外掛層沒引用)。
3. `node scripts/sync-upstream.mjs <PP-worktree>`:鏡像 PP 核心與外掛 → **check-save-io** → 注入本地政策外掛 → apply-core/apply-shines-backports/apply-policy/apply-offline-safety → 重產 manifest → stamp 版本 → smoke。`assets/` 鏡像必須使用 `scripts/shines-backport-assets.txt` 排除清單保留核准回移資產。**錨點失效會 exit 1**→讀 PP 該處 diff、更新補丁錨點再跑。
   - **`scripts/check-save-io.mjs`(存檔寫入/壓縮把關)**:`afk-synccompress` 是唯一「整支覆寫核心存檔函式」的外掛(換掉 `_lzSet`、自己拼 `"LZ1:"+compressToUTF16`、bump `_lzWorkerRev`、退路呼叫 `_lsSet`),上游一改存檔格式/Worker 對帳,開著那支的玩家就會被寫出**讀不回來的存檔**,而 smoke 只驗掛點、驗不到。故同步時逐支比對這組核心函式的 sha(基準存在 `upstream-checkpoint.json` 的 `saveIo`),變了就 exit 1。處理:讀 diff → 判斷外掛要不要跟改(有疑慮先在 afk-toggles 給 `synccompress` 加 `locked` 鎖起來) → 確認安全再 `node scripts/check-save-io.mjs --accept` 收下新基準。
4. 更新 `upstream-checkpoint.json` → commit(不主動 push)。
5. 小百科與掉落查詢直接鏡像 PP；仍須針對 PP BASE..TARGET 的資料變動做畫面抽查。

CI 版:GitHub Actions `sync-upstream.yml`(**只有 `workflow_dispatch`,無 GitHub schedule**)監看 `pp771007/main`:ls-remote 比 checkpoint 早退 → 鏡像資產(`rsync --delete`)→ sync 腳本(AFK_SKIP_SMOKE=1)→ smoke → **全綠只推 `sync/upstream-*` 分支並建立 PR,絕不直推 main**;錨點失效/smoke 紅 → 開 issue、不建立 PR。人工 review/merge 後,`deploy-pages.yml` 才部署正式站,`release-synced-upstream.yml` 才發 Release。

## 目前的外掛(PP 自帶外掛＋本站 3 支政策外掛;順序以 PP index 為準)

| 檔案 | 功能 |
|---|---|
| `afk-toggles.js` | 外掛開關中樞(最先載;逃生門,自己不可關) |
| `afk-banner.js` | 非官方轉載橫幅量測後備(若本地隱藏政策失效仍會量高度→`--orig-bar-h`;基礎設施,無開關) |
| `afk-mobile-banner.js` | 所有裝置隱藏非官方轉載橫幅且不留高度；保留 DOM 作 PP 防重複插入標記，不依賴可停用外掛 |
| `afk-synccompress.js` | 存檔即時壓縮(預設關;把 `_lzSet` 換回同步壓縮,根治登出/多開後存檔未壓縮爆滿;代價=存檔當下多花 0.02~0.4 秒) |
| `afk-lzcache.js` | 存檔解壓快取(同一份壓縮字串只解一次;核心每殺一隻怪都重讀整包血盟狀態,離線結算 4×) |
| `afk-ui.js` | 共用彈窗:接管 alert、`AFK_UI.confirm`、openLayer/closeLayer(返回鍵/ESC 關最上層) |
| `afk-extradata.js` | dex/wiki 共用手動補充資料(`AFK_EXTRA`:itemAcquire/武器特性白話/mapName) |
| `afk-offline-owner.js` | 在 PP offline 載入前宣告本站舊離線引擎擁有結算權 |
| `afk-merc-policy.js` | 傭兵經驗均分、金幣 ×1、每名未倒地傭兵掉寶 +60%／招募／受僱政策、回城免費更新快照與妖精傭兵不限當前屬性精靈魔法 |
| `afk-offline.js` | PP 舊版離線掛機整套;由本站安全補丁維持嚴格獨占、首次遷移不補算與特殊副本禁圖 |
| `afk-mobile.js` | 手機版面薄殼(底部導覽列切三欄、手機幾何的彈窗讓位、浮動日誌;版面用上游原版) |
| `afk-backnav.js` | 手機返回鍵/手勢在子畫面回上層而不是關 PWA |
| `afk-battlehud.js` | 手機戰鬥狀態列(取代上游只有 HP/MP 的 #mobile-vitals;自己量橫幅) |
| `afk-mapbar.js` | 手機冒險地圖標題列壓成兩排(純 CSS,自己判手機) |
| `afk-nozoom.js` | 手機取消雙擊放大(body touch-action:manipulation;捏合縮放保留) |
| `afk-slotinfo.js` | 選角卡片疊「掛哪張圖/掛多久」(讀 afk-offline 的 afk_map_/afk_ts_,唯讀) |
| `afk-loadslots.js` | 卡片式選角擴到 16 格(搭配補丁3) |
| `afk-dex.js` | 掉落查詢(五張掉落表+特殊掉落 SPECIAL_BLOCKS;`?view=dex` 獨立頁) |
| `afk-wiki.js` | 小百科(多分頁+統一搜尋;`?view=wiki` 獨立頁;改前讀下方維護準則) |
| `afk-storage.js` | 首頁「⚙ 設定」選單(MENU_ITEMS 可擴充)+檢查存檔大小 |
| `afk-notice.js` | 首頁公告卡(通用框架;檔頭 `NOTICE=null` 就不顯示,要發公告填一組設定即可) |
| `afk-quotawarn.js` | 存檔空間警告(localStorage >80% 時首頁紅卡提醒刪角;唯讀;估算與 afk-storage 同套) |
| `afk-history.js` | 離線掛機紀錄卡片(讀 afk_hist_<slot>,唯讀) |
| `afk-diag.js` | 快取診斷(全程唯讀;欄位各自包錯;產物自帶版本號) |
| `afk-reissueid.js` | 換發身分證(角色身分碼重發) |
| `afk-powersave.js` | 省電模式(關戰鬥動畫/降更新頻率;涵蓋寵/召 ticker=補丁4) |
| `afk-statpts.js` | 能力值來源分解(能力圖下方單一區塊) |
| `afk-statlist.js` | 能力分頁條列式(拿掉經典背景圖改大字卡片;純 CSS,DOM/updateUI 不動;配點中改單欄) |
| `afk-autobuy.js` | 自動買肉/魔法屏障卷軸補貨(預設開;離線結算共用 `__afkAutobuyCheck`) |
| `afk-training.js` | 木人場(量真實 DPS;獨立 map id `afk_dummy`) |
| `afk-bossring.js` | 傳送控制戒指自動找BOSS(缺卷軸自動購買;與迴避頭目互斥=補丁5) |
| `afk-itemsearch.js` | 背包名稱搜尋(包 renderTabs 重注入;純顯示層過濾) |
| `afk-invlist.js` | 背包條列式(桌機手機通用) |
| `afk-eqlist.js` | 裝備分頁條列式(隱藏 12 格圖形窗,露出原生部位條列) |
| `afk-npclist.js` | 村莊 NPC 條列式(鏡射地圖 NPC 成列表) |
| `afk-mobname.js` | 怪物名稱顯示模式三選一(純 CSS+body data 驅動) |
| `afk-toast.js` | 手機 toast(包 logSys,點擊同步窗內訊息浮現) |
| `afk-touchtip.js` | 手機長按看資料(技能/商店/製作/收集冊/背包) |
| `afk-notip.js` | 關閉物品懸停資訊框(預設關;技能說明保留、只在滑鼠環境動作;不印 hooks OK 不進 smoke) |
| `afk-trackinfo.js` | 狀態欄顯示魔物追蹤剩餘時間(包 renderStatusEffects,補一格) |
| `afk-battlebuffs.js` | 手機戰鬥框下方鏡射整條狀態欄(必須排在 afk-trackinfo 之後才含追蹤格) |
| `afk-relicguard.js` | 快速廢品的「全選」跳過遺物(包 quickJunkSelectAll/buildQuickHeader) |
| `afk-junkmgr.js` | 快速廢品標記管理(可檢視並移除已標記的武器／防具，不改核心存檔格式) |
| `afk-enhtarget.js` | 快速強化目標上限 +12→+15(包 buildQuickEnhanceHeader 補下拉;執行端本就鉗各裝備 enhanceCap) |
| `afk-retrial.js` | 試煉批次兌換(試煉道具持續掉落·已完成也照掉;面板自訂數量重複兌換;試煉狀態只讀不寫;包 trialItemActive/trialQHTML/build50TrialHTML) |
| `afk-traditional.js` | 傳統模式(偽)/自動衝裝(掉落自帶強化值;靠補丁2 的 `__afkTradRollEn` 鉤子) |
| `afk-warehouse.js` | 倉庫增強(金幣全存/全取、遺物與席琳遺骸分類) |
| `afk-dograce.js` | 賽狗場迷你遊戲(奇岩城鎮限定;自製) |
| `afk-pwa.js` | PWA 安裝 UI+圖桶/程式桶對帳(reconcile 送 SW) |
| `afk-sw.js` | Service Worker 註冊(sw.js 是我方檔,上游無 PWA) |
| `afk-syncinfo.js` | 首頁顯示原作者連結+真正的原版同步時間(讀 version.json 的 upstreamAt；舊版才退回 buildAt) |
| `afk-mercguard.js` | 招募被規則擋下時顯示原因(含安塔瑞斯輔助互斥與容量不足；只包裝提示，不改招募規則) |
| `afk-analytics.js` | Cloudflare Web Analytics(只在正式站注入) |
| `afk-skin.js` | 首頁外掛入口收納(桌機🔌鈕/手機依原版按鈕樣式;固定最後載,MutationObserver 等入口到齊) |

> **獨立頁與跨頁連結(dex↔wiki)**:`?view=dex`/`?view=wiki` 鋪滿整頁+頁首導覽;跨頁一律走對方暴露的 mode-aware `goto`(`AFK_DEX_API.goto({q})`/`AFK_WIKI_API.goto({tab,cls,q})`,自動判斷模態連模態/網址連網址);「名字→跳掉落查詢」inline 連結用 `<span class="m-dexlink" data-dexq="名字">`(全域委派);開對方前先 `close()` 來源模態。新增跨頁連結要重用/擴充 `goto`,不要在呼叫端自己判斷。

## 🗺️ 離線掛機——舊版 afk-offline 獨占

**2026-07-24 起恢復舊版機制**:離線掛機只由 PP `afk-offline.js` 結算;PP 新離線引擎不可同時取樣、蓋錨點或發獎。

- `afk-offline-owner.js` 先宣告 `window.__afkLegacyOfflineOwnsSettlement=true`;PP 新離線引擎偵測後退出。這是嚴格互斥,不是讓兩套各自判斷。
- `offline`、`history` 開關已解鎖;玩家關閉 `offline` 代表**完全不做離線結算**,不會回退啟用 PP 新引擎。smoke 第四輪固定驗這條。
- 每個存檔位用 `afk_offline_legacy_migrated_v3_<slot>` 做一次性遷移。首次用舊引擎載入只蓋新錨點、不補算舊區間,避免新版→舊版交界重複結算;下一次離線才正常補跑。
- `afk-slotinfo` 只在該存檔位完成遷移後顯示 `afk_map_`/`afk_ts_`,避免拿歷史殘值顯示假掛機時間。
- 安塔瑞斯副本 `antharas_nest_1/2/3`、`antharas_lair` 禁止離線模擬;一般地圖維持舊版行為。

核心原則:**離線掛機=把「在線上會發生的掛機」照跑一遍**(同圖續掛、撞死即停結算到死前、存活回原地)。「離線」定義=**關閉遊戲**;分頁切背景不算(遊戲照跑、心跳照蓋錨點,是預期行為,不要「順手修」)。

實作要點(改離線行為前先讀 afk-offline.js 檔頭註解):
- 掛點:外掛自己 monkey-patch `loadGame`(開頭擷取錨點/結尾結算)、`saveGame`/`changeMap`(結尾 stamp)、`killMob`/`gainItem`(結算期間計數);出怪走核心補丁抽出的 `maybeSpawnMobs()`(與線上同一份排程)。
- 💾 分段檢查點:結算每 ~5 秒 saveGame+錨點推進到「已結算時點」;**任何新程式碼想在結算(`catchingUp`)期間蓋 afk_ts 都是 bug**。
- ⚡ 快速結算:取樣→事件驅動逐殺(批次擊殺保 AOE、BOSS 懶驗證+抽驗、維持自動續 buff);危險/特殊圖退回全模擬。**快速段不跑 tick()/autoActions**——「只寫在 autoActions 的自動行為」要各自補,補法=**直接呼叫原作那支函式**(如瞬移 `useItem(uid,true)`),不要自己刻守衛清單(必漏、必分歧)。
- 排名/計時挑戰類(時空裂痕、排名攀登)**離線一律不續、不結算**(續=刷榜 exploit);攀登/遺忘之島這類非選單圖用外掛自存旅程狀態+原作進場函式還原,不可走 gotoMap 選單路徑。
- **判準:遊戲邏輯的時間判斷用 `state.ticks`,不用 `Date.now()`**(補跑壓縮時間,牆鐘幾乎凍結)。例外=「關遊戲也該倒數」的(攻城冷卻)留牆鐘。
- **ff 洩漏判準**:補跑(`state.ff`)期間,戰鬥路徑**直接**呼叫的 `render*`/重副作用(`saveGame`)要被 `!state.ff` 擋住或函式內早退;**自己跑的 timer(setInterval/rAF)也要問「補跑期間它還在跑嗎」**。守衛用 `state.ff && !state.ffSmall`(小補跑要放行)。上游是原文改不得→這類守衛由 afk-offline 以 wrapper 實作(如 sprite ticker、音效靜音)。
- debug:`window.__afk.forceCatchup(分鐘, noFast)`。全模擬慢是戰鬥模擬本身,不是掃描/記憶體,別往那優化。
- **🚨 背景分頁回前景由 afk-offline 包 `settleBackgroundMs` 接管,交回核心 `queueCatchupMs` 逐 tick 補跑**:背景是線上遊戲暫停後補 tick,不是關閉遊戲後的離線發獎。上游若再動 js/01 的 visibilitychange/pageshow 或 `settleBackgroundMs`,要重驗這條。
- **PP 新離線引擎由 owner 標記停用**:同步後 `apply-offline-safety-patches --check` 與 smoke 會驗獨占標記、新版入口未接管;錨點改動就應讓同步失敗,不可靜默退回雙引擎。
- **測遷移**:移除 `afk_offline_legacy_migrated_v3_<slot>` 並把舊 `afk_ts_<slot>` 回撥,首次載入必須零發獎、零歷史且重蓋錨點。**測正常離線**:先完成遷移,再只回撥 `afk_ts_<slot>`/設定 `afk_map_<slot>`;新版 `lineage_idle_offline_v1_*` 與存檔內 `player.offlineHunt.awaySince` 不應參與。

## 📦 Service Worker / PWA(sw.js 我方檔)

- **雙桶分離**:程式桶 `code-v1`(固定桶名;js/css/index/manifest/圖示;導覽 network-first、資源 cache-first 帶 `?v=`)+圖桶 `img-v3`(固定桶名;assets 全部,純 on-demand)。失效走**對帳**不整桶倒:程式桶 reconcileCode(DOM 現行引用清單)、圖桶逐張(assets-manifest 的 blob sha)、動畫逐怪(anim-manifest)。
- **🚨 SW 不可對圖桶 `cache.keys()`**——筆數多會拋 `Operation too large` 整支對帳靜默掛掉;列舉不到時什麼都別做;清之前先確認記錄寫得進去。程式桶(數十筆)可以。
- **`cache.put` 條件一律 `res.status === 200`(不是 `res.ok`,206 會 reject)且永遠掛 catch**;音檔(bgm/sfx)fetch 不攔截。
- **install 刻意不 `skipWaiting`**(常駐請求會讓交接死鎖、首頁卡半分鐘);activate 只留 claim。搬家/清理不可寫在 activate。
- **改任何程式檔後 push 前 `node scripts/stamp-sw-version.mjs`**(讓 sw.js 位元組變→PWA 偵測更新;`CODE_VERSION` 只當觸發器不當桶名)。**動 assets 後 `node scripts/gen-manifests.mjs`**(+動畫另有 `node tools/gen-anim-manifest.js`,sync 腳本都會跑)。判準:凡「URL 含 `/assets/`、會被圖桶快取」的圖必須在某份對帳清單裡,否則換圖卡舊。
- afk-diag 取證:欄位各自包錯(一個 API 炸不可帶走整份)、唯讀硬性要求、產物自帶版本號;`CODE_VERSION` 不含 sw.js 自己——改 sw.js 版本號不變,判 SW 新舊靠新欄位/`reg.waiting`。

## 📚 小百科/掉落查詢維護(更新內容跑 `/update-wiki`)

資料變動來源=同步上游。同步後跑 `/update-wiki`:以上游 BASE..TARGET 逐檔 diff、照「檔→頁」對照表歸位、render 實測、推進 `wiki-checkpoint.json`。鐵則(使用者明訂、別再犯):
- **逐檔讀完整 diff,機制改動(`-`/`+` 成對)也要讀**,不可只掃新增定義;不可假設「前面做過了」就跳過。
- **表格優先、有數據用數據**;程式查得到的數字優先「動態讀 DB/呼叫遊戲函式」產表;散文只留機制說明。表格已表達的不要在下面散文重述。
- **數據以「真正算它的那段 code」為準**,絕不抄遊戲說明文字/註解(常過時);白話零術語(不要 1D4/骰 19);AC 照遊戲顯示負值;寫「現況」不寫改版語氣;不要模糊詞(短時間/有機率)。
- **渲染內容絕不露英文**——狀態/數值名補對應表(`STATUS_LABEL`/`STAT_LABEL`/`AFK_EXTRA.mapName`);地圖漏翻有 smoke 自動擋。
- **掉率要把三個倍率一次講完**(席琳×3/瘋狂×5/恩賜×10;判準=該 roll 有沒有乘 `_dropMult` 系);「不吃倍率」的兩處都補:小百科該頁+dex `SPECIAL_BLOCKS` 的 dropmult 清單。⚠️ **經典模式沒有掉率懲罰**——`classicDropMult()` 上游 v3.0.85 起恆回 1(v3.0.82 也已移除經驗×0.5/金幣÷2),舊的「經典×1/10」與它的例外清單(試煉道具/遺物/卡瑞屠龍劍)全部作廢,不要再寫進任何頁。
- **條件式掉落(`if(...) gainItem`)都要在掉落查詢查得到**(掃 js/05/06 補 `SPECIAL_BLOCKS`);掉落表以 `_auditMobDrops` push 的那組為權威;客製製作結構(`DEMONKING_RECIPES`/`LUMIEL_RECIPES`…)dex+wiki 兩邊都補,**實測查得到才算數**;純兌換/無怪掉的補 `AFK_EXTRA.itemAcquire[id].short`;潘朵拉抽獎不列為取得方式(唯一來源也寫「目前沒有固定取得途徑」)。
- 裝備顯示一律重用 `buildItemDescHTML`,不自己刻數值格式。
- 介面:搜尋=統一結果(跨分頁跨職業,黃色高亮);分頁列單排橫捲;手機不加會撐高的標示元素。

## 🚨 push 前檢查清單(→ `/prepush` skill;hook 兜底)

1. `node scripts/stamp-code-versions.mjs`——**js/css/afk-*.js 的 `?v=` 全部自動對齊內容 sha1**,不要手動 bump、不要只 bump「有印象改到」的。漏 bump 的後果是**新舊混搭**(玩家快取時序決定,低機率無法重現,踩過整晚收益歸零)。
2. `node scripts/stamp-sw-version.mjs`(PWA 更新偵測)。動過 assets → `gen-manifests.mjs`。
3. `node scripts/smoke-hooks.mjs` exit 0(外掛掛點;手機限定外掛在第二輪 iPhone context 驗)。
4. `grep -nE "^<<<<<<< |^>>>>>>> |^=======$" index.html sw.js afk-*.js` 必須為空(sw.js 一定要一起 grep——標記躺在裡面頁面照常渲染、smoke 照過);每支外掛在 index.html 只出現一次。
5. `apply-core-patches.mjs --check` exit 0(核心補丁都在)。
6. commit 階段**不** bump/stamp——那是 push/發版流程的事(使用者明訂:功能做完就 commit,等說要 push 才跑 /prepush 一次處理)。

**合併進 main 後要等 `deploy-pages.yml` 成功**才算上線:再以線上 `version.json`/`?v=` 驗證內容(不要只信 workflow 綠燈);確認部署版本吻合後才通知使用者。

## 暫存 / 測試

- **`.testdata/` 有使用者真實存檔(gitignore,不進版控、不要清)**——玩家回報跟「資料量/等級/裝備/倉庫/離線」有關就先用它測,新角色重現不出來會誤判「沒問題」。灌法:`_lzSet('lineage_idle_save_1', ...)` 後 `loadGame()`(倉庫另拆)。
- 一次性腳本/截圖放 `.scratch/`(gitignore)。Playwright 一律 headless。
- **會寫玩家存檔的功能,上線前必測「真實角色→操作→比對相關 key 沒被改壞」**,且要涵蓋真實觸發狀態(如主選單=未載入角色)。
- 量效能每輪**重新導航**,不要原地重複 `loadGame()`(計時器/監聽疊加,記憶體 17→97MB、tick 慢 9 倍,數字全污染)。
- Tailwind 是預建置 css:JS 動態拼「沒出現過的 class」會安靜失效——先 grep `css/tailwind-built.css` 有沒有,沒有就寫自己的具名 class。

## Git / GitHub

- commit 不帶 Claude 署名(全域規則);訊息純變更描述。
- **commit 節奏**:一個功能一個 commit;不主動 push;bump/stamp 留給 push 時的 /prepush。
- `git pull --rebase` 衝突:產生檔(`sw.js`/`version.json`/manifest)衝突→手動刪標記留一版→重跑 stamp 腳本→continue;**stamp 不會清衝突標記也不會碰 index.html**,盲目 `git add -A` 會把標記 commit 進去(踩過兩次,sw.js 壞了肉眼看不出)。收尾一定 grep 衝突標記(見檢查清單 4)。
- 台灣時間戳:git-bash 的 `TZ=` 不生效,用 `date -u -d '+8 hours' +%Y%m%d-%H%M`。
- 版本/發版:`version.json` 的 `app` 是加掛版 semver(發版才 bump;stamp 會保留該欄位);發版跑 `/release` skill,更新說明只寫玩家有感的、白話。

## 🔁 修完 bug 要不要記進本檔:三題都「是」才寫,寫前先給使用者看草稿

1. 還會再發生嗎(成因仍在、可推廣)?2. 自動檢查擋不掉嗎(smoke/hook/stamp 已擋的去補檢查不補文件)?3. 下次真的想不起來嗎?
寫法:標題一句話結論,內文只寫「為什麼會中+判準/怎麼避」,不寫案發經過;能併進現有條目就別開新段。
