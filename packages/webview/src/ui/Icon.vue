<script setup lang="ts">
import { assertNever } from "@dummy-git/shared";
import { computed } from "vue";
import { ICON_STROKES, IconKind, type IconRef, IconSize } from "../logic/icons.js";

/**
 * 画一个图标：「是什么」（`icon`）与「多大」（`size`，默认 `Standard`）任意组合。
 * 颜色继承外面的 `color`。两种来源画法不同，对外一样：
 * - 自己画的 SVG：宽高等于尺寸，坐标系固定 16×16，按比例缩放；
 * - codicon 字体：字号等于尺寸，外面套一个同样大小的方框，和 SVG 占位一致；
 * - Seti 字体：同样大小的方框，字号放大到 150%（见样式里的说明），颜色用它自带的。
 */
const props = withDefaults(defineProps<{ icon: IconRef; size?: IconSize }>(), {
  size: IconSize.Standard,
});

/** 用途 → 像素。新用途在这里加一档。 */
const SIZE_PX: Readonly<Record<IconSize, number>> = {
  [IconSize.Standard]: 16,
  [IconSize.Inline]: 12,
};

/** 虚线的「实 空」长度。太密会看起来和实线差不多。 */
const DASH = "3 2";

const px = computed(() => SIZE_PX[props.size]);

/** 字体图标的方框与字号。 */
const box = computed(() => ({ width: `${px.value}px`, height: `${px.value}px` }));

/** codicon 的类名（只在 codicon 时用到）。 */
function codiconClass(icon: IconRef): string {
  switch (icon.kind) {
    case IconKind.Codicon:
      return `codicon-${icon.name}`;
    case IconKind.App:
    case IconKind.Seti:
      return "";
    default:
      return assertNever(icon, "codiconClass");
  }
}
</script>

<template>
  <svg
    v-if="icon.kind === IconKind.App"
    class="glyph"
    :width="px"
    :height="px"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      v-for="(stroke, index) in ICON_STROKES[icon.name]"
      :key="index"
      :d="stroke.d"
      :stroke-dasharray="stroke.dashed ? DASH : undefined"
    />
  </svg>
  <span
    v-else-if="icon.kind === IconKind.Codicon"
    :class="['glyph', 'codicon', codiconClass(icon)]"
    :style="{ ...box, fontSize: `${px}px` }"
    aria-hidden="true"
  />
  <span
    v-else
    class="glyph seti"
    :style="{ ...box, fontSize: `${px * 1.5}px`, color: icon.color }"
    aria-hidden="true"
    >{{ icon.char }}</span
  >
</template>

<style scoped>
/*
 * 类名不用 `icon`：子组件的根元素会带上父组件的局部样式标记，父组件里的 `.icon` 规则会落到这里。
 * 不接收鼠标：Chromium 在内联 SVG 上悬停时不显示外层元素的 `title`，
 * 让鼠标落到外层（比如按钮）上，提示文字才出得来。
 */
.glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  pointer-events: none;
}
/*
 * Seti 图标：
 * - 方框里 flex 居中，行高 1；字形上下位置不靠行高去撑；
 * - 字号 150%：Seti 主题文件的规定，字形四周留了空白，放大后才和资源管理器里一样大；
 * - 灰度抗锯齿：macOS 默认的次像素抗锯齿会让图标字体发粗，VS Code 同样关掉了它。
 */
.seti {
  font-family: "seti", sans-serif;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
