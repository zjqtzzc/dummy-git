#!/usr/bin/env node
/**
 * 在 Ubuntu 20.04（git 2.25）的容器里跑一遍测试：`pnpm test:old-git`。
 *
 * 为什么要有：测试平时只在本机的新 git 上跑，老版本上「不报错、只是结果不一样」的差异
 * （merge 提交的文件列表为空、`check-ignore` 认错否定规则）测不出来。
 *
 * 本仓库整个挂进容器（含 node_modules，同为 linux x64），用本机的用户身份跑，
 * 生成的 `.tmp/` 文件归属不变。参数原样转给 vitest。第一次要拉镜像、装 git，之后走缓存。
 */
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(here));
const image = "dummy-git-test-old-git";
const args = process.argv.slice(2).filter((arg) => arg !== "--");

const docker = (dockerArgs) => {
  const result = spawnSync("docker", dockerArgs, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

docker(["build", "-q", "-t", image, here]);
const { uid, gid } = userInfo();
docker([
  "run",
  "--rm",
  "--user",
  `${uid}:${gid}`,
  // 用户身份在容器里没有家目录；git 与 gpg 要一个可写的。
  "--env",
  "HOME=/tmp",
  "--volume",
  `${repoRoot}:/repo`,
  "--workdir",
  "/repo",
  image,
  "sh",
  "-c",
  'git --version && exec npx vitest run "$@"',
  "sh",
  ...args,
]);
