import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  assertNever,
  ChangeKind,
  ConflictKind,
  type DiffOpenMode,
  type DiffSide,
  DiffSideKind,
  FileStatus,
  IndexStage,
  OperationKind,
  type Ref,
  RefKind,
} from "@dummy-git/shared";
import { hasConflictMarkers } from "../core/conflictMarkers.js";
import { defaultPushTarget, PushTargetKind } from "../core/pushTarget.js";
import type { Repository } from "../core/repository.js";
import {
  abortInProgress,
  amendCommit,
  applyStash,
  ContinueOutcome,
  cherryPickCommit,
  commit,
  continueInProgress,
  createBranch,
  createTrackingBranch,
  DeleteBranchKind,
  deleteBranch,
  deleteRemoteBranch,
  dropStash,
  FastForwardKind,
  type FastForwardResult,
  fastForward,
  fetchAll,
  fetchBranch,
  fetchInto,
  forceDeleteBranch,
  getCommitDetails,
  getCommitFiles,
  getConflictStages,
  getHead,
  getIdentity,
  getRefs,
  getSkeleton,
  getStashes,
  getStatus,
  isValidBranchName,
  listAuthors,
  listPaths,
  listRemotes,
  MergeOutcome,
  markResolvedPath,
  matchCommits,
  mergeRef,
  PushKind,
  popStash,
  push,
  RebaseOutcome,
  ReplayOutcome,
  rebaseOnto,
  removeConflictPath,
  renameBranch,
  revertCommit,
  rollback,
  stashAll,
  stashPaths,
  switchBranch,
  unstage,
} from "../git/commands/index.js";
import { mergeEditorTitles, readHeadBranch, readOperation } from "../git/operationState.js";
import type { MergeSides } from "../vscode/mergeEditor.js";
import type { RevisionSide } from "../vscode/revisionUri.js";
import { defineHandlers, type HandlerMap } from "./router.js";
import { UserFacingError } from "./userFacingError.js";

/**
 * 协议表的另一半：每条命令**怎么执行**。
 *
 * ## 这里是「装配点」，不是「业务逻辑」
 *
 * 每个 handler 把协议参数转成 `repository.run(命令, 参数…)`，最多再补一点只有扩展知道的事
 * （按当前 `git status` 分出未跟踪、给改名补旧路径、弹确认框）。真正的实现在命令层。
 *
 * 一次性给全（`defineHandlers`），不是逐条注册：这张表从上到下读一遍就是本扩展的全部对外表面积。
 *
 * ## 为什么不 import `vscode`
 *
 * 它只需要一个 `Repository`。不碰 vscode 就意味着这张表能在纯 node 下跑通，
 * 于是「协议接得对不对」有测试守着，而不是只能靠 F5 看一眼。
 *
 * ## `repo` 参数
 *
 * 协议里除 `getRepositories` 外每条都带 `repo`，但第一版只有一个仓库，
 * 所以这里直接用 `repository.location.root`，**不拿协议传来的值去找仓库**——
 * 那个值是 webview 从 `getRepositories` 拿回去再传回来的，必然相同；
 * 用它去选仓库等于凭外部输入决定操作哪个仓库，而现在根本没有「选」这回事。
 * 多仓库时这里换成「按 `params.repo` 查表」，改动只在这一个文件。
 */
/**
 * 要用到 VS Code 界面的动作，由 `extension.ts` 注入。handler 自己不 import vscode，
 * 这样 handler 的测试能在纯 node 下跑。
 */
/** 选择框的一项：`description` 是同一行后面的灰字。 */
export interface PickItem {
  readonly label: string;
  readonly description?: string;
}

export interface HandlerUi {
  /** 删除前的确认（原生模态框）：`action` 是确认按钮，`true` 是确认。 */
  readonly confirm: (message: string, action: string) => Promise<boolean>;
  /** 原生模态框，几个按钮选一个：返回按钮的序号，取消是 `undefined`。 */
  readonly choose: (message: string, actions: readonly string[]) => Promise<number | undefined>;
  /** 从几项里选一项（`vscode/pick.ts`）：返回选中的序号，取消是 `undefined`。 */
  readonly pick: (title: string, items: readonly PickItem[]) => Promise<number | undefined>;
  /** 打开合并编辑器（`vscode/mergeEditor.ts`）。 */
  readonly openMergeEditor: (root: string, sides: MergeSides) => Promise<void>;
  /** 写进系统剪贴板（`vscode/clipboard.ts`）。 */
  readonly copyText: (text: string) => Promise<void>;
  /** 状态栏上几秒的一句话：立刻完成、不走进度出口的操作说做完了什么。 */
  readonly notify: (message: string) => void;
  /** 原生通知上几个按钮选一个（不是模态框）。关掉通知是 `undefined`。 */
  readonly notifyChoice: (
    message: string,
    actions: readonly string[],
  ) => Promise<number | undefined>;
  /** Rollback 前的确认：`true` 是确认。只列勾选的已跟踪文件（不含补上的旧路径）。 */
  readonly confirmRollback: (paths: readonly string[]) => Promise<boolean>;
  /**
   * 进度出口（`vscode/progress.ts`）：`title` 是正在做什么，`done` 由结果说做完了什么。
   * 用户点了、要等、界面上不一定马上看得出结果的操作才用它。
   */
  readonly withProgress: <T>(
    title: string,
    task: () => Promise<T>,
    done: (value: T) => string,
  ) => Promise<T>;
  /**
   * 问一个分支名（`vscode/input.ts`）：`validate` 返回问题描述时确定点不了。取消是 `undefined`。
   */
  readonly askBranchName: (
    title: string,
    value: string,
    validate: (name: string) => Promise<string | undefined>,
  ) => Promise<string | undefined>;
  readonly openDiff: (
    root: string,
    left: DiffSide,
    right: DiffSide,
    mode: DiffOpenMode,
  ) => Promise<void>;
}

export function createHandlers(repository: Repository, ui: HandlerUi): HandlerMap {
  /**
   * 弹输入框问一个分支名，`value` 预填。边输入边校验：git 认不认这个名字、和已有的本地分支重不重名
   * （预填的那个不算重名，改名时它就是自己）。空着点确定、没改、取消，都是 `undefined`。
   * 分支列表在弹框前取一次，输入期间不再问。
   */
  async function askBranchName(title: string, value: string): Promise<string | undefined> {
    const root = repository.location.root;
    const taken = new Set(
      (await repository.run(getRefs, root)).flatMap((ref) =>
        ref.kind === RefKind.LocalBranch && ref.name !== value ? [ref.name] : [],
      ),
    );
    const name = await ui.askBranchName(title, value, async (input) => {
      if (input === "" || input === value) return undefined;
      if (!(await repository.run(isValidBranchName, root, input))) {
        return `'${input}' is not a valid branch name.`;
      }
      return taken.has(input) ? `A branch named '${input}' already exists.` : undefined;
    });
    return name === "" || name === value ? undefined : name;
  }

  /**
   * 标记已解决（Mark as Resolved、Keep 都走这里）：文件里还有冲突标记就先问；没有这个文件（删了）不查。
   */
  async function markResolved(path: string): Promise<void> {
    const root = repository.location.root;
    const text = await readFile(join(root, ...path.split("/")), "utf8").catch(() => "");
    if (hasConflictMarkers(text)) {
      const sure = await ui.confirm(
        `${basename(path)} still contains conflict markers. Mark as resolved anyway?`,
        "Mark as Resolved",
      );
      if (!sure) return;
    }
    await repository.run(markResolvedPath, root, path);
  }

  /** 这条 stash 的说明（确认框与完成消息用）。已经不在时直接说出来。 */
  async function stashMessage(hash: string): Promise<string> {
    const stashes = await repository.run(getStashes, repository.location.root);
    const stash = stashes.find((candidate) => candidate.hash === hash);
    if (stash === undefined) throw new UserFacingError("The stash no longer exists.");
    return stash.message;
  }

  /**
   * 按当前的 `git status` 看勾选的路径：哪些是未跟踪文件（提交前要先 `add`；Rollback 不管），
   * 哪些是已跟踪的；`withOldPaths` 给改名的补上旧路径——界面上只有新路径一行，
   * 旧路径那一半（删除）要一起交给 git，否则剩下一个 D。
   * 由扩展自己问 git，不信 webview 手里可能已过时的状态。
   */
  const inspect = async (paths: readonly string[]) => {
    const { changes } = await repository.run(getStatus, repository.location.root);
    const untracked = new Set<string>();
    const renamedFrom = new Map<string, string>();
    const deleted = new Set<string>();
    for (const change of changes) {
      if (change.kind === ChangeKind.Untracked) untracked.add(change.path);
      if (change.kind === ChangeKind.Tracked && change.oldPath !== undefined) {
        renamedFrom.set(change.path, change.oldPath);
      }
      if (change.kind === ChangeKind.Tracked && change.index === FileStatus.Deleted) {
        deleted.add(change.path);
      }
    }
    return {
      untracked: paths.filter((path) => untracked.has(path)),
      tracked: paths.filter((path) => !untracked.has(path)),
      withOldPaths: (list: readonly string[]): string[] =>
        list.flatMap((path) => {
          const old = renamedFrom.get(path);
          return old === undefined ? [path] : [path, old];
        }),
      /** 这些路径里已暂存的删除：改名的旧路径、暂存区里删掉的文件。 */
      stagedDeletions: (list: readonly string[]): string[] =>
        list.flatMap((path) => {
          const old = renamedFrom.get(path);
          return [...(old === undefined ? [] : [old]), ...(deleted.has(path) ? [path] : [])];
        }),
    };
  };

  return defineHandlers({
    // 第一版只有一个仓库。多仓库时这里返回多条，面板与协议都不用改。
    getRepositories: () => Promise.resolve([repository.location.root]),
    getSkeleton: ({ branch }) =>
      repository.run(getSkeleton, repository.location.root, branch === undefined ? {} : { branch }),
    getCommitDetails: ({ hashes }) =>
      repository.run(getCommitDetails, repository.location.root, hashes),
    getRefs: async () => {
      const root = repository.location.root;
      const [head, refs] = await Promise.all([
        repository.run(getHead, root),
        repository.run(getRefs, root),
      ]);
      return [head, ...refs];
    },
    openDiff: async ({ left, right, mode }) => {
      await ui.openDiff(repository.location.root, left, right, mode);
      return null;
    },
    getCommitFiles: ({ hash }) => repository.run(getCommitFiles, repository.location.root, hash),
    getStashes: () => repository.run(getStashes, repository.location.root),
    matchCommits: ({ hashes, condition }) =>
      repository.run(matchCommits, repository.location.root, hashes, condition),
    pickAuthor: async ({ hashes }) => {
      const root = repository.location.root;
      const [me, authors] = await Promise.all([
        repository.run(getIdentity, root),
        repository.run(listAuthors, root, hashes),
      ]);
      // 每一项：选择框里怎么写、选中了交回什么。
      const choices = [
        ...(me === undefined
          ? []
          : [
              { item: { label: "Me", description: identityText(me) }, picked: { ...me, me: true } },
            ]),
        ...authors.map(({ name, email, count }) => ({
          item: { label: identityText({ name, email }), description: commitCount(count) },
          picked: { name, email, me: false },
        })),
      ];
      const index = await ui.pick(
        "Filter by User",
        choices.map((choice) => choice.item),
      );
      return (index === undefined ? undefined : choices[index]?.picked) ?? null;
    },
    pickPath: async () => {
      const paths = await repository.run(listPaths, repository.location.root);
      const index = await ui.pick(
        "Filter by Path",
        // QuickPick 的 `$(名字)` 写法画 codicon；搜索时不算这几个字。
        paths.map(({ path, folder }) => ({ label: `${folder ? "$(folder)" : "$(file)"} ${path}` })),
      );
      return (index === undefined ? undefined : paths[index]?.path) ?? null;
    },
    openMergeEditor: async ({ path }) => {
      const root = repository.location.root;
      const stages = await repository.run(getConflictStages, root, path);
      if (stages.length === 0) throw new UserFacingError(`${path} has no conflict.`);
      // 缺的那一栏（两边都新增的没有基准）给空内容。
      const side = (stage: IndexStage): RevisionSide =>
        stages.includes(stage)
          ? { kind: DiffSideKind.Stage, stage, path }
          : { kind: DiffSideKind.Missing, path };
      const gitDir = repository.location.gitDir;
      const [operation, branch] = await Promise.all([
        readOperation(gitDir),
        readHeadBranch(gitDir),
      ]);
      const titles = mergeEditorTitles(operation, branch);
      await ui.openMergeEditor(root, {
        base: side(IndexStage.Base),
        current: side(IndexStage.Ours),
        incoming: side(IndexStage.Theirs),
        output: path,
        currentTitle: titles.current,
        incomingTitle: titles.incoming,
      });
      return null;
    },
    copyText: async ({ text }) => {
      await ui.copyText(text);
      return null;
    },
    pick: async ({ title, items }) =>
      (await ui.pick(
        title,
        items.map((label) => ({ label })),
      )) ?? null,
    getStatus: () => repository.run(getStatus, repository.location.root),
    getOperation: () => readOperation(repository.location.gitDir),
    continueOperation: async ({ message }) => {
      const { root, gitDir } = repository.location;
      const current = await readOperation(gitDir);
      if (current === null) throw new UserFacingError("No operation in progress.");
      await ui.withProgress(
        "Continuing…",
        () => repository.run(continueInProgress, root, gitDir, message),
        (outcome) => continueDone(current.kind, outcome),
      );
      return null;
    },
    abortOperation: async () => {
      const current = await readOperation(repository.location.gitDir);
      if (current === null) throw new UserFacingError("No operation in progress.");
      if (!(await ui.confirm(abortQuestion(current.kind), "Abort"))) return null;
      await ui.withProgress(
        "Aborting…",
        () => repository.run(abortInProgress, repository.location.root, current.kind),
        () => "Aborted",
      );
      return null;
    },
    commit: async ({ message, paths }) => {
      const { untracked, withOldPaths } = await inspect(paths);
      await repository.run(
        commit,
        repository.location.root,
        message,
        withOldPaths(paths),
        untracked,
      );
      return null;
    },
    amend: async ({ message, paths }) => {
      const { untracked, withOldPaths } = await inspect(paths);
      await repository.run(
        amendCommit,
        repository.location.root,
        message,
        withOldPaths(paths),
        untracked,
      );
      return null;
    },
    fetch: async () => {
      await ui.withProgress(
        "Fetching all remotes…",
        () => repository.run(fetchAll, repository.location.root),
        () => "Fetched all remotes",
      );
      return null;
    },
    pull: async ({ branch }) => {
      const { root, gitDir } = repository.location;
      const [head, refs] = await Promise.all([
        repository.run(getHead, root),
        repository.run(getRefs, root),
      ]);
      const before = localBranch(refs, branch);
      if (before === undefined) throw new UserFacingError(`Branch ${branch} no longer exists.`);
      const upstream = before.upstream;
      if (upstream === undefined) {
        throw new UserFacingError(`${branch} has no upstream branch. Push it first.`);
      }
      const tracked = `${upstream.remote}/${upstream.name}`;
      const current = head.kind === RefKind.Head && head.branch === branch;
      const step = await ui.withProgress(
        `Pulling ${branch}…`,
        async () => {
          // 当前分支：git 不许 fetch 直接更新检出的分支，拆成远程道的 fetch + 本地道的快进。
          let result: FastForwardResult;
          if (current) {
            await repository.run(fetchBranch, root, upstream.remote, upstream.name);
            result = await repository.run(fastForward, root, `refs/remotes/${tracked}`);
          } else {
            result = await repository.run(fetchInto, root, upstream.remote, upstream.name, branch);
          }
          // 分叉时远程分支记录已经更新。后面的变基或合并用这份记录，不再取一次。
          if (result.kind === FastForwardKind.Diverged) return { kind: "diverged" as const };
          const moved =
            localBranch(await repository.run(getRefs, root), branch)?.target !== before.target;
          return { kind: "done" as const, moved };
        },
        (finished) => {
          switch (finished.kind) {
            case "diverged":
              return "";
            case "done":
              return finished.moved
                ? `Pulled ${branch} from ${tracked}`
                : `${branch} is up to date`;
            default:
              return assertNever(finished, "pull");
          }
        },
      );
      if (step.kind === "done") return null;
      // 关掉通知就停在这里：本地分支不动。
      const choice = await ui.notifyChoice(`${branch} and ${tracked} have diverged.`, [
        "Rebase",
        "Merge",
      ]);
      const onto = `refs/remotes/${tracked}`;
      if (choice === 0) {
        await ui.withProgress(
          `Rebasing onto ${tracked}…`,
          () => repository.run(rebaseOnto, root, gitDir, onto, current ? undefined : branch),
          (outcome) => rebaseDone(outcome, tracked),
        );
      } else if (choice === 1) {
        // 合并只改当前检出的分支，所以先切过去。变基可以在参数里指名分支。
        if (!current) {
          await ui.withProgress(
            `Checking out ${branch}…`,
            () => repository.run(switchBranch, root, branch),
            (said) => said,
          );
        }
        await ui.withProgress(
          `Merging ${tracked}…`,
          () => repository.run(mergeRef, root, gitDir, onto, tracked),
          (outcome) => mergeDone(outcome, tracked),
        );
      }
      return null;
    },
    push: async ({ branch }) => {
      const root = repository.location.root;
      const local = localBranch(await repository.run(getRefs, root), branch);
      if (local === undefined) throw new UserFacingError(`Branch ${branch} no longer exists.`);
      // 有上游就用不到远程列表，不去问 git。
      const remotes = local.upstream === undefined ? await repository.run(listRemotes, root) : [];
      const target = defaultPushTarget(branch, local.upstream, remotes);
      switch (target.kind) {
        case PushTargetKind.Target:
          break;
        case PushTargetKind.Ambiguous:
          throw new UserFacingError(
            `Cannot choose a remote for ${branch}: the repository has several remotes and none is named origin.`,
          );
        case PushTargetKind.NoRemote:
          throw new UserFacingError(
            `Cannot choose a remote for ${branch}: the repository has no remotes.`,
          );
        default:
          return assertNever(target, "push target");
      }
      const tracked = `${target.remote}/${target.remoteBranch}`;
      await ui.withProgress(
        `Pushing ${branch}…`,
        async () => {
          const result = await repository.run(
            push,
            root,
            target.remote,
            branch,
            target.remoteBranch,
            target.setUpstream,
          );
          if (result.kind === PushKind.Rejected) {
            throw new UserFacingError(
              `Push rejected: ${tracked} has commits that ${branch} doesn't have. Pull first.`,
              result.stderr,
            );
          }
          return result.kind;
        },
        (kind) =>
          kind === PushKind.UpToDate ? `${tracked} is up to date` : `Pushed ${branch} → ${tracked}`,
      );
      return null;
    },
    merge: async ({ start, startName }) => {
      const { root, gitDir } = repository.location;
      await ui.withProgress(
        `Merging ${startName}…`,
        () => repository.run(mergeRef, root, gitDir, start, startName),
        (outcome) => mergeDone(outcome, startName),
      );
      return null;
    },
    rebase: async ({ start, startName }) => {
      const { root, gitDir } = repository.location;
      await ui.withProgress(
        `Rebasing onto ${startName}…`,
        () => repository.run(rebaseOnto, root, gitDir, start, undefined),
        (outcome) => rebaseDone(outcome, startName),
      );
      return null;
    },
    cherryPick: async ({ hash }) => {
      const { root, gitDir } = repository.location;
      const name = hash.slice(0, 7);
      await ui.withProgress(
        `Cherry-picking ${name}…`,
        () => repository.run(cherryPickCommit, root, gitDir, hash),
        (outcome) => replayDone(outcome, `Cherry-picked ${name}`, "Cherry-pick is now empty"),
      );
      return null;
    },
    revert: async ({ hash }) => {
      const { root, gitDir } = repository.location;
      const name = hash.slice(0, 7);
      await ui.withProgress(
        `Reverting ${name}…`,
        () => repository.run(revertCommit, root, gitDir, hash),
        (outcome) => replayDone(outcome, `Reverted ${name}`, "Revert is now empty"),
      );
      return null;
    },
    checkout: async ({ branch }) => {
      await ui.withProgress(
        `Checking out ${branch}…`,
        () => repository.run(switchBranch, repository.location.root, branch),
        (said) => said,
      );
      return null;
    },
    checkoutRemote: async ({ remote, branch }) => {
      const root = repository.location.root;
      const tracked = `${remote}/${branch}`;
      const local = localBranch(await repository.run(getRefs, root), branch);
      if (local === undefined) {
        await ui.withProgress(
          `Checking out ${tracked}…`,
          () => repository.run(createTrackingBranch, root, remote, branch),
          (said) => said,
        );
        return null;
      }
      const upstream = local.upstream;
      if (upstream === undefined || upstream.remote !== remote || upstream.name !== branch) {
        throw new UserFacingError(
          `A local branch named ${branch} already exists and doesn't track ${tracked}.`,
        );
      }
      // 本地分支已跟踪它：切过去再快进。一样或领先时 git 说 `Already up to date.`，落后就快进；
      // 分叉时不动它，只提醒（以后让用户选 rebase 还是丢弃本地）。
      await ui.withProgress(
        `Checking out ${branch}…`,
        async () => {
          const said = await repository.run(switchBranch, root, branch);
          const result = await repository.run(fastForward, root, `refs/remotes/${tracked}`);
          return result.kind === FastForwardKind.Diverged
            ? `${branch} and ${tracked} have diverged`
            : said;
        },
        (message) => message,
      );
      return null;
    },
    newBranch: async ({ start, startName }) => {
      const name = await askBranchName(`New branch from ${startName}`, "");
      if (name === undefined) return null;
      await ui.withProgress(
        `Creating ${name}…`,
        () => repository.run(createBranch, repository.location.root, name, start),
        (said) => said,
      );
      return null;
    },
    renameBranch: async ({ branch }) => {
      const name = await askBranchName(`Rename branch ${branch}`, branch);
      if (name === undefined) return null;
      // 只改一个引用，立刻看得见，不走进度出口；git 也不说话，没有完成消息。
      await repository.run(renameBranch, repository.location.root, branch, name);
      return null;
    },
    deleteBranch: async ({ branch }) => {
      // 只改一个引用、立刻看得见，不走进度出口；完成消息是 git 那句（带短 hash，留着找回）。
      const root = repository.location.root;
      const result = await repository.run(deleteBranch, root, branch);
      switch (result.kind) {
        case DeleteBranchKind.Deleted:
          ui.notify(result.said);
          return null;
        case DeleteBranchKind.NotMerged: {
          const sure = await ui.confirm(
            `${branch} has commits that are not merged anywhere. Delete it anyway?`,
            "Delete",
          );
          if (sure) ui.notify(await repository.run(forceDeleteBranch, root, branch));
          return null;
        }
        default:
          return assertNever(result, "delete branch");
      }
    },
    deleteRemoteBranch: async ({ remote, branch }) => {
      const tracked = `${remote}/${branch}`;
      const sure = await ui.confirm(
        `Delete ${branch} on ${remote}? This removes it for everyone using the remote.`,
        "Delete",
      );
      if (!sure) return null;
      // git 只说 `To <地址>` 与 ` - [deleted] feat`，没有能直接用的一句，完成消息自己写。
      await ui.withProgress(
        `Deleting ${tracked}…`,
        () => repository.run(deleteRemoteBranch, repository.location.root, remote, branch),
        () => `Deleted ${tracked}`,
      );
      return null;
    },
    stash: async ({ paths }) => {
      const root = repository.location.root;
      if (paths.length === 0) {
        await ui.withProgress(
          "Stashing all changes…",
          () => repository.run(stashAll, root),
          (said) => said,
        );
        return null;
      }
      const { withOldPaths, stagedDeletions } = await inspect(paths);
      const deletions = stagedDeletions(paths);
      await ui.withProgress(
        "Stashing selected changes…",
        async () => {
          // 已暂存的删除先退回成未暂存的，`stash push -- <路径>` 才不会存了一半（见 `stashPaths`）。
          // 代价：Apply 回来后改名显示成新增 + 删除两行（不带 --index 的 Apply 本来就不还原暂存状态）。
          if (deletions.length > 0) await repository.run(unstage, root, deletions);
          return repository.run(stashPaths, root, withOldPaths(paths));
        },
        (said) => said,
      );
      return null;
    },
    applyStash: async ({ hash }) => {
      // git 的输出是一整段 `git status`，没有能当完成消息的一句，自己写。
      const message = await stashMessage(hash);
      await ui.withProgress(
        "Applying stash…",
        () => repository.run(applyStash, repository.location.root, hash),
        () => `Applied ${message}`,
      );
      return null;
    },
    popStash: async ({ hash }) => {
      const message = await stashMessage(hash);
      await ui.withProgress(
        "Popping stash…",
        () => repository.run(popStash, repository.location.root, hash),
        () => `Applied and dropped ${message}`,
      );
      return null;
    },
    dropStash: async ({ hash }) => {
      const message = await stashMessage(hash);
      if (!(await ui.confirm(`Delete the stash "${message}"? This cannot be undone.`, "Delete"))) {
        return null;
      }
      // 只删一个引用，立刻看得见，不走进度出口。
      ui.notify(await repository.run(dropStash, repository.location.root, hash));
      return null;
    },
    markResolved: async ({ path }) => {
      await markResolved(path);
      return null;
    },
    removeConflictFile: async ({ path }) => {
      await repository.run(removeConflictPath, repository.location.root, path);
      return null;
    },
    resolveDeletion: async ({ path }) => {
      const root = repository.location.root;
      const { changes } = await repository.run(getStatus, root);
      const change = changes.find((c) => c.kind === ChangeKind.Conflict && c.path === path);
      if (change?.kind !== ChangeKind.Conflict)
        throw new UserFacingError(`${path} has no conflict.`);
      const name = basename(path);
      if (change.conflict === ConflictKind.BothDeleted) {
        const index = await ui.choose(`Both sides deleted ${name}.`, ["Delete File"]);
        if (index === 0) await repository.run(removeConflictPath, root, path);
        return null;
      }
      const index = await ui.choose(deletionQuestion(name, change.conflict), [
        "Keep",
        "Delete File",
      ]);
      if (index === 0) await markResolved(path);
      if (index === 1) await repository.run(removeConflictPath, root, path);
      return null;
    },
    addUntracked: async ({ path }) => {
      // 和标记已解决是同一条 git add：把工作区里的这一份写进暂存区。不确认。
      await repository.run(markResolvedPath, repository.location.root, path);
      return null;
    },
    deleteUntracked: async ({ path }) => {
      const sure = await ui.confirm(`Delete ${basename(path)}? This cannot be undone.`, "Delete");
      // 未跟踪的文件 git 不管，直接删磁盘上的；watcher 看到变化就刷新。
      if (sure) await rm(join(repository.location.root, ...path.split("/")));
      return null;
    },
    rollback: async ({ paths }) => {
      // 未跟踪文件不归 Rollback 管（第 7 阶段右键 Delete）。一个已跟踪的都没有就什么都不做。
      const { tracked, withOldPaths } = await inspect(paths);
      if (tracked.length === 0 || !(await ui.confirmRollback(tracked))) return null;
      await repository.run(rollback, repository.location.root, withOldPaths(tracked));
      return null;
    },
  });
}

function mergeDone(outcome: MergeOutcome, name: string): string {
  switch (outcome) {
    case MergeOutcome.UpToDate:
      return "Already up to date";
    case MergeOutcome.FastForward:
      return `Fast-forwarded to ${name}`;
    case MergeOutcome.Merged:
      return `Merged ${name}`;
    case MergeOutcome.Stopped:
      return "Stopped for conflicts";
    default:
      return assertNever(outcome, "mergeDone");
  }
}

function replayDone(outcome: ReplayOutcome, done: string, empty: string): string {
  switch (outcome) {
    case ReplayOutcome.Done:
      return done;
    case ReplayOutcome.Stopped:
      return "Stopped for conflicts";
    case ReplayOutcome.Empty:
      return empty;
    default:
      return assertNever(outcome, "replayDone");
  }
}

function rebaseDone(outcome: RebaseOutcome, name: string): string {
  switch (outcome) {
    case RebaseOutcome.UpToDate:
      return "Already up to date";
    case RebaseOutcome.Rebased:
      return `Rebased onto ${name}`;
    case RebaseOutcome.Stopped:
      return "Stopped for conflicts";
    case RebaseOutcome.StashConflict:
      return `Rebased onto ${name}. Applying the stashed changes has conflicts.`;
    default:
      return assertNever(outcome, "rebaseDone");
  }
}

function continueDone(kind: OperationKind, outcome: ContinueOutcome): string {
  if (outcome === ContinueOutcome.Stopped) return "Stopped for conflicts";
  switch (kind) {
    case OperationKind.Merge:
      return "Merge completed";
    case OperationKind.Rebase:
      return "Rebase completed";
    case OperationKind.CherryPick:
      return "Cherry-pick completed";
    case OperationKind.Revert:
      return "Revert completed";
    default:
      return assertNever(kind, "continueDone");
  }
}

function abortQuestion(kind: OperationKind): string {
  switch (kind) {
    case OperationKind.Merge:
      return "Abort the merge?";
    case OperationKind.Rebase:
      return "Abort the rebase?";
    case OperationKind.CherryPick:
      return "Abort the cherry-pick?";
    case OperationKind.Revert:
      return "Abort the revert?";
    default:
      return assertNever(kind, "abortQuestion");
  }
}

/** 双击一边删了的冲突文件时，弹框里的那句话。 */
function deletionQuestion(name: string, conflict: ConflictKind): string {
  switch (conflict) {
    case ConflictKind.DeletedByUs:
      return `${name} was deleted on our side and changed on theirs.`;
    case ConflictKind.DeletedByThem:
      return `${name} was changed on our side and deleted on theirs.`;
    case ConflictKind.AddedByUs:
      return `${name} was added only on our side.`;
    case ConflictKind.AddedByThem:
      return `${name} was added only on their side.`;
    case ConflictKind.BothModified:
    case ConflictKind.BothAdded:
    case ConflictKind.BothDeleted:
      return `${name} is in conflict.`;
    default:
      return assertNever(conflict, "deletionQuestion");
  }
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 选择框里写一个人：`名字 <邮箱>`，邮箱为空时只写名字。 */
function identityText({ name, email }: { name: string; email: string }): string {
  return email === "" ? name : `${name} <${email}>`;
}

function commitCount(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}

/** 按名字找本地分支。 */
function localBranch(
  refs: readonly Ref[],
  name: string,
): Extract<Ref, { kind: RefKind.LocalBranch }> | undefined {
  for (const ref of refs) {
    if (ref.kind === RefKind.LocalBranch && ref.name === name) return ref;
  }
  return undefined;
}
