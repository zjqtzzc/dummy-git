import setiMap from "../../seti/setiMap.json";

/**
 * 按文件名查 Seti 图标。映射表由 `scripts/generate-seti.mjs`
 * 从 VS Code 自带的 Seti 主题生成。
 *
 * 优先级照 VS Code 自己的规则：精确文件名 > 扩展名（从长到短：`a.d.ts` 先试 `d.ts`
 * 再试 `ts`）> 默认图标。按语言的规则生成时已经展开成扩展名与文件名。
 * 匹配不区分大小写。
 */
export interface SetiIcon {
  /** 字体里的字形。 */
  readonly char: string;
  /** 主题给的颜色，`#rrggbb`；空串表示跟随文字颜色。 */
  readonly color: string;
}

interface Mapping {
  readonly file: string;
  readonly fileNames: Readonly<Record<string, string>>;
  readonly fileExtensions: Readonly<Record<string, string>>;
}

const defs: Readonly<Record<string, SetiIcon>> = setiMap.defs;
const themes: { readonly dark: Mapping; readonly light: Mapping } = setiMap;

export function setiIcon(fileName: string, light: boolean): SetiIcon {
  const mapping = light ? themes.light : themes.dark;
  const name = fileName.toLowerCase();
  const id = mapping.fileNames[name] ?? byExtension(mapping, name) ?? mapping.file;
  return defs[id] ?? { char: "", color: "" };
}

function byExtension(mapping: Mapping, name: string): string | undefined {
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const icon = mapping.fileExtensions[name.slice(dot + 1)];
    if (icon !== undefined) return icon;
  }
  return undefined;
}
