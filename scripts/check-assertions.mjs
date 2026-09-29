#!/usr/bin/env node
/**
 * 禁止类型断言（CLAUDE.md §B.8）。
 *
 * Biome 没有对应规则，因此用 TypeScript 自己的 AST 做检查——不用正则，
 * 避免误伤字符串、注释与 `import x as y`。
 *
 * 允许：`as const`（它控制字面量推断宽度，不是绕过类型系统）。
 * 禁止：`x as T`、`<T>x`。
 *
 * 豁免目录见 EXEMPT：边界解析/类型守卫，以及测试（测试需要刻意构造非法数据）。
 *
 * `.vue` 文件查两处：`<script>` 块，以及 `<template>` 里的表达式——
 * `<script lang="ts">` 时模板表达式也能写 TypeScript（`{{ x as string }}`）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseSfc } from "@vue/compiler-sfc";
import ts from "typescript";

// .pathname 在 Windows 下会得到 /C:/... 这种带斜杠前缀的假路径，
// fileURLToPath 是 Node 内置的 URL→系统原生路径转换，两个平台都对。
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const EXEMPT = [
  /(^|\/)__tests__\//,
  /\.test\.tsx?$/,
  /(^|\/)packages\/extension\/src\/git\/parsers\//,
  /\.guards\.ts$/,
];

const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".git", "coverage"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|vue)$/.test(entry)) yield full;
  }
}

function isAsConst(node) {
  return ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === "const";
}

const violations = [];

/**
 * 在一段 TS 代码里找类型断言。`lineOffset` 把块内行号换算成文件行号。
 */
function check(rel, code, kind, lineOffset) {
  const source = ts.createSourceFile(rel, code, ts.ScriptTarget.ES2022, true, kind);
  const at = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1 + lineOffset;
  const visit = (node) => {
    if (ts.isAsExpression(node) && !isAsConst(node)) {
      violations.push(`${rel}:${at(node)}  ${node.getText().split("\n")[0].slice(0, 80)}`);
    } else if (ts.isTypeAssertionExpression(node)) {
      violations.push(`${rel}:${at(node)}  <T> 式断言`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** 模板 AST 里所有表达式：插值 `{{ }}`，以及指令的值（`:x="…"`、`@click="…"`、`v-if="…"`）。 */
function* templateExpressions(node) {
  // 5 = INTERPOLATION，7 = DIRECTIVE（@vue/compiler-core 的 NodeTypes）
  if (node.type === 5 && node.content?.content) yield node.content;
  for (const prop of node.props ?? []) {
    if (prop.type === 7 && prop.exp?.content) yield prop.exp;
  }
  for (const child of node.children ?? []) yield* templateExpressions(child);
}

function checkVue(rel, text) {
  const { descriptor } = parseSfc(text, { filename: rel });
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block !== null) check(rel, block.content, ts.ScriptKind.TS, block.loc.start.line - 1);
  }
  if (descriptor.template?.ast) {
    for (const exp of templateExpressions(descriptor.template.ast)) {
      // 包一层括号当成表达式语句来解析；`@click="a(); b()"` 这类多语句同样能解析。
      check(rel, `(${exp.content});`, ts.ScriptKind.TS, exp.loc.start.line - 1);
    }
  }
}

for (const file of walk(join(ROOT, "packages"))) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (EXEMPT.some((re) => re.test(rel))) continue;
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".vue")) checkVue(rel, text);
  else check(rel, text, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS, 0);
}

if (violations.length > 0) {
  console.error("禁止使用类型断言（CLAUDE.md §B.8）。豁免仅限 parser / 类型守卫 / 测试：\n");
  for (const v of violations) console.error(`  ${v}`);
  console.error(`\n共 ${violations.length} 处。`);
  process.exit(1);
}
console.log("check-assertions: 无类型断言违规");
