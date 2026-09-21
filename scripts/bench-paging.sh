#!/usr/bin/env bash
# 三种取数方案的渐进行为对比。用合成仓库，不需要下载任何东西。
#
#   bash scripts/bench-paging.sh [提交数，默认 160000]
#
# ⚠️ 合成仓库**只能测形状，不能测绝对数字**：历史是线性的、没有 merge、
#    树只有一个文件。真实仓库的绝对耗时会高得多（见 NFR.md §0 的恢复办法）。
#    但「--skip 是不是 O(N)、游标式是不是 O(1)」这个问题它答得准。
set -euo pipefail
N=${1:-160000}
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
git init -q -b main "$DIR"
python3 - "$N" > "$DIR/stream.fi" <<'PY'
import sys
N=int(sys.argv[1]); print("reset refs/heads/main")
for i in range(N):
    msg=f"commit {i}\n"
    print("commit refs/heads/main"); print(f"mark :{i+1}")
    print(f"author A <a@b.c> {1700000000+i} +0000")
    print(f"committer A <a@b.c> {1700000000+i} +0000")
    print(f"data {len(msg)}"); print(msg,end="")
    if i: print(f"from :{i}")
    print(f"M 100644 inline f{i%50}.txt")
    b=f"v{i}\n"; print(f"data {len(b)}"); print(b,end="")
print("done")
PY
git -C "$DIR" fast-import --quiet < "$DIR/stream.fi"
FMT='%H%x00%P%x00%ct'
ms(){ local s e; s=$(date +%s%N); eval "$1" >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e-s)/1000000 )); }
cd "$DIR"; git log --format="$FMT" >/dev/null   # 预热
printf '\n提交数：%s\n\n① 全量骨架（模型 B 基线）\n' "$(git rev-list --count HEAD)"
printf '   %s ms\n\n② --skip=N --max-count=200\n' "$(ms "git log --all --date-order --format='$FMT'")"
for K in 0 $((N/16)) $((N/3)) $((N-10000)); do
  printf '   skip=%-7s %s ms\n' "$K" "$(ms "git log --skip=$K --max-count=200 --format='$FMT'")"
done
printf '\n③ 游标式（从第 N 条的 hash 继续）\n'
for K in 0 $((N/16)) $((N/3)) $((N-10000)); do
  H=$(git log --skip="$K" --max-count=1 --format=%H)
  printf '   深度=%-7s %s ms\n' "$K" "$(ms "git log $H --max-count=200 --format='$FMT'")"
done
echo
