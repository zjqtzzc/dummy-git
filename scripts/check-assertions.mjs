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
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
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
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

function isAsConst(node) {
  return ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === "const";
}

const violations = [];

for (const file of walk(join(ROOT, "packages"))) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (EXEMPT.some((re) => re.test(rel))) continue;

  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node) => {
    if (ts.isAsExpression(node) && !isAsConst(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      violations.push(`${rel}:${line + 1}  ${node.getText().split("\n")[0].slice(0, 80)}`);
    } else if (ts.isTypeAssertionExpression(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      violations.push(`${rel}:${line + 1}  <T> 式断言`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (violations.length > 0) {
  console.error("禁止使用类型断言（CLAUDE.md §B.8）。豁免仅限 parser / 类型守卫 / 测试：\n");
  for (const v of violations) console.error(`  ${v}`);
  console.error(`\n共 ${violations.length} 处。`);
  process.exit(1);
}
console.log("check-assertions: 无类型断言违规");
