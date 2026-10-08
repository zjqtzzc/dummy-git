/**
 * 时间的统一写法（Log 的日期列、Stash 列表等共用）：
 * - 一小时以内写「多久之前」（`just now`、`5 minutes ago`）；
 * - 今天更早的写 `Today 11:23`；
 * - 更早的写年月日加时分 `2026/9/20 09:05`（月日不补零，时分补零）。
 *
 * 本地时区。界面文字英文。`at` 与 `now` 都是 unix 秒，`now` 由调用方传入，便于测试。
 */
export function formatTime(at: number, now: number): string {
  const seconds = now - at;
  // 未来的时间（机器之间时钟不同步）按绝对时间写，不写「-3 minutes ago」。
  if (seconds >= 0 && seconds < 60) return "just now";
  if (seconds >= 60 && seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  const date = new Date(at * 1000);
  const today = new Date(now * 1000);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === today.toDateString()) return `Today ${time}`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
