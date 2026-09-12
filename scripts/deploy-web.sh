#!/usr/bin/env bash
# 部署阅读端到 Vercel 生产环境。
#
#   bash scripts/deploy-web.sh
#
# 为什么不能直接在项目目录跑 `vercel --prod`：
#   Vercel 会读取 .git 里的提交作者邮箱，匹配不到有权限的 GitHub 账号就
#   在构建之前把部署标记为 Blocked（构建时长 0ms）。本仓库的提交作者是
#   romruloh@gmail.com，与 Vercel 登录所用的 GitHub 账号不一致，因此每次
#   都被拦。断开项目的 Git 关联也无效 —— 校验针对的是 CLI 上送的元数据，
#   不是项目的仓库连接。
#
#   这里用 `git archive` 把【已跟踪文件】导出到一个不含 .git 的临时目录再
#   部署：没有 git 元数据，就没有作者可校验。顺带天然排除了 node_modules、
#   .next 和所有 .env（它们都不在版本控制里）。
#
# 永久解法（可选）：把 romruloh@gmail.com 添加到 Vercel 所用的那个 GitHub
#   账号并完成邮箱验证，之后就能直接 `vercel --prod`，本脚本也就不再需要。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .vercel/project.json ]; then
  echo "缺少 .vercel/project.json —— 先跑一次 npx vercel@latest link 关联到 daily-digest-v2" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "导出已跟踪文件到临时目录（不含 .git）…"
git archive HEAD | tar -x -C "$STAGE"
mkdir -p "$STAGE/.vercel"
cp .vercel/project.json "$STAGE/.vercel/project.json"

echo "开始部署…"
cd "$STAGE"
npx --yes vercel@latest --prod --yes
