/**
 * 刷新之后，说明框要不要动。
 *
 * `previous` 是上一停的身份。`undefined` 是还没读过，也没有存下来的身份。
 * 同一次停不改框里的字。第一次看见一停，或换到下一停，才换成准备好的说明。
 * 停结束了就清空。
 */
export enum MessageUpdate {
  Keep = "keep",
  Fill = "fill",
  Clear = "clear",
}

export function messageUpdate(
  previous: string | null | undefined,
  nextId: string | null,
): MessageUpdate {
  if (nextId === previous) return MessageUpdate.Keep;
  if (nextId === null) return previous === undefined ? MessageUpdate.Keep : MessageUpdate.Clear;
  return MessageUpdate.Fill;
}
