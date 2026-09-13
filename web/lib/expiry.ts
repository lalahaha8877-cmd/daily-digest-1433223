/**
 * 到期提醒的提前量：内容还剩多少天被清理时开始提示。
 *
 * 文档没有规定这个值（整个到期提醒都是文档外新增，见 shared/types.ts
 * 文件头第 3 条）。做成环境变量而不是写死，是因为合适的提前量取决于
 * 用户多久打开一次网页 —— 每天看的人 3 天就够，一周看一次的人需要 10 天
 * 才不会错过。
 *
 * 默认 7 天：按「至少每周打开一次」的使用节奏，保证不会有内容在两次
 * 访问之间被无声删掉。
 */
export const EXPIRY_WARN_DAYS = (() => {
  const raw = Number(process.env.EXPIRY_WARN_DAYS)
  if (!Number.isFinite(raw) || raw < 1) return 7
  return Math.min(Math.floor(raw), 3650)
})()
