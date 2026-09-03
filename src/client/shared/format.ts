// 把毫秒时长格式化成 m:ss 或 h:mm:ss（超过一小时时带小时位）。
export function formatTime(milliseconds: number | undefined): string {
  const totalSeconds = Math.max(0, Math.round((milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
