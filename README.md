# 每日消息 V2

关键词订阅式资讯采集。每天自动抓取指定关键词的最新消息、抓回原文全文与配图、AI 提炼成当日简报，
按关键词分页在网页上阅读。**不依赖任何本地设备开机。**

上游文档：`每日消息V2-需求文档` (V2.1) / `每日消息V2-后端需求文档` (1.1) / `每日消息V2-前端需求文档` (1.1)

---

## 与 V1 的关系

V1（Windows 本地脚本 + 任务计划程序 + 输出 docx/pptx 到文件夹）已于 2026-09-09 **整体废弃并删除**。
V2 是产品形态的替换，不是升级：运行位置、数据模型、AI 方案、产出形式全部不同。

V1 唯一被保留下来的是三段实战验证过的逻辑，现在活在 `worker/discovery/gnews.py` 里
（Google News 跳转解码、中文填充词剥离、按 pubDate 过滤而不用会被限流的 `when:1d` 算符）。

---

## 架构

三个可独立部署、彼此不直接调用的部分：

| 代号 | 名称 | 技术 | 部署位置 |
|---|---|---|---|
| **W** | 采集 Worker | Python 3.11 + Scrapling | GitHub Actions |
| **A** | 应用 API | Next.js Route Handlers | Vercel（与前端同一部署） |
| **D** | 数据层 | Supabase Postgres + Storage，配图放 Cloudflare R2 | Supabase / Cloudflare |

W 和 A 只通过数据库和对象存储通信。前端**不直连数据库**（原因见后端文档 §1.1）。

---

## 目录

```
每日消息V2/
├── db/schema.sql              # 数据库结构，Supabase SQL Editor 里整段执行
├── shared/types.ts            # 前后端唯一契约，前端复制到 lib/types.ts
├── worker/                    # 采集 Worker (W)
│   ├── config.py              # 环境变量 + 全局常量
│   ├── models.py              # Candidate / FetchResult / DigestDraft ...
│   ├── dedupe.py              # URL 规范化 + hash
│   ├── discovery/             # 发现层
│   │   ├── rss.py             # ✅ 已实现（主力）
│   │   ├── gnews.py           # ✅ 已实现（含 V1 保留逻辑）
│   │   ├── listing.py         # ⬜ 未实现（依赖 fetcher.py）
│   │   └── websearch.py       # ⬜ 未实现（排期判断已实现）
│   └── requirements.txt
├── .github/workflows/collect.yml   # 每天 UTC 00:00 = 马来西亚 08:00
└── .env.example
```

---

## 开工前需要准备的外部服务

代码可以先写，但**跑不起来**，除非这些就位：

1. **Supabase 项目** —— 建好后在 SQL Editor 执行 `db/schema.sql`；再建两个 bucket：`fulltext`、`exports`（都不要开公开访问）
2. **Cloudflare R2** —— 建一个 `images` bucket，拿 S3 兼容 API 的 access key
3. **GitHub 仓库** —— 本目录推上去；Secrets 里填 `.env.example` 里 W 那一段
4. **Vercel** —— 部署前端 + API，环境变量填 A 那一段
5. **Anthropic API Key** —— V2 明确使用付费 API（Haiku 预筛 + Sonnet 提炼）

> V1 走的是「零成本、不用 AI」路线，V2 不是。这是文档层面已确认的决策，不是遗漏。

---

## 本地开发

```bash
# Worker 依赖
pip install -r worker/requirements.txt
scrapling install            # 下载 Playwright / Camoufox

# 只跑一个关键词（需要 Supabase 就位）
python -m worker.main run --keyword <slug> --force
```

发现层不依赖数据库，可以单独验证：

```python
from worker.discovery import discover_all
from datetime import date
discover_all([{"type": "rss", "url": "https://hnrss.org/newest?q=AI+agent",
               "allow_fulltext": True}], date.today(), 20)
```

---

## 已知成本项

**Google News 解跳转每条约 4.5 秒**（2026-09-09 实测）。`gnewsdecoder` 的 `interval` 参数只是额外
sleep，解码本身要多次往返 Google。一个 feed 约 100 条，全解要 7 分多钟。

因此 `gnews.py` 里设了 `GNEWS_DECODE_LIMIT = 10`，并且**先按 pubDate 排序截断、再解码**。
调高这个值之前，按 4.5 秒/条重新核算整个 run 的耗时（GitHub Actions job 上限 40 分钟）。

这也符合 V2 主文档 §7.1 的定位：gnews 是广度补充，主力应该是定向 RSS。

---

## 实现进度

| 部分 | 状态 |
|---|---|
| 数据库结构 | ✅ 写完，待在 Supabase 执行 |
| 前后端契约类型 | ✅ 写完 |
| Worker · 发现层 rss / gnews | ✅ 写完并实测通过 |
| Worker · 去重 | ✅ 写完并实测通过 |
| Worker · 发现层 listing / websearch | ⬜ |
| Worker · 抓取层（三级火箭） | ⬜ |
| Worker · 配图下载压缩 | ⬜ |
| Worker · AI 提炼 | ⬜ |
| Worker · 写库 / 清理 | ⬜ |
| 存储适配层（Supabase + R2 路由） | ⬜ |
| 应用 API (A) 18 个接口 | ⬜ |
| 前端 9 个路由 | ⬜ |
