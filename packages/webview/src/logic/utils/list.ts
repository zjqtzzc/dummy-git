/** 内容没变就沿用上一次的数组：下游看到的是同一个对象，`computed` 不会跟着重算。 */
export function keepIfSame<T>(
  previous: readonly T[] | undefined,
  next: readonly T[],
  same: (a: T, b: T) => boolean = (a, b) => a === b,
): readonly T[] {
  if (previous === undefined || previous.length !== next.length) return next;
  return previous.every((item, i) => {
    const other = next.at(i);
    return other !== undefined && same(item, other);
  })
    ? previous
    : next;
}
