# 雲端每日簽到 / 請假系統（新版資料夾）


## 資料夾結構

- `public/index.html`：每日簽到 / 請假頁
- `public/admin.html`：管理者請假審核頁
- `src/index.js`：Cloudflare Worker API
- `schema.sql`：D1 資料表
- `wrangler.json`：Cloudflare 部署設定

## 網址

部署後：
- 一般頁：`/`
- 管理員頁：`/admin`（或 `/admin.html`）

## 部署前要確認

1. `wrangler.json` 的 `database_id` 已填入你的 D1 Database ID。
2. D1 已執行 `schema.sql`。
3. 已設定 `ADMIN_PASSWORD` Secret。
4. Worker 的 D1 binding 名稱必須是 `DB`。

## 重要

`public/index.html` 的個人簽到進度會保存在該瀏覽器的 localStorage；
請假申請與審核資料則會透過 `/api/*` 寫入 Cloudflare D1，管理員可跨裝置查看與審核。
