---
name: sync-upstream
description: 把本 repo 同步到 pp771007/idle-lineage-class 最新版，鏡像 PP 完整成品後重套本地舊傭兵獎勵／招募／受僱政策、回城免費刷新、離線安全補丁與精靈傭兵技能例外，再重產 manifest、版本並測試。當使用者說「同步 PP」「同步上游」「更新上游」「跟進 PP」或 /sync-upstream 時使用。
---

# /sync-upstream — 同步 PP 上游並保留本地政策

本 repo 以 `pp771007/idle-lineage-class` 為直接上游。PP 已包含原作者 shines871 的新版內容與 PP 外掛；同步時先鏡像 PP 完整成品，再用可檢查、可重跑的補丁重套本地政策。不要再直接從 shines871 組裝本站。

## 固定保留的本地政策

1. 舊傭兵獎勵／招募／受僱規則：經驗分攤、無隊伍金幣／掉寶倍率、付費招募、可重複受僱、非安全區也可管理。
2. 離線安全：舊離線引擎嚴格獨占、首次遷移不補算、特殊副本禁止離線模擬。
3. 妖精傭兵不套 PP 的「只能使用當前屬性精靈魔法」限制。
4. 手機、平板與桌機全部隱藏非官方轉載橫幅，不保留版面高度。
5. 傭兵保留舊獎勵／招募／受僱政策，但每次進安全區免費自動更新戰力快照。

## 名詞

- **PP clone**：`upstream-checkpoint.json` 的 `localClone`，或本 repo 的 `upstream` remote。
- **BASE**：`upstream-checkpoint.json.syncedUpstreamCommit`。
- **TARGET**：`pp771007/idle-lineage-class` 的 `main` 最新 commit（或使用者指定）。

## 流程

1. `git fetch upstream --tags --prune`，取得 `TARGET=$(git rev-parse upstream/main)`；先檢查工作樹與 BASE..TARGET diff。
2. 用 detach worktree 或獨立 clone checkout TARGET。同步腳本讀工作樹，不能只 fetch 不 checkout。
3. `assets/`、`public/` 以 PP 為準完整鏡像；比對用 blob SHA，PP 已刪除的檔案本站也刪除。這兩個目錄不可放本站獨有檔。
4. 跑：

   ```text
   node scripts/sync-upstream.mjs <PP-worktree>
   ```

   腳本依序：

   - 鏡像 PP 的 `js/`、`css/`、根目錄 `afk-*.js`、`index.html`、`sw.js`、`wiki-checkpoint.json`
   - 保留本站 `afk-mobile-banner.js`、`afk-offline-owner.js`、`afk-merc-policy.js`
   - 在 PP 的 `afk-offline.js` 前注入 `scripts/local-policy-block.html`
   - 跑 `check-save-io.mjs`
   - 跑 `apply-core-patches.mjs`
   - 跑 `apply-policy-patches.mjs`
   - 跑 `apply-offline-safety-patches.mjs`
   - 重產 manifest、程式版本與 Service Worker 版本
   - 跑 smoke（CI 可用 `AFK_SKIP_SMOKE=1` 延後）

5. 補丁錨點找不到、存檔 I/O 基準改變或 smoke 失敗都必須停止；讀 PP 的實際 diff 後修補，不可略過。
6. 收尾至少跑：

   ```text
   node scripts/check-save-io.mjs
   node scripts/apply-core-patches.mjs --check
   node scripts/apply-policy-patches.mjs --check
   node scripts/apply-offline-safety-patches.mjs --check
   node scripts/stamp-code-versions.mjs --check
   node scripts/smoke-hooks.mjs
   node scripts/test-save-compat.mjs <測試存檔...>
   ```

7. 人工檢查 PP index/DOM 變動、手機版、傭兵與離線提示；確認本地政策以外的 `js/`、`css/`、`afk-*.js` 與 PP 一致。
8. commit 後推同步分支並建立 PR。GitHub Actions 也只建立 PR；人工 review、測試、合併後才由 Pages workflow 部署，禁止同步流程直接推正式站。

## 判準

- 「PP 也是這樣」的結論必須註明已 fetch 的 TARGET SHA。
- PP 若再次改傭兵、離線、存檔或 index 載入順序，要逐項重驗三條本地政策。
- 原作者 shines871 僅作 PP 來源追溯；本站日常同步來源固定是 PP。
