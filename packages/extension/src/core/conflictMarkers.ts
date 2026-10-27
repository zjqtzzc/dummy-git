/**
 * 文件里还有没有冲突标记：行首是 `<<<<<<<` 或 `>>>>>>>`（后面是空白、说明或行尾）。
 * `=======` 单独不算：Markdown 分隔线也是行首七个等号，真冲突一定还有头或尾。
 * 标记已解决前用它提醒用户。只看行首，正文里写着这几个字符的不算。
 */
export function hasConflictMarkers(text: string): boolean {
  return /^(?:<{7}|>{7})(?:\s|$)/m.test(text);
}
