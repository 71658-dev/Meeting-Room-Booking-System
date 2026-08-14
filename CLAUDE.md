# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

新竹市衛生局會議室預約管理系統 **v2.0**。Cloudflare Worker + Hono 後端、Preact 前端、Cloudflare D1 (SQLite) 為系統資料庫，KV 只放有 TTL 的暫存。以 Vite 建置，TypeScript 前後端共用。

v1（單檔 `src/index.js` + 純 ES Module 前端 + 單一 KV blob）已完全汰除。若在舊文件或 `垃圾桶/` 看到 `all_app_data`、`STORAGE_KEYS`、`escapeHtml()` 手動跳脫、inline `onclick` 等描述，那是 v1 的遺物，不適用於現行程式碼。

線上環境：
- dev: https://meeting-room-booking-system-dev.71658.workers.dev
- prod: https://meeting-room-booking-system.71658.workers.dev

重寫的完整決策脈絡見 `REWRITE_PLAN.md`（含威脅模型、schema 草案、分階段計畫）。**該檔與 `SECURITY_REPORT.md` 都不得推送至公開 repo。**

## 常用指令

```bash
npm run dev          # vite build + wrangler dev（讀 .dev.vars）
npm run dev:client   # 只跑 vite dev server（沒有後端 API）
npm run build        # vite build -> dist/
npx tsc --noEmit     # 型別檢查（build 不做，必須另外跑）
npm run deploy:dev   # build + wrangler deploy --env development
npm run deploy:prod  # build + wrangler deploy --env ""（top-level 即 prod）
```

**`npm run build` 不做型別檢查**（Vite 只做 transpile）。改完後端一定要另外跑 `npx tsc --noEmit`，否則型別錯誤會直接進到部署。

**不要在 `wrangler dev` 執行中的情況下另外跑 `vite build`。** Cloudflare Assets 只在 dev server *啟動時*掃描 `dist/` 建立資產清單，而 Vite 的 `emptyOutDir` 會清掉舊檔並寫入帶新內容雜湊的檔名。結果是 `index.html`（路徑不變、每次重讀磁碟）給出新版 HTML，但它引用的 `assets/index-<hash>.js` 不在清單裡而回 404——看起來像建置壞掉，其實檔案好好躺在磁碟上。改完前端要重啟 `npm run dev`（它本來就會先 build 再起 server）。

後端改動則會被 wrangler 熱重載，不需要重啟。

## 架構重點

### 後端：`src/server/`，Hono 路由

`src/server/index.ts` 掛載九個資源導向 route 模組。請求管線的順序有意義：

1. 安全標頭（含 CSP）
2. Schema bootstrap — 以 module 層 `schemaReady` 旗標快取，每個 isolate 只查一次
3. `csrfMiddleware` — 所有 `/api/*` 的非安全方法都要通過 Origin/Referer 比對
4. 各 route 模組
5. `/api/*` 未命中 → 明確 404（**不可**讓它掉到靜態資產 fallback，POST 到那裡會變成 500）
6. 其餘 → `env.ASSETS.fetch()`

實際存在的靜態檔案由 Cloudflare Assets 直接回應，**不會進入 Worker**，所以 `app.use('*')` 的安全標頭對它們無效——包括 HTML 文件本身。靜態資產的標頭定義在 `public/_headers`，內容需與 `index.ts` 的 CSP 保持一致。

`vite.config.ts` 的 `root` 是 `src/client`，因此 **`publicDir` 必須明確指向專案根目錄的 `public/`**。少了這行，Vite 會去找 `src/client/public`（不存在），`_headers` 與 `security.txt` 就不會進 `dist/`，結果是網站主頁完全沒有 CSP 卻毫無徵兆。改動建置設定後請實際 `curl -I` 確認標頭有送出。

v1 的相容端點（`/api/data`、`/api/login`、`/api/send-email`）已移除。其中兩個曾是實際漏洞：`GET /api/data` 未認證就回傳事由與登記人；`POST /api/send-email` 接受任意收件者與任意內容，等於用機關寄件網域的開放轉發器。

### 授權模型

**權限一律重查資料庫，不採信任何 token 內的宣告。** session 是不透明隨機 token，D1 `sessions` 表只存 `sha256(token)`。

- `authMiddleware` — 取 cookie（或 Bearer）→ 查 session + user → 塞進 context。它**同時**組合了 `requirePasswordChangeComplete`，所以 `must_change_password` 的強制在伺服器端無法繞過
- `requireRole(...roles)` — 角色閘門
- 角色來源是 `users.role` 欄位。**不要再引入工號硬編碼**（v2 早期版本有 `id === '99999' ? 'superadmin'`，已移除；那讓資料庫上的降權完全失效）

權限矩陣（`routes/users.ts`）：staff 只能改自己；admin 可改自己與 staff，不可指派 superadmin；superadmin 全權。變更角色或停權會即時撤銷該使用者所有 session。系統強制至少保留一位啟用中的 superadmin。

**`POST /api/users/:id/reset-password` 一律拒絕對自己執行**，superadmin 也不例外。那條路徑會回傳可用的一次性密碼並撤銷該帳號所有 session；開放自助等於讓一枚被竊的 session cookie 直接換成永久接管（拿到臨時密碼 → 登入順便把正主踢掉 → 改密碼），繞開 `/api/auth/password` 的舊密碼驗證。本人要改密碼走 `/api/auth/password`，那條有正確要求舊密碼。前端 `AdminConsole.canResetPasswordRow()` 同步隱藏按鈕，但真正的閘門在伺服器。

superadmin bootstrap 建立的帳號 `must_change_password = 1`：`SUPERADMIN_DEFAULT_PASSWORD` 是第一次登入的遞送方式，不是密碼。不設 `password_expires_at`——這個帳號沒有別人能幫它重發。

### 資料庫：D1

Schema 見 `migrations/`。**`src/db/seed.sql` 與 `index.ts` 的 bootstrap 都只放參考資料（科室／會議室／設備），永遠不建帳號。** seed.sql 曾經硬編碼 `99999`／`71658`／`88888` 三組帳號，密碼是可猜的字串、雜湊是無鹽 SHA-256、明文就寫在註解裡，而這個 repo 是 public。因為相容驗證鏈刻意保留 64 位 hex 格式，那些雜湊是**還能用的憑證**，不是失效的歷史殘留。帳號只能由 `SUPERADMIN_DEFAULT_PASSWORD` 閘門的 bootstrap 或已認證管理者的 `POST /api/users` 產生。

要點：

- **時間存當日分鐘數整數**（`start_min` / `end_min`），不是 `"08:30"` 字串。字串比較在排序與跨日會出事
- **預約軟刪除**（`status`），取消紀錄要保留供稽核
- `reservation_equipment` 是關聯表，不是 JSON 欄位
- 所有寫入操作都要寫 `audit_log`（含 before/after）

**稽核快照不可整列丟進去。** `audit_log` 沒有保存期限、沒有比 superadmin 更細的分級，而 `GET /api/audit` 是整列回給前端——寫進去等於複製到一個活得更久、讀取面更寬的地方。`routes/users.ts` 因此用 `AUDITABLE_USER_FIELDS` 白名單建快照（`SELECT *` 會帶出 `password_hash`、`password_expires_at`），`middleware/audit.ts` 的 `redactSensitive()` 則是下一個伸手拿 `SELECT *` 的路由的兜底。這不是假設：舊版 `PATCH /api/users/:id` 每改一次使用者就把該帳號的密碼雜湊寫進 `before_json`；對還在舊格式（無鹽 SHA-256）的帳號，那是離線幾秒就能還原的憑證。

**伺服器端衝突檢查是這套系統的核心業務規則**（v1 完全沒有，只在瀏覽器做）。`routes/reservations.ts` 的 POST/PATCH 都必須做時間重疊查詢並回 409。條件是 `既有.start_min < 新的.end_min AND 既有.end_min > 新的.start_min`。

**檢查與寫入必須是同一條 SQL。** POST 用 `INSERT ... SELECT ... WHERE NOT EXISTS(重疊)`，PATCH 把同樣的 `NOT EXISTS` 掛在 `UPDATE ... WHERE` 上，再看 `meta.changes` 是否為 0 判斷是否撞到。先 SELECT 再 INSERT 兩條 statement 中間沒有交易，`reservations` 也沒有能兜底的 UNIQUE 約束，兩個併發請求會雙雙通過檢查、雙雙寫入——窗口只有一次 D1 往返那麼寬，但「兩個人同時搶同一間會議室」正是會瞄準它的流量。`findConflict()` 只在寫入已經被擋下之後才跑，用途是把贏的那筆的名字與時間放進錯誤訊息，它本身不是檢查。

**`GET /api/reservations` 刻意沒有預設時間窗**——不帶參數就是全部。StatsView 的總筆數與總時數是把回傳的每一列加起來，套預設窗不會讓報表變小，只會讓它安靜地變錯。`from`/`to` 是純過濾條件，有給才套。取而代之的是 `MAX_ROWS` 上限（遠高於任何實際總量）與回應中的 `truncated` 旗標：真的撞到上限時會明講，而不是回一份看起來完整的短名單。StatsView 收到 `truncated` 會顯示警示橫幅。這個端點原本被點名的讀取放大，是靠設備查詢改成單次 `IN (...)` 批次（N+1 → 2 次往返）解決的，不是靠拒答 UI 真正要問的問題。

**`/api/public/schedule` 則保留時間窗**（不帶參數是前後各 90 天，並限制單次跨度）。它未經認證，那是另一回事：在那裡「全部歷史」等於任何人都能免費撈走的機關使用紀錄。

**加一個欄位要同時改三個地方**，漏掉任何一個都不會有徵兆：

1. `migrations/` 加檔案
2. `index.ts` bootstrap 的 `CREATE TABLE` 同步加上欄位 — 這只影響**日後從零建立**的資料庫
3. `index.ts` 的 `ADDED_COLUMNS` 陣列加一筆

第 3 點是因為 bootstrap 用的是 `CREATE TABLE IF NOT EXISTS`：對已存在該表的資料庫是 no-op，能補出缺少的**表**，但永遠無法把新**欄位**補進既有的表。所以只做 1+2 的話，既有資料庫會靜默缺欄位，直到第一個指名該欄位的 SQL 在執行期炸掉。

這不是假設性的：`users.password_expires_at`（migrations/0002）就沒進到 dev 資料庫，變更密碼／新增帳號／重置密碼三個功能在那邊全部回 500。`reconcileAddedColumns()` 逐筆 `PRAGMA table_info` 比對後補 `ALTER TABLE`，冪等，每個冷啟 isolate 跑一次。**`ADDED_COLUMNS` 裡的表名與欄名一律是字面常數，絕不可來自請求資料**（該處字串直接進 SQL）。

它的失敗是 log 而不是 throw：補不動欄位的 isolate 仍能服務所有沒碰到該欄位的路由，比讓全部路由回 500 好。對應測試在 `test/api.test.ts` 的 `schema column reconciliation`，做法是 `DROP COLUMN` 重現漂移再驗證補回。

### 密碼與 session

- `hashPasswordChain()` = **鏈式 PBKDF2 6×100k**（等效 600k）。Workers WebCrypto 對單次 `deriveBits` 有 100k 硬上限，所以串接六段、共用同一組 salt。格式 `pbkdf2c$sha256$6x100000$<saltB64>$<hashB64>` — 標明「鏈式」是刻意的，否則日後會被誤讀成單次 600k
- `verifyPasswordChain()` 是**向下相容驗證鏈**：`pbkdf2c` → `pbkdf2`(1×100k) → v2 動態鹽 → v1 靜態鹽 → 無鹽 SHA-256。命中舊格式時 `needsUpgrade = true`，登入成功後立即改寫。**移除任何一段都會鎖死既有帳號**（線上仍有 64 位 hex 格式的帳號）
- 密碼政策在 `auth/passwordPolicy.ts`，最小長度 12
- 一次性密碼 15 分鐘失效（`users.password_expires_at`），使用後強制立即變更
- 登入失敗鎖定是**帳號 + IP 雙軌**（`auth/lockout.ts`），KV 存計數。單軌 `ip+id` 複合鍵擋不住換 IP 重試
- 登入時對不存在的帳號也會跑一次雜湊（`TIMING_EQUALISATION_HASH`），避免用回應延遲枚舉工號

**session token 只透過 httpOnly cookie 傳遞，絕不放進回應主體。**

### 前端：`src/client/`，Preact + signals

JSX 預設跳脫，所以**不需要手動 escape**（v1 那套 `escapeHtml()` 紀律已經不適用）。相對地：

- 不要引入 `dangerouslySetInnerHTML`
- CSP 已移除 `'unsafe-inline'` 與 `'unsafe-eval'` 的 script-src。`style-src` 仍保留 `'unsafe-inline'`，因為少數元件用 style prop 設百分比寬度
- 狀態在 `state.ts`，是 `@preact/signals` 的 signal。讀寫都用 `.value`

未登入時只會渲染 `LoginView` 或 `PublicScheduleView`。其餘視圖都在登入後才掛載，所以需要認證的 API 不會在訪客情境被呼叫。

**公開排程走 `/api/public/schedule`（去識別化），不是 `/api/reservations`。** 這兩者是刻意分開的獨立端點——v1 用「同一端點依 token 有無回傳不同形狀」導致訪客拿到殘缺資料再回寫、毀損資料庫。不要把它們合併回去。

### 設定與密鑰

密鑰一律 `wrangler secret put`，不得寫進 `wrangler.json`（該檔已進版控）。

必要：`TURNSTILE_SECRET`、`SUPERADMIN_DEFAULT_PASSWORD`
選用：`BREVO_API_KEY` / `RESEND_API_KEY` / `SENDGRID_API_KEY`、`EMAIL_SENDER_ADDRESS`、`ALLOWED_EMAIL_DOMAINS`

`TURNSTILE_SITEKEY` 是公開值，放 `vars`，經 `/api/config` 給前端。

**未設定的密鑰一律 fail closed，不要加 fallback。** `TURNSTILE_SECRET` 沒設就回 503 拒絕登入——早期版本在此退回 Cloudflare 官方的 always-pass 測試金鑰，等於在尚未設定的環境（也就是 prod）把人機驗證變成裝飾品。

`.dev.vars`（gitignored）供本機開發。本機要測登入，請自行在 `.dev.vars` 放 Cloudflare 的測試 secret，而不是在程式碼裡加預設值。

top-level 設定即 production；`env.development` 是另一組 D1/KV 與 worker name。**兩個環境的密鑰必須各自獨立設定。**

### 郵件

`services/email.ts`：Brevo → Resend → SendGrid 三段 fallback。

- **三家都沒設定（或全部失敗）時回 `success: false`，不是模擬成功。** 舊版回 `success: true` + provider `'Simulation'`，於是漏設密鑰的環境——也就是剛部署的 prod——會告訴使用者「已寄出」，而信根本不存在。與 `TURNSTILE_SECRET` 同一條 fail closed 規則
- 所有內插進 HTML 的值都要經過 `escapeHtml()`（事由、備註、姓名都是使用者自由輸入）
- 收件人規則：**開頭有點 = 該網域與其所有子網域；沒有點 = 只有該網域本身**。預設 `.gov.tw`（整棵政府網域樹是刻意放行），`ALLOWED_EMAIL_DOMAINS` 設定的網域則是精確比對——舊版一律補上前置點，`partner.org.tw` 會連帶放行 `evil.partner.org.tw`。要放行子網域請自己寫前置點。信是從機關寄件網域發出的，不設限等於開放轉發
- 每人每小時 20 封、單次最多 50 位收件者。配額是 read-then-write，非原子，併發可小幅超出——與 `auth/lockout.ts` 同一個取捨
