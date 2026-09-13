/**
 * run_date / digest_date 是 date 类型，必须按**用户时区**计算。
 * 对应后端需求文档 §4.4：数据库全用 timestamptz(UTC)，但这两个日期是
 * 「用户视角的今天」—— 直接用 UTC 算，在 UTC 00:00 触发时会算成前一天。
 *
 * Worker 侧的对应实现是 worker/config.py 的 USER_TZ + datetime.now(USER_TZ).date()，
 * 两边必须得出同一个日期，否则手动触发建的 run 和 Worker 认的日期对不上，
 * 同日幂等会失效。
 */
const USER_TZ = process.env.USER_TZ || 'Asia/Kuala_Lumpur'

/** 用户时区的今天，YYYY-MM-DD。 */
export function todayInUserTz(): string {
  // en-CA 的 short 日期格式就是 YYYY-MM-DD，省掉手工拼装
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
