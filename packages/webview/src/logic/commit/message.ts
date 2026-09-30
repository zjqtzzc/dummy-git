/**
 * 提交说明（`.notes/design/phase-2.md` 第二节第 7 条）：原样提交，只去掉首尾的空行。
 * 行内的空白、中间的空行都不动。
 */
export function commitMessage(text: string): string {
  const lines = text.split("\n");
  const blank = (line: string): boolean => line.trim() === "";
  let start = 0;
  while (start < lines.length && blank(lines[start] ?? "")) start++;
  let end = lines.length;
  while (end > start && blank(lines[end - 1] ?? "")) end--;
  return lines.slice(start, end).join("\n");
}

/** 只有空白也算空：这样的说明不能提交。 */
export function isBlankMessage(text: string): boolean {
  return text.trim() === "";
}
