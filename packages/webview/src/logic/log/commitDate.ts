/**
 * 提交列表的日期（需求第 1 阶段）：作者时间；一小时以内写「多久之前」，更早的写
 * 年月日加时分（本地时间）。界面文字英文。
 *
 * `at` 与 `now` 都是秒。`now` 由调用方传入，便于测试。
 */
export function formatCommitDate(at: number, now: number): string {
  const seconds = now - at;
  // 未来的时间（机器之间时钟不同步）按绝对时间写，不写「-3 minutes ago」。
  if (seconds >= 0 && seconds < 60) return "just now";
  if (seconds >= 60 && seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  const date = new Date(at * 1000);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
}
