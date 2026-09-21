import type { Commit, CommitFileChange, CommitSkeleton, FileStatus } from "@dummy-git/shared";
import { GitDomain } from "@dummy-git/shared";
import { useCallback, useEffect, useState } from "react";
import type { Client } from "./client.js";

/** 一屏显示多少条。骨架跑遍全历史，详情只取要显示的这些（取数模型 B）。 */
const PAGE = 100;

/**
 * git 的状态 → 给人看的字。
 *
 * 这张表放在**用它的模块里**（`CLAUDE.md` B.3）：它是 UI 的投影，
 * 别的地方（比如图标、排序）会有各自不同的表，不该共用一个。
 */
const STATUS_LABEL: Readonly<Record<FileStatus, string>> = {
  unchanged: "　",
  modified: "改",
  added: "增",
  deleted: "删",
  renamed: "名",
  copied: "复",
  typeChanged: "型",
};

function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

function when(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}

function subject(message: string): string {
  const end = message.indexOf("\n");
  return end === -1 ? message : message.slice(0, end);
}

export function App({ client }: { readonly client: Client }): React.JSX.Element {
  /** 先问「有哪些仓库」，拿到之后才谈得上拉数据。第一版永远只有一条。 */
  const [repo, setRepo] = useState<string | undefined>(undefined);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [files, setFiles] = useState<CommitFileChange[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);

  /** 拉一屏提交。骨架 → 取前 PAGE 条的 hash → 详情。 */
  const load = useCallback(
    async (repository: string) => {
      try {
        const skeleton: CommitSkeleton[] = await client.request("getSkeleton", {
          repo: repository,
        });
        setTotal(skeleton.length);
        const hashes = skeleton.slice(0, PAGE).map((c) => c.hash);
        setCommits(await client.request("getCommitDetails", { repo: repository, hashes }));
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [client],
  );

  useEffect(() => {
    // 先握手，再问有哪些仓库，拿到第一个就开始拉。
    // 扩展侧在收到 ready 之前一个字节都不发，所以不存在「发早了被丢掉」。
    client.start();
    void (async () => {
      try {
        const roots = await client.request("getRepositories", {});
        const first = roots[0];
        if (first === undefined) {
          setError("没有找到 git 仓库");
          return;
        }
        setRepo(first);
        await load(first);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [client, load]);

  useEffect(() => {
    if (repo === undefined) return;
    // **只在 refs 变了才重拉提交列表。** 保存一次工作区文件只会得到 worktree，
    // 不该触发提交图重算——这是 M6 分域最主要的收益，在这里兑现。
    client.onDomainsChanged((_changed, domains) => {
      if (domains.includes(GitDomain.Refs)) void load(repo);
    });
  }, [client, load, repo]);

  const select = useCallback(
    async (hash: string) => {
      setSelected(hash);
      try {
        if (repo === undefined) return;
        setFiles(await client.request("getCommitFiles", { repo, hash }));
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [client, repo],
  );

  return (
    <div className="layout">
      <div className="panel">
        <h2>
          提交 <span className="dim">{total === 0 ? "" : `共 ${total} 条，显示前 ${PAGE}`}</span>
        </h2>
        {error !== undefined && <p className="error">{error}</p>}
        <ul className="list">
          {commits.map((commit) => (
            <li key={commit.hash}>
              <button
                type="button"
                className={commit.hash === selected ? "row selected" : "row"}
                onClick={() => void select(commit.hash)}
              >
                <code>{shortHash(commit.hash)}</code>
                <span className="subject">{subject(commit.message)}</span>
                <span className="dim">{commit.author.name}</span>
                <span className="dim">{when(commit.author.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h2>
          变更文件{" "}
          <span className="dim">{selected === undefined ? "（未选择）" : shortHash(selected)}</span>
        </h2>
        <ul className="list">
          {files.map((file) => (
            <li key={`${file.status}:${file.oldPath ?? ""}:${file.path}`} className="row">
              <code>{STATUS_LABEL[file.status]}</code>
              <span className="subject">
                {file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
