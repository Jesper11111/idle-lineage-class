/* ============================================================================
 * sw.js — PWA Service Worker：程式桶 / 圖桶「分離快取」
 *
 * 程式與圖片快取刻意分開，程式改版不會清掉所有圖片：
 *   ● 程式桶 CODE_CACHE：index.html + 所有外掛 js + 遊戲 js/css(含 tailwind-built.css) + manifest + PWA 圖示 + 外部 CDN(placehold)。
 *       桶名固定(比照圖桶),「不」隨版本換名:程式檔已用 ?v=(逐檔內容 sha)定址,換版即換 URL,
 *       cache-first 自然抓新版;沒改到的檔 URL 沒變、快取直接續用 → 一次更新只重新下載真的有改的那幾個檔。
 *       (舊設計「桶名=CODE_VERSION、activate 整桶倒掉」害每次發版全站 ~4MB 重載,已廢。老玩家升上來
 *        走「懶搬家」:cacheFirst 在固定桶 miss 時翻舊制 code-<hash> 桶,命中就搬進固定桶直接回用,
 *        不用重新下載;舊桶等頁面載完由 reconcileCode 收尾刪除。)
 *       舊版殘留 entry(?v= 已變的 js/css)由頁面(afk-pwa)每次載入送「現行引用清單」來對帳清掉(reconcileCode)。
 *       CODE_VERSION 仍由 scripts/stamp-sw-version.mjs 依「全部程式檔內容 hash」自動覆寫——它現在只負責
 *       「讓 sw.js 位元組變動 → 瀏覽器偵測到新版 SW」這件事,不再當桶名。
 *       ▸ 「導覽文件」(index.html / 目錄 '/')走 network-first：線上一律抓最新「殼」,根除 cache-first 把舊版釘死、
 *         又得靠 SW 換版才更新得了的老問題(iOS 換版尤其不穩);離線/網路慢退快取,離線遊玩照常(見 navFirst)。
 *       ▸ js / manifest / 圖示走 cache-first：它們帶 ?v= 版本號,換版即換 URL,撲空就抓新、不會被釘舊版,故維持 cache-first(秒開、省流量)。
 *   ● 資產桶 asset-<group>-<manifest hash>：assets/ 全部採 cache-first、按需下載。
 *       一般資產按第一層目錄分桶；anim/classanim/morphanim 依資料夾穩定分成 8 片。
 *       manifest 內容改變時只更換受影響的桶名；activate 只列桶名並整桶淘汰舊分片，
 *       不抓 24k 筆清單、不逐項 cache.match，也不對圖片桶呼叫 cache.keys()。
 *
 * 更新控制：
 *   - 導覽走 network-first → 線上開頁本來就是最新程式碼,SW 何時換版不影響使用者看到的畫面。
 *   - 新版 sw.js 安裝後「停在 waiting」,等所有分頁/App 關閉後自然接手(⚠️ 刻意不 skipWaiting,
 *     原因見 activate 前的說明——強行交接會和頁面的常駐請求互等死鎖,把更新後的第一次重整/登出卡住幾十秒)。
 *     導覽 network-first＋js/css 以 ?v= 定址 → 舊 SW 服務新內容零差異,晚點接手沒有任何代價。
 *
 * 圖片失效走 manifest 版本分片；不背景預抓，圖片一律 on-demand 用到才抓。
 * ========================================================================== */
const CODE_VERSION = 'code-8816ab1e8ae3';   // ← scripts/stamp-sw-version.mjs 自動覆寫,勿手改(只用來讓 sw.js 內容變動→觸發更新偵測,不是桶名)
const BUILD_ID     = '0728-0004'; // ← stamp 在 CODE_VERSION 變動時一起更新成台灣時間 MMDD-HHMM(僅供畫面辨識版本)
const CODE_CACHE = 'code-v1';     // 固定桶名,不隨版本換(檔案以 ?v= 定址;殘留由 reconcileCode 對帳清掉)
const ASSET_CACHE_SHARDS = 8;
const ASSET_CACHE_VERSIONS = {"anim-0":"2f5b5c6f252c","anim-1":"4858ad5b2533","anim-2":"bc3c1005171c","anim-3":"bf777ed949e1","anim-4":"e65ba062c4f1","anim-5":"0b8378d8d549","anim-6":"203dd4c427e7","anim-7":"b04e6965fb22","classanim-0":"e802b4c65971","classanim-1":"f015b366f013","classanim-2":"86739aea8907","classanim-3":"79ff6a39a4f3","classanim-4":"0dad9a2995f1","classanim-5":"f70d2957ee8c","classanim-6":"cb8087e0a04d","classanim-7":"5f725d3c82fd","morphanim-0":"f0231121399b","morphanim-1":"dd349185539a","morphanim-2":"043662bb252a","morphanim-3":"adc27903335f","morphanim-4":"0722943b7133","morphanim-5":"f32752e0764e","morphanim-6":"8f30735ea61e","morphanim-7":"a2e25974ce28","static-area":"06583a4b0351","static-background":"07470874d83e","static-bgm":"a6f629ab6444","static-character":"7bad733b5b38","static-doll":"a630b8dda443","static-favicon.png":"e3683fd5062f","static-fx":"b520680f1b01","static-icons":"19deb166c3d1","static-login":"023f1a2bac5d","static-logo":"600c79b6eca2","static-mobile-mobs":"effa65926bf8","static-morph":"36c302230d6e","static-npc":"d9427f6e4626","static-sfx":"d45a7e2c9be4","static-start":"52b9c96c006f","static-state-icons":"81d05d72a970","static-ui":"5db9c3dde31b"};
function _assetCacheShard(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) % ASSET_CACHE_SHARDS;
}
function _assetCacheGroup(pathname) {
  let clean = String(pathname || '');
  try { clean = decodeURIComponent(clean); } catch (err) {}
  clean = clean.replace(/^\/+/, '').replace(/^public\//, '');
  const assetsAt = clean.indexOf('assets/');
  if (assetsAt > 0) clean = clean.slice(assetsAt); // GitHub Pages 專案站：/<repo>/assets/...
  const animated = clean.match(/^assets\/(anim|classanim|morphanim)\/([^/]+)/);
  if (animated) return animated[1] + '-' + _assetCacheShard(animated[1] + '/' + animated[2]);
  const regular = clean.match(/^assets\/([^/]+)/);
  return regular ? 'static-' + regular[1] : null;
}
function _assetCacheName(pathname) {
  const group = _assetCacheGroup(pathname);
  const version = group && ASSET_CACHE_VERSIONS[group];
  return version ? 'asset-' + group + '-' + version : null;
}
const ASSET_CACHE_NAMES = new Set(Object.keys(ASSET_CACHE_VERSIONS)
  .map((group) => 'asset-' + group + '-' + ASSET_CACHE_VERSIONS[group]));
// 🔌 AFK_VERSIONED_ASSET_CACHES：只列桶名淘汰舊分片，禁止列舉任何圖片桶 entry。

// 外部 CDN：離線也要能用,用 cache-first 收進程式桶(opaque 也存)。
//   placehold.co=怪物圖載入失敗的備援圖。(Tailwind 已由作者改成本機 css/tailwind-built.css,
//   走 .css 副檔名進程式桶,不再需要列外部主機;原本的 cdn.tailwindcss.com 已移除。)
const EXTERNAL_HOSTS = ['placehold.co'];

// 導覽文件 network-first:有快取墊底時,等網路最多這麼久還沒回就先回快取(背景仍把快取更新到最新)。
//   離線時 fetch 會更快直接失敗、不會等滿這段;這只是「連得到但很慢/卡住」時不讓開場被網路拖死的安全閥。
const NAV_TIMEOUT_MS = 4000;

// ⚠️ 這裡「刻意沒有 install + skipWaiting」——新版 SW 停在 waiting,等所有分頁/App 關閉後自然接手。
//   skipWaiting 會死鎖(2026-07-15 headless 實測 3 次中 2 次重現):主選單 BGM 是 <audio> Range 串流、
//   登入畫面立繪逐幀輪播,頁面永遠有進行中的 fetch 事件 → 舊 SW 靜不下來、交接一直 pending;
//   此時使用者按重整/登出 → 導覽等交接、交接等頁面安靜、頁面等導覽完成才卸載 → 三方互等,
//   卡到導覽逾時(45 秒以上)。這正是「每次更新後首頁/登出要等很久」的另一半成因(前一半是舊制整桶倒掉)。
//   晚接手沒有代價:導覽 network-first＋?v= 定址,舊 SW 服務新內容零差異;新 SW 的快取策略改動
//   等 App 下次重啟生效即可。(代價僅剩:若還有人卡在 2026-06-24 前的舊 cache-first SW,要多一次
//   「關閉再開」才會換到 network-first;該批使用者事實上早已換完。)

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // 舊制「桶名=版本號」的程式桶(code-<hash>)「不」在這裡刪:它是懶搬家的來源(見 cacheFirst 的
    //   legacy 翻找),等頁面載完、該搬的都搬進固定桶後,由 reconcileCode 收尾刪除。
    //   (不把搬家寫在 activate 的原因:遊戲頁面持續在發請求,舊 SW 一直有進行中的 fetch 事件,
    //    skipWaiting 的交接會被拖到不知何時,activate 的執行時機完全不可控——實測過會卡住。)
    //   其餘不明桶照舊清掉。
    await Promise.all(keys
      .filter((k) => k !== CODE_CACHE && !ASSET_CACHE_NAMES.has(k) && !/^code-/.test(k))
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function _replyVersionedAssetCache(client, type) {
  if (client) client.postMessage({ type, evicted: 0, skipped: 'versioned-asset-caches' });
}

self.addEventListener('message', (e) => {
  const d = e.data || {};
  // 沒有 skip-waiting 訊息:現行頁面不會送;舊版頁面殘留的送過來也一律忽略(skipWaiting 會觸發上述死鎖)。
  if (d.type === 'reconcile-images' && Array.isArray(d.manifest)) {
    e.waitUntil(reconcileImages(d.manifest, e.source));
  }
  if (d.type === 'reconcile-anim' && Array.isArray(d.folders)) {
    e.waitUntil(reconcileAnim(d.folders, e.source));
  }
  if (d.type === 'reconcile-code' && Array.isArray(d.keep)) {
    e.waitUntil(reconcileCode(d.keep));
  }
});

// 程式桶對帳:桶名固定不隨版本換 → 換版後「舊 ?v= 的 js/css」會殘留在桶裡佔空間。
//   頁面(afk-pwa)每次載入把「現行 index.html 實際引用的 js/css URL 清單」送進來,
//   只清「同源、副檔名 .js/.css、且不在清單上」的 entry;殼(index.html)/manifest/PWA 圖示/外部 CDN
//   一律不動(它們量小、URL 穩定,且不在清單的判斷範圍,誤刪風險為零)。
async function reconcileCode(keep) {
  const keepSet = new Set();
  for (const u of keep) {
    try { const x = new URL(u, self.location.href); keepSet.add(x.pathname + x.search); } catch (err) { /* 壞 URL 略過 */ }
  }
  const cache = await caches.open(CODE_CACHE);
  for (const req of await cache.keys()) {
    let u; try { u = new URL(req.url); } catch (err) { continue; }
    if (u.origin !== self.location.origin) continue;
    if (!/\.(?:js|css)$/.test(u.pathname)) continue;
    if (!keepSet.has(u.pathname + u.search)) await cache.delete(req);
  }
  // 舊制 code-<hash> 桶收尾:此訊息由頁面「載入完成後」送來,頁面需要的檔早已在載入期間
  //   經 cacheFirst 的懶搬家進了固定桶,舊桶剩的都是用不到的舊版 → 整桶刪掉。
  for (const k of await caches.keys()) {
    if (/^code-/.test(k) && k !== CODE_CACHE) await caches.delete(k);
  }
  // 無版號 entry(manifest.webmanifest / PWA 圖示,URL 沒帶 ?v=)的刷新:桶名固定後沒有「整桶倒掉」
  //   兜底了,靠「CODE_VERSION 變了(=有發版)才清掉這幾個、下次用到重抓」,與舊行為等價但只刷這幾 KB。
  const VER_KEY = '/__afk-code-version__';
  let prevVer = '';
  try { const r = await cache.match(VER_KEY); if (r) prevVer = await r.text(); } catch (err) { /* 壞了當沒記過 */ }
  if (prevVer !== CODE_VERSION) {
    for (const req of await cache.keys()) {
      let u; try { u = new URL(req.url); } catch (err) { continue; }
      if (u.origin !== self.location.origin) continue;
      if (/\.webmanifest$/.test(u.pathname) || /pwa-icon[^/]*\.png$/.test(u.pathname)) await cache.delete(req);
    }
    await cache.put(VER_KEY, new Response(CODE_VERSION)).catch(() => {});
  }
}

// 舊頁面仍可能送 reconciliation 訊息；新 SW 直接回覆完成，不讀 manifest、不開圖桶。
async function reconcileImages(manifest, client) {
  _replyVersionedAssetCache(client, 'reconcile-done');
}
async function reconcileAnim(folders, client) {
  _replyVersionedAssetCache(client, 'reconcile-anim-done');
}

// cache-first + 連網補存。只存 status 200 或 opaque(跨網域);206(Range 部分回應,如 <audio> 串流音檔)
//   不能進 Cache(cache.put 對 206 會 reject:Partial response unsupported)→ 必須排除,否則丟出未捕捉的 rejection。
//   put 一律掛 .catch:任何寫入失敗(配額滿/極端 race)都不該變成頁面端看到的錯誤、也不該影響回傳 res。
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  // 程式桶 miss → 先翻「舊制 code-<hash> 桶」(桶名綁版本的舊設計)懶搬家:同 URL 的檔內容必同
  //   (?v= 就是內容 sha),搬進固定桶直接回用,免重新下載。舊桶由 reconcileCode 在頁面載完後收尾刪除,
  //   刪完後這段只多一次 caches.keys()(比對不到 code- 舊桶,零額外 IO)。
  if (cacheName === CODE_CACHE) {
    for (const k of await caches.keys()) {
      if (k === CODE_CACHE || !/^code-/.test(k)) continue;
      const legacy = await (await caches.open(k)).match(req);
      if (legacy) {
        cache.put(req, legacy.clone()).catch(() => {});
        return legacy;
      }
    }
  }
  try {
    const res = await fetch(req);
    if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const fallback = await cache.match(req);
    if (fallback) return fallback;
    throw err;
  }
}

// 導覽文件 network-first(配合 fetch 分流):線上拿最新殼、離線退快取。
//   ① 有快取墊底 → 等網路最多 NAV_TIMEOUT_MS:拿到最新就回最新;逾時/失敗先回快取,
//      但背景那筆 fetch 會繼續把快取更新到最新(下次載入就新),不讓慢網路把開場卡死。
//   ② 沒有快取(第一次載入)→ 只能等網路;離線就如實 throw(瀏覽器顯示無法連線,屬正常)。
//   ③ 寫快取用「去掉 query 的路徑」當 key → ?__afkfresh / ?cb 等變體不會在桶裡累積,離線退快取也用 ignoreSearch 找得到。
async function navFirst(e, req) {
  const cache = await caches.open(CODE_CACHE);
  const u = new URL(req.url);
  const putKey = u.origin + u.pathname;
  const netP = fetch(req).then((res) => {
    if (res && res.ok) cache.put(putKey, res.clone()).catch(() => {});
    return res;
  });
  e.waitUntil(netP.catch(() => {}));   // 背景抓取+寫快取確保跑完,不被 SW 提早回收

  const cached = await cache.match(req, { ignoreSearch: true })
              || await cache.match(putKey)
              || await cache.match('index.html')
              || await cache.match('./');
  if (!cached) return netP;            // 沒有墊底 → 等網路(離線會 throw,正常)

  const winner = await Promise.race([
    netP.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS)),
  ]);
  return (winner && winner.ok) ? winner : cached;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  const sameOrigin = url.origin === self.location.origin;

  // 音檔(bgm/sfx)不攔截:<audio> 走 Range 串流,回應是 206、本來就進不了 Cache(cache.put 對 206 會
  //   reject,離線行為不變);讓它流經 SW 只會讓 SW 掛著長壽的 fetch 事件(BGM 一放就是整首)、無法閒置。
  if (sameOrigin && /\/assets\/(?:bgm|sfx)\//.test(url.pathname)) return;

  // 圖桶:同源 assets 圖
  if (sameOrigin && url.pathname.includes('/assets/')) {
    const assetCache = _assetCacheName(url.pathname);
    if (assetCache) e.respondWith(cacheFirst(req, assetCache));
    return;
  }

  // 導覽文件(整頁 navigate / 目錄 '/' / *.html)→ network-first:線上一律拿最新殼,離線退快取。
  const isNav = sameOrigin && (
    req.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    /\.html$/.test(url.pathname)
  );
  if (isNav) {
    e.respondWith(navFirst(e, req));
    return;
  }

  // 程式桶:js / css / manifest / PWA 圖示,以及外部 CDN → cache-first(帶 ?v= 版本號,換版即換 URL,不會被釘舊版)
  const isCodePath = sameOrigin && (
    /\.(?:js|css|webmanifest)$/.test(url.pathname) ||
    /pwa-icon[^/]*\.png$/.test(url.pathname)
  );
  if (isCodePath || EXTERNAL_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req, CODE_CACHE));
    return;
  }

  // 其餘(assets-manifest.json / version.json / 其它)→ 不攔截,直接走網路、永遠最新。
});
