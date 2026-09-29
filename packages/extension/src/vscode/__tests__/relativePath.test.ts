import { describe, expect, it } from "vitest";
import { relativeTo, workspaceRelative } from "../relativePath.js";

/**
 * 这一段此前**零覆盖**——现有测试验的是 `notifyGitPath` 之后的链路，
 * 「VSCode 事件 → 相对路径」这一入口从未被测过，于是 Windows 的 bug 潜伏至今。
 */
describe("relativeTo", () => {
  describe("Windows 风格路径（用字面量构造，不依赖运行平台）", () => {
    // 这一组就是原 bug 的复现：原实现把 `/` 拼进 prefix，与 `\` 的 fsPath 永不匹配。
    it("`.git` 下的文件能转成相对路径", () => {
      expect(relativeTo("C:\\repo\\.git", "C:\\repo\\.git\\HEAD")).toBe("HEAD");
    });

    it("多层目录，分隔符统一成 `/`——M6 的分类表按 `/` 书写", () => {
      expect(relativeTo("C:\\repo\\.git", "C:\\repo\\.git\\refs\\heads\\main")).toBe(
        "refs/heads/main",
      );
    });

    it("工作区文件", () => {
      expect(relativeTo("C:\\repo", "C:\\repo\\src\\index.ts")).toBe("src/index.ts");
    });
  });

  describe("POSIX 风格路径", () => {
    it("`.git` 下的文件", () => {
      expect(relativeTo("/repo/.git", "/repo/.git/HEAD")).toBe("HEAD");
    });

    it("多层目录", () => {
      expect(relativeTo("/repo/.git", "/repo/.git/refs/heads/main")).toBe("refs/heads/main");
    });
  });

  describe("不在基准目录下 → undefined", () => {
    it("完全无关的路径", () => {
      expect(relativeTo("/repo/.git", "/elsewhere/HEAD")).toBeUndefined();
    });

    it("兄弟目录：前缀是同一串字符但不是同一个目录", () => {
      // `/repo/.gitignore` 以 `/repo/.git` 开头，但它不在 `.git/` 里面。
      // 这就是 prefix 必须带尾部 `/` 的理由。
      expect(relativeTo("/repo/.git", "/repo/.gitignore")).toBeUndefined();
    });

    it("基准目录自身不算它的相对路径", () => {
      expect(relativeTo("/repo/.git", "/repo/.git")).toBeUndefined();
    });
  });

  it("基准目录末尾已带分隔符时不重复拼接", () => {
    expect(relativeTo("/repo/.git/", "/repo/.git/HEAD")).toBe("HEAD");
  });
});

describe("workspaceRelative：git 目录里的事件不喂给工作区入口", () => {
  it("普通仓库：`<根>/.git` 下的跳过，其余转成相对路径", () => {
    const location = { root: "/r", gitDir: "/r/.git", commonDir: "/r/.git" };
    expect(workspaceRelative(location, "/r/src/a.ts")).toBe("src/a.ts");
    expect(workspaceRelative(location, "/r/.git/HEAD")).toBeUndefined();
  });

  it("linked worktree：git 目录不在根下，根下的一切都算工作区", () => {
    const location = { root: "/wt", gitDir: "/main/.git/worktrees/wt", commonDir: "/main/.git" };
    expect(workspaceRelative(location, "/wt/src/a.ts")).toBe("src/a.ts");
    expect(workspaceRelative(location, "/main/.git/worktrees/wt/HEAD")).toBeUndefined();
  });

  it("不在仓库根下的路径 → undefined", () => {
    const location = { root: "/r", gitDir: "/r/.git", commonDir: "/r/.git" };
    expect(workspaceRelative(location, "/other/x")).toBeUndefined();
  });
});
