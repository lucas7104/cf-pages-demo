# cf-pages-demo：公開版 / 管理版 分成兩個 workers.dev

## 架構
- 公開版 Worker：`cf-pages-demo`
  - 網址：`https://cf-pages-demo.<你的 workers.dev 子網域>.workers.dev`
  - 靜態檔：`site-public/`
- 管理版 Worker：`cf-pages-demo-admin`
  - 網址：`https://cf-pages-demo-admin.<你的 workers.dev 子網域>.workers.dev`
  - 靜態檔：`site-admin/`
  - 只在這個 Worker 開啟 Cloudflare Access

## 檔案說明
- `site-public/index.html`
- `site-public/search.html`
- `site-public/orders-public.json`
- `site-admin/index.html`
- `site-admin/search.html`
- `site-admin/orders.json`
- `site-admin/vip.json`
- `scripts/sync-google-sheet.mjs`
- `wrangler.public.jsonc`
- `wrangler.admin.jsonc`

## 第一次安裝
```bash
npm install
npx wrangler login
```

## 同步資料
```bash
npm run sync
```

同步後會產生：
- `site-public/orders-public.json`
- `site-admin/orders.json`
- `site-admin/vip.json`

## 部署公開版
```bash
npm run deploy:public
```

## 部署管理版
```bash
npm run deploy:admin
```

## 一次部署兩個
```bash
npm run deploy:all
```

## Cloudflare 後台要做的事
### 1. 公開版 Worker
- 到 `Workers & Pages` → `cf-pages-demo`
- `Settings` → `Domains & Routes`
- 確認 `workers.dev` 是啟用狀態
- **不要** 對公開版開啟 Cloudflare Access

### 2. 管理版 Worker
- 到 `Workers & Pages` → `cf-pages-demo-admin`
- `Settings` → `Domains & Routes`
- 對 `workers.dev` 點 `Enable Cloudflare Access`
- 再點 `Manage Cloudflare Access`
- Policy 設定：
  - Action：`Allow`
  - Include：`Emails`
  - 輸入允許的完整信箱

### 3. 如果你之前把公開版鎖住了
- 到 `Workers & Pages` → `cf-pages-demo`
- `Settings` → `Domains & Routes`
- 在 `workers.dev` 那一列按 `Disable Cloudflare Access` 或移除既有 Access 保護

## 建議網址
- 公開版給客人：`https://cf-pages-demo.<subdomain>.workers.dev`
- 管理版自己用：`https://cf-pages-demo-admin.<subdomain>.workers.dev`

## 注意
- 管理版已經是獨立站，所以 `site-admin` 裡的 `index.html` 和 `search.html` 都在根目錄，不再使用 `/admin/...` 路徑。
- 公開版不應包含 `orders.json`、`vip.json` 這類管理資料。
