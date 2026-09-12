# 每日消息 V2 —— 交接总结

最后更新：2026-09-12　项目根目录：`C:\Users\USER\Desktop\每日消息V2`

---

## 目标

用户输入若干**关键词**，系统每天自动上网找这些关键词的最新消息，抓回原文全文与配图、
存档，按关键词分页在网页上阅读。**不依赖用户任何设备开机**，且当前目标是**全程零成本**。

需求来源三份文档（均在 `C:\Users\USER\Downloads\`）：

- `每日消息V2-需求文档.md`（V2.1）—— 主文档
- `每日消息V2-后端需求文档.md`（1.1）—— 数据库/Worker/API
- `每日消息V2-前端需求文档.md`（1.1）—— 设计系统/路由/组件

V2 **取代**了 V1（`每日消息自动化 V1.0`）。V1 是跑在本机的 Python 脚本 + Windows
任务计划程序，输出 docx/pptx 到文件夹，已于 2026-09-09 整体删除。

---

## 已完成

### 一、旧项目清理（V1）

- 删除 `C:\Users\USER\Desktop\每日要点` 全部内容（21 个文件 / 537 KB，含代码和 4 天产出）
- 注销 Windows 计划任务「每日消息自动化」，已复查确认移除
- 残留一个**空文件夹壳**删不掉（被后台进程占句柄），数据已清零，可手动删

删除前抽存了三段实战验证过的逻辑，现活在 `worker/discovery/gnews.py`：
Google News 跳转解码、中文填充词剥离、按 pubDate 过滤。

### 二、采集 Worker（Python，全部完成）

| 文件 | 内容 |
|---|---|
| `worker/config.py` | 环境变量与全局常量；`AI_ENABLED`、`IMAGES_BACKEND` 两个关键开关 |
| `worker/models.py` | `Candidate` / `FetchResult` / `ImageMeta` / `DigestDraft` / `RunResult` |
| `worker/dedupe.py` | URL 规范化（剥 utm_/fbclid 等）+ sha256 |
| `worker/store.py` | ObjectStore 适配层，按 bucket 路由到 Supabase 或 R2；全文 gzip 约定 |
| `worker/db.py` | Supabase 读写；`claim_run` 靠部分唯一索引做同日幂等 |
| `worker/extract.py` | trafilatura 优先、readability 兜底；同时产出正文 HTML 供找图 |
| `worker/images.py` | 配图下载→过滤→WebP 压缩→上传→占位符替换，失败粒度到单张 |
| `worker/fetcher.py` | 三级火箭 + 同域限速 2 秒 + robots.txt 检查（禁止则不升级档位） |
| `worker/distill.py` | Haiku 预筛 + Sonnet 提炼；含 `mechanical_digest()` 无 AI 回退 |
| `worker/cleanup.py` | L2 全文与配图同期清理、L3 导出过期；收藏豁免 |
| `worker/pipeline.py` | 按后端文档 §4.10 的写库顺序编排 |
| `worker/main.py` | CLI（`run` / `cleanup`），单关键词异常不传播到循环外 |
| `worker/discovery/` | 四个源全部实现：`rss` `gnews` `listing` `websearch` |
| `worker/logging_setup.py` | stdout 日志 + 密钥兜底掩码 |

### 三、阅读端（Next.js 16 + TypeScript + Tailwind，位于 `web/`）

| 路由 | 说明 |
|---|---|
| `/login` | 整站单口令登录 |
| `/` | 关键词总览（状态点、未读角标、简报数） |
| `/k/[slug]` | 时间线，一天一张卡 |
| `/k/[slug]/[date]` | 简报详情（要点 + 条目列表） |
| `/k/[slug]/[date]/full` | **完整稿** —— 本次新增，见下 |
| `/item/[id]` | 单篇全文存档 |
| `/status` | 运行状态（最近 30 天） |

支撑文件：`web/lib/{supabase,auth,queries,types}.ts`、
`web/components/{MarkdownView,ui}.tsx`、`web/middleware.ts`、
`web/app/api/auth/{login,logout}/route.ts`

**完整稿页**是本轮的重点新增：没有 AI 提炼时简报只剩标题，价值必须落在
「能读到全文」上。该页把当天所有条目的存档正文按顺序铺在一页，含配图、
超过 2 篇时自动生成目录、没抓到全文的条目单独归到页尾。

### 四、其他

- `db/schema.sql` —— 5 张表 + 枚举 + 部分唯一索引 + RLS 全开无策略，可重复执行
- `shared/types.ts` —— 前后端唯一契约，`web/lib/types.ts` 是它的副本
- `scripts/check_setup.py` —— 配置自检，真连上去查表/查 bucket/调模型
- `.github/workflows/collect.yml` —— 每天 UTC 00:00（马来西亚 08:00）+ 手动触发
- 配置清单（可勾选、进度自动保存）：
  https://claude.ai/code/artifact/83d239bf-3e8b-43a1-8a4c-b5a7b8421dbc

git 历史共 6 次提交，最新 `09e15ee`。分支名是 **`master`**（推 GitHub 前需要
`git branch -M main`）。

---

## 关键决策与原因

### 1. 放弃 Cloudflare R2，配图改存 Supabase

**起因**：R2 开通要绑支付卡，用户不接受。

**核算后发现根本不需要它**。后端文档 §3 选 R2 的理由是配图「约 2.2 GB/年，
不到半年挤爆 Supabase 的 1 GB」，但那是**年累计**数字，而同一份文档的 §8.2 L2
又规定配图与全文同期清理（默认 90 天）。按 90 天保留算**稳态**：

| 关键词数 | 稳态占用 |
|---|---|
| 1 个 | 53 MB |
| 3 个 | 158 MB |
| 10 个 | 527 MB |

都在 1 GB 以内。**文档的结论与它自己的保留策略相互矛盾。**

**做法**：`IMAGES_BACKEND` 环境变量（`supabase` 默认 / `r2`），`store.get_store()`
按它路由，只有选 `r2` 时才要求 R2 密钥。架构本就为此设计（"只改路由表，不改业务代码"）。
**切回 R2 只需改一个环境变量**，但旧图需自行搬迁。

### 2. 新增 `AI_ENABLED` 开关，当前关闭

**起因**：用户要全程免费，不想为 Anthropic API 付费。

AI 在流水线里只做两件事：预筛（滤垃圾）和提炼（合并成带出处的要点）。其余环节
（发现、去重、抓全文、抓配图、存档、清理）**全都不需要它**。

关掉后 `distill()` 改走 `mechanical_digest()`：按文章标题机械生成简报。要点仍绑定
`item_id`，前端「点要点跳出处」照常可用；数据结构是完整的 V2，只是内容质量约等于 V1。

**关键点：全文照常归档**，所以以后想开 AI，可以拿存档**重新生成历史简报**，不用重抓。

成本参考（若改主意）：1 个关键词每次 3 条约 **$0.73/月**，$5 能用约 7 个月。

### 3. gnews 源设了低解码上限

实测**每条解跳转约 4.5 秒**（不是文档假设的 1 秒 —— `interval` 参数只是额外 sleep，
解码本身要多次往返 Google）。一个 feed 约 100 条，全解要 7 分多钟。

**做法**：先按 pubDate 排序截断、再解码，并设 `GNEWS_DECODE_LIMIT = 10`。
这也符合主文档 §7.1 的定位：gnews 是广度补充，主力应是定向 RSS。
调高前按 4.5 秒/条重算整个 run 的耗时（Actions job 上限 40 分钟）。

### 4. 契约字段的两处偏差（已在 `shared/types.ts` 顶部标注）

- **已补** `RunRecord.created_at`：§7 未列出，但 §5.2 的「僵死 run 超 45 分钟显示为
  failed」规则必须用它（queued 状态没有 `started_at`）。标为可选字段。
- **未补** `runs.images_ok` / `images_failed`：表里有，§7 未列。状态页暂不显示。
  要显示应先在**文档层面**加进契约，不由任何一边单方面加。

### 5. 计划任务不要「最高权限」

V1 时代按文档写了 `HighestAvailable`，注册报 `Access is denied` —— 注册要求提权的
任务本身就需要管理员身份。脚本只读 RSS、只写自己的文件夹，降成 `LeastPrivilege`
即注册成功，也更符合最小权限。

---

## 当前状态

### 能用到什么程度

**采集端已完整跑通，用真实数据验证过**（2026-09-12）：

```
discovery: 16 候选 → dedupe: 16 新条目 → 已写入 4 条 items
robots.txt 禁止抓取，跳过 arstechnica.com/...（2 条）
fetch: ok=2 failed=0，配图 ok=0 failed=0
AI 已关闭，按标题机械生成简报
distill: 4 条要点，tokens in=0 out=0
done status=ok
```

**0 tokens，$0 花费。**

**阅读端已在本地跑通全链路**：浏览器里走通 登录 → 关键词 → 时间线 → 简报 → 完整稿，
TechCrunch 全文正常渲染，robots.txt 拒绝的条目正确显示为「未抓取（源站不允许）」。
`npm run build` 通过，7 个路由全部编译。

### 已验证 / 未验证

| 项 | 状态 |
|---|---|
| Supabase 5 张表 + 3 个 bucket | ✅ `check_setup.py` 全绿 |
| Worker 全流程（无 AI 模式） | ✅ 真实数据跑通 |
| 阅读端 7 个路由 | ✅ 本地跑通，真实数据渲染 |
| `npm run build` | ✅ 通过 |
| 配图抓取 | ⚠️ **未真正验证** —— 测试的两篇正文里没有合格配图 |
| AI 模式（预筛 + 提炼） | ⚠️ **从未跑过** —— 一直是关的 |
| GitHub Actions 定时触发 | ⚠️ **未验证** —— 仓库还没推 |
| Vercel 部署 | ⚠️ **未做** |
| 三级火箭的 dynamic / stealthy 档 | ⚠️ **未验证** —— 没跑 `scrapling install`，只有第一档在用 |

### 用户侧进度

配置清单里已勾：1.2 建表 SQL、1.3 建两个 bucket、1.4 抄 Supabase 凭据。
`images` bucket 也已建好（自检通过）。

---

## 踩过的坑

### 环境类

- **`python` 命令指向错误解释器**。PATH 里 MSYS2 的 `C:\msys64\ucrt64\bin\python.exe`
  排在前面，没装依赖。一律用 `py`，或写死
  `C:\Users\USER\AppData\Local\Programs\Python\Python313\python.exe`。
- **Windows 控制台默认不是 UTF-8**，脚本打印中文会 `UnicodeEncodeError` 崩在第一行输出。
  `check_setup.py` 已在开头 `sys.stdout.reconfigure(encoding="utf-8")`。新写脚本要照做。
- **8000 端口一度不可用**。Windows 把 `8000-8099` 划进了 Hyper-V/WSL 的 TCP 保留排除
  区间，报 `WinError 10013`。**这些区间每次重启都会漂移**（后来 8000 段又放开了）。
  排查命令 `netsh int ipv4 show excludedportrange protocol=tcp`。别把端口钉死在常用段。
- **PowerShell 脚本必须存 UTF-8 with BOM**，否则 5.1 按系统 ANSI 代码页解析，中文变乱码
  并直接语法报错。

### 方案类（试过，失败，别再走）

- **Claude Code 命令行做无头摘要 —— 彻底失败**。V1 时代试过 5 次不同方案（改写系统提示、
  显式禁止提问、验证过的工具禁用、`--json-schema` 强制、直接预声明"你没有联网能力"），
  模型**稳定地忽略已提供的素材、反复索取 WebSearch 授权**。这是产品层面的固有行为，
  提示工程压不住。不要再尝试用它替代 API。
- **Google News 的 `when:1d` 搜索算符不可靠**。大量请求后被静默降级：服务端把整个
  `"AI when:1d"` 当字面短语搜索，返回 0 条却仍是 HTTP 200，**脚本会误判为"今日无更新"**。
  已改为不带算符抓取、在 Python 侧按 `pubDate` 过滤。
- **`trafilatura` 的 `include_images` 不可全信**（主文档 §16 引用的 issue）。已改为
  自己从正文 HTML 解析 `<img>`，更可控。
- **HN 的 RSS 不适合当测试源**。`hnrss.org` 给的多是工具站和 SPA 页面，没有文章正文，
  抓取会全部因"正文不足 500 字"失败。测试和正式使用都该选有完整文章正文的站点。

### 安全类

- **用户曾把真实 Supabase 凭据填进 `.env.example`** —— 那是 git 跟踪的文件，而
  `service_role` 是数据库最高权限凭据。已查证**未进入任何提交**，已搬到 `.env`
  并把模板恢复成占位符 + 加了醒目提示。**填值认准 `.env`，不带 `.example`**。

---

## 下一步

- [ ] **决定是否先在本地多跑几天**，观察无 AI 模式下的内容质量够不够用
- [ ] **推 GitHub**：建**私有**仓库（公开仓库 60 天无活动会被静默停用定时工作流）
  - [ ] `git branch -M main`（当前分支是 `master`）
  - [ ] `git remote add origin ...` 然后 `git push -u origin main`
- [ ] **配 Actions Secrets**（只需三个）：`SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、
      `ANTHROPIC_API_KEY`（无 AI 模式下可留空）
  - [ ] 另在 Settings → Variables 加 `AI_ENABLED=false`
- [ ] **手动触发一次 Actions**，确认云端能跑通
- [ ] **Vercel 部署 `web/`**
  - [ ] Root Directory 设为 `web`
  - [ ] 环境变量：`SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`APP_PASSWORD`、
        `SESSION_SECRET`（32+ 字节随机串）
  - [ ] **`SUPABASE_SERVICE_KEY` 绝不能加 `NEXT_PUBLIC_` 前缀**
- [ ] **换掉测试关键词**：现在库里那条 `ai-agents` 是我插的测试数据，源是
      TechCrunch + Ars Technica，跟"AI Agent"其实不对题，按真实需求改 `sources` 和 `query`
- [ ] **验证配图链路**：找一篇正文带截图/diagram 的文章跑一次，确认 R2→Supabase 切换后
      图片能正常存取、完整稿页能显示
- [ ] （可选）`scrapling install` 下载浏览器，启用 dynamic / stealthy 两档抓取
- [ ] （可选）删掉桌面上那个空的 `每日要点` 文件夹壳
- [ ] （未做）后端文档 §6.2 的 18 个接口只实现了 auth 两个，其余（`/topics` CRUD、
      `/outlines/pending`、搜索、导出、collect 触发）都没写；前端也没有关键词管理、
      搜索、下载、"立即采集"按钮 —— 目前只能用 SQL 管关键词

---

## 需要注意的细节

### 路径

| 用途 | 路径 |
|---|---|
| 项目根 | `C:\Users\USER\Desktop\每日消息V2` |
| 真实 Python | `C:\Users\USER\AppData\Local\Programs\Python\Python313\python.exe` |
| 前端 | `web/`（Vercel 的 Root Directory 要设成这个） |
| 三份需求文档 | `C:\Users\USER\Downloads\每日消息V2-*.md` |

### 账号与配置

- Supabase 项目已建好，5 张表 + 3 个 bucket（`fulltext` / `exports` / `images`）齐全，
  **三个桶都不是 Public**
- Anthropic：**未开通**，当前不需要
- Cloudflare：**未开通**，当前不需要
- GitHub 仓库：**未建**
- Vercel：**未部署**

### 环境变量

`.env`（Worker 本地用，已 gitignore，当前内容）：

```
SUPABASE_URL=…
SUPABASE_SERVICE_KEY=…
IMAGES_BACKEND=supabase
AI_ENABLED=false
ANTHROPIC_API_KEY=        ← 空
```

`web/.env.local`（前端本地用，已 gitignore）：
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `APP_PASSWORD`（当前是 `dev-local-test`）/
`SESSION_SECRET`

### 命名约定（改动会破坏现有数据或代码）

- bucket 名写死在 `worker/config.py`：`fulltext` / `exports` / `images`
- 全文对象 key：`{keyword_slug}/{YYYY-MM}/{item_id}.md.gz`，**gzip 后写入**
- 配图 key：`{keyword_slug}/{YYYY-MM}/{item_id}/{index}.webp`
- 存档 Markdown 里图片写的是 `item-image://{index}` **占位符**，不是真实 URL
  （签名 URL 会过期）。读取时由 `web/lib/supabase.ts` 的
  `resolveImagePlaceholders()` 换成当次有效的签名 URL，TTL 3600 秒
- `keywords.slug` 不可改 —— 会破坏已有链接
- `shared/types.ts` 与 `web/lib/types.ts` **必须逐字一致**，改了要手动同步

### 容易忘的

- 本地调试反复重跑要带 `--force`，否则同日幂等会直接跳过
- 定时任务常有 **5–30 分钟延迟**，这是 GitHub 正常表现，代码里不假设精确触发时间
- 收藏（`is_starred`）**豁免一切清理**，会永久累积 —— 大量收藏会侵蚀存储余量
- 抓取合规已按文档做了：查 robots.txt、同域名间隔 2 秒、带可识别 UA。别为了提高
  成功率去掉这些
