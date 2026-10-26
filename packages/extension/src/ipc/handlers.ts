import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  assertNever,
  ChangeKind,
  ConflictKind,
  DialogKind,
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
import { defaultPushTarget, pushUpstream } from "../core/pushTarget.js";
import type { Repository } from "../core/repository.js";
import {
  abortInProgress,
  addPaths,
  addRemote,
  amendCommit,
  applyStash,
  ContinueOutcome,
  type ContinueResult,
  commit,
  continueInProgress,
  createBranch,
  createTrackingBranch,
  DeleteBranchKind,
  deleteBranch,
  deleteRemoteBranches,
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
  getHeadBases,
  getIdentity,
  getOutgoingCommits,
  getRefs,
  getSkeleton,
  getStashes,
  getStatus,
  isValidBranchName,
  listAuthors,
  listPaths,
  listRemotes,
  MergeOutcome,
  matchCommits,
  mergeRef,
  PushKind,
  popStash,
  push,
  RebaseOutcome,
  type ReplayKind,
  ReplayOutcome,
  type ReplayResult,
  ResetMode,
  RewordOutcome,
  rebaseOnto,
  removeConflictPaths,
  renameBranch,
  replayCommits,
  resetTo,
  rewordCommit,
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

/** 选择框的一项：`description` 是同一行后面的灰字。 */
export interface PickItem {
  readonly label: string;
  readonly description?: string;
}

/**
 * 要用到 VS Code 界面的动作，由 `extension.ts` 注入。handler 自己不 import vscode，
 * 这样 handler 的测试能在纯 node 下跑。
 */
export interface HandlerUi {
  /** 删除前的确认（原生模态框）：`action` 是确认按钮，`true` 是确认。给了 `names` 就在说明里列出（前 5 个）。 */
  readonly confirm: (
    message: string,
    action: string,
    names?: readonly string[],
  ) => Promise<boolean>;
  /** 原生模态框，几个按钮选一个：返回按钮的序号，取消是 `undefined`。 */
  readonly choose: (
    message: string,
    actions: readonly string[],
    /** 标题下面的说明，可多行。 */
    detail?: string,
  ) => Promise<number | undefined>;
  /** 从几项里选一项（`vscode/pick.ts`）：返回选中的序号，取消是 `undefined`。 */
  readonly pick: (title: string, items: readonly PickItem[]) => Promise<number | undefined>;
  /** 在编辑器里打开工作区里的文件（`vscode/openFile.ts`）。 */
  readonly openFile: (root: string, path: string) => Promise<void>;
  /** 打开合并编辑器（`vscode/mergeEditor.ts`）。 */
  readonly openMergeEditor: (root: string, sides: MergeSides) => Promise<void>;
  /** webview 的异常写进日志（error 级别）。 */
  readonly logWebviewError: (message: string, stack: string) => void;
  /** 写进系统剪贴板（`vscode/clipboard.ts`）。 */
  readonly copyText: (text: string) => Promise<void>;
  /** 状态栏上几秒的一句话：立刻完成、不走进度出口的操作说做完了什么。 */
  readonly notify: (message: string) => void;
  /** 原生通知上几个按钮选一个（不是模态框）。关掉通知是 `undefined`。 */
  readonly notifyChoice: (
    message: string,
    actions: readonly string[],
  ) => Promise<number | undefined>;
  /** Rollback 前的确认：`true` 是确认。只列选中的已跟踪文件（不含补上的改名另一头）。 */
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
  /**
   * 打开一个对话框的标签（`vscode/dialogPanel.ts`）：`subject` 是它针对的东西（推送对话框是分支名），
   * `title` 是标签名。同一种已经开着就切过去、换成新的 `subject`。
   */
  readonly openDialog: (dialog: DialogKind, subject: string, title: string) => void;
  /** 关掉一个对话框的标签。没开着什么都不做。 */
  readonly closeDialog: (dialog: DialogKind) => void;
  readonly openDiff: (
    root: string,
    left: DiffSide,
    right: DiffSide,
    mode: DiffOpenMode,
  ) => Promise<void>;
}

/**
 * 推送对话框最多列多少条要推的提交。推到新远程时可能是整个历史，全取出来没有意义。
 */
const OUTGOING_LIMIT = 1000;

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
   * 更新一个本地分支：只取它跟踪的远程分支，能快进就快进。分叉时远程分支记录已经更新，
   * 后面的变基或合并用这份记录，不再取一次。
   */
  async function updateOne(branch: string): Promise<{
    readonly result: UpdateResult;
    readonly tracked: string;
    readonly current: boolean;
  }> {
    const root = repository.location.root;
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
    // 当前分支：git 不许 fetch 直接更新检出的分支，拆成远程道的 fetch + 本地道的快进。
    let forward: FastForwardResult;
    if (current) {
      await repository.run(fetchBranch, root, upstream.remote, upstream.name);
      forward = await repository.run(fastForward, root, `refs/remotes/${tracked}`);
    } else {
      forward = await repository.run(fetchInto, root, upstream.remote, upstream.name, branch);
    }
    if (forward.kind === FastForwardKind.Diverged) {
      return { result: { kind: UpdateKind.Diverged, branch, tracked }, tracked, current };
    }
    const moved =
      localBranch(await repository.run(getRefs, root), branch)?.target !== before.target;
    return {
      result: { kind: moved ? UpdateKind.Updated : UpdateKind.UpToDate, branch, tracked },
      tracked,
      current,
    };
  }

  /**
   * 一次更新好几个：按顺序逐个更新，算一次操作，每个分支状态栏各说一句。
   * 分叉的不问变基还是合并（问了就得等人答，后面的都卡着），跳过它接着做，最后报错列出来，让人单个更新。
   * 某一个被 git 拒绝时，已经更新的不撤回，剩下的不再做，显示 git 的报错。
   */
  async function updateMany(branches: readonly string[]): Promise<void> {
    const diverged: string[] = [];
    await ui.withProgress(
      `Updating ${branches.length} branches…`,
      async () => {
        const results: UpdateResult[] = [];
        for (const branch of branches) {
          const { result } = await updateOne(branch);
          if (result.kind === UpdateKind.Diverged) diverged.push(branch);
          else ui.notify(updateDone(result));
          results.push(result);
        }
        return results;
      },
      updateSummary,
    );
    const [first] = diverged;
    if (first === undefined) return;
    throw new UserFacingError(
      diverged.length === 1
        ? `${first} has diverged from its upstream and was not updated. Update it on its own.`
        : `${diverged.length} branches have diverged from their upstream and were not updated: ${diverged.join(", ")}. Update them one at a time.`,
    );
  }

  /** 摘、撤一串提交（顺序由调用方排好），走进度出口，完成消息见 `replayDone`。 */
  async function replay(kind: ReplayKind, hashes: readonly string[]): Promise<void> {
    const { root, gitDir } = repository.location;
    await ui.withProgress(
      `${REPLAY_WORDS[kind].doing} ${commitsText(hashes)}…`,
      () => repository.run(replayCommits, root, gitDir, kind, hashes),
      (result) => replayDone(kind, hashes, result),
    );
  }

  /**
   * 标记已解决（Mark as Resolved、Keep 都走这里），一条 `git add`。
   * 文件里还有冲突标记的收在一起先问一次（一个时照旧写名字）；取消就只是它们不标记，其余照旧标记
   * （同批量删分支时没合并的那几个）。没有这个文件（删了）的不查。
   */
  async function markResolved(paths: readonly string[]): Promise<void> {
    const root = repository.location.root;
    const marked: string[] = [];
    const clean: string[] = [];
    for (const path of paths) {
      const text = await readFile(join(root, ...path.split("/")), "utf8").catch(() => "");
      (hasConflictMarkers(text) ? marked : clean).push(path);
    }
    const [only] = marked;
    if (only !== undefined) {
      const sure =
        marked.length === 1
          ? await ui.confirm(
              `${basename(only)} still contains conflict markers. Mark as resolved anyway?`,
              "Mark as Resolved",
            )
          : await ui.confirm(
              `${marked.length} files still contain conflict markers. Mark them as resolved anyway?`,
              "Mark as Resolved",
              marked.map(basename),
            );
      if (sure) clean.push(...marked);
    }
    if (clean.length > 0) await repository.run(addPaths, root, clean);
  }

  /** 这条 stash 的说明（确认框与完成消息用）。已经不在时直接说出来。 */
  async function stashMessage(hash: string): Promise<string> {
    const stashes = await repository.run(getStashes, repository.location.root);
    const stash = stashes.find((candidate) => candidate.hash === hash);
    if (stash === undefined) throw new UserFacingError("The stash no longer exists.");
    return stash.message;
  }

  /**
   * 按当前的 `git status` 看交来的路径（提交、Stash 是勾选的，Rollback 是选中的）：哪些是未跟踪文件（提交前要先 `add`；Rollback 不管），
   * 哪些是已跟踪的；`withRenamePartners` 给改名的补上另一头——界面上改名只有一行，
   * 平常是新路径；新路径又从磁盘上删掉时，界面画成旧路径上的删除。两头要一起交给 git，
   * 只交新路径会剩下一个 D，只交旧路径会剩下一个 AD。
   * 由扩展自己问 git，不信 webview 手里可能已过时的状态。
   */
  const inspect = async (paths: readonly string[]) => {
    const { changes } = await repository.run(getStatus, repository.location.root);
    const untracked = new Set<string>();
    const renamedFrom = new Map<string, string>();
    const renamedTo = new Map<string, string>();
    const deleted = new Set<string>();
    for (const change of changes) {
      if (change.kind === ChangeKind.Untracked) untracked.add(change.path);
      if (change.kind === ChangeKind.Tracked && change.oldPath !== undefined) {
        renamedFrom.set(change.path, change.oldPath);
        renamedTo.set(change.oldPath, change.path);
      }
      if (change.kind === ChangeKind.Tracked && change.index === FileStatus.Deleted) {
        deleted.add(change.path);
      }
    }
    return {
      untracked: paths.filter((path) => untracked.has(path)),
      tracked: paths.filter((path) => !untracked.has(path)),
      withRenamePartners: (list: readonly string[]): string[] =>
        list.flatMap((path) => {
          const partner = renamedFrom.get(path) ?? renamedTo.get(path);
          return partner === undefined ? [path] : [path, partner];
        }),
      /** 这些路径里已暂存的删除：改名的旧路径（给的是哪一头都算）、暂存区里删掉的文件。 */
      stagedDeletions: (list: readonly string[]): string[] =>
        list.flatMap((path) => {
          const old = renamedFrom.get(path);
          if (old !== undefined) return [old];
          return renamedTo.has(path) || deleted.has(path) ? [path] : [];
        }),
    };
  };

  return defineHandlers({
    // 第一版只有一个仓库。多仓库时这里返回多条，面板与协议都不用改。
    getRepositories: () => Promise.resolve([repository.location.root]),
    getSkeleton: ({ branch, order }) =>
      repository.run(
        getSkeleton,
        repository.location.root,
        branch === undefined ? { order } : { branch, order },
      ),
    getHeadBases: ({ branch }) =>
      repository.run(
        getHeadBases,
        repository.location.root,
        branch === undefined ? {} : { branch },
      ),
    getIdentity: async () => (await repository.run(getIdentity, repository.location.root)) ?? null,
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
    openFile: async ({ path }) => {
      await ui.openFile(repository.location.root, path);
      return null;
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
    reportError: async ({ message, stack }) => {
      ui.logWebviewError(message, stack);
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
      const { untracked, withRenamePartners } = await inspect(paths);
      await repository.run(
        commit,
        repository.location.root,
        message,
        withRenamePartners(paths),
        untracked,
      );
      return null;
    },
    amend: async ({ message, paths }) => {
      const { untracked, withRenamePartners } = await inspect(paths);
      await repository.run(
        amendCommit,
        repository.location.root,
        message,
        withRenamePartners(paths),
        untracked,
      );
      return null;
    },
    fetch: async () => {
      await ui.withProgress(
        "Fetching all remotes…",
        // 手动 Fetch 顺带清掉远程上已删除的分支；自动的不清：后台不替用户删东西。
        () => repository.run(fetchAll, repository.location.root, { prune: true }),
        () => "Fetched all remotes",
      );
      return null;
    },
    update: async ({ branches }) => {
      const { root, gitDir } = repository.location;
      const [only] = branches;
      if (branches.length > 1 || only === undefined) {
        await updateMany(branches);
        return null;
      }
      const { result, tracked, current } = await ui.withProgress(
        `Updating ${only}…`,
        () => updateOne(only),
        ({ result }) => updateDone(result),
      );
      if (result.kind !== UpdateKind.Diverged) return null;
      // 关掉通知就停在这里：本地分支不动。
      const choice = await ui.notifyChoice(`${only} and ${tracked} have diverged.`, [
        "Rebase",
        "Merge",
      ]);
      const onto = `refs/remotes/${tracked}`;
      if (choice === 0) {
        await ui.withProgress(
          `Rebasing onto ${tracked}…`,
          () => repository.run(rebaseOnto, root, gitDir, onto, current ? undefined : only),
          (outcome) => rebaseDone(outcome, tracked),
        );
      } else if (choice === 1) {
        // 合并只改当前检出的分支，所以先切过去。变基可以在参数里指名分支。
        if (!current) {
          await ui.withProgress(
            `Checking out ${only}…`,
            () => repository.run(switchBranch, root, only),
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
    openPushDialog: async ({ branch }) => {
      ui.openDialog(DialogKind.Push, branch, `Push ${branch}`);
      return null;
    },
    openRewordDialog: async ({ hash }) => {
      ui.openDialog(DialogKind.Reword, hash, "Edit Commit Message");
      return null;
    },
    reword: async ({ hash, message }) => {
      const { root, gitDir } = repository.location;
      const current = await readOperation(gitDir);
      if (current !== null) {
        throw new UserFacingError(
          `Cannot edit commit messages while ${operationNoun(current.kind)} is in progress.`,
        );
      }
      // 点了就关，改写在后台跑。
      ui.closeDialog(DialogKind.Reword);
      const short = hash.slice(0, 7);
      await ui.withProgress(
        "Rewording…",
        async () => {
          const outcome = await repository.run(rewordCommit, root, hash, message);
          if (outcome === RewordOutcome.NotLinear) {
            throw new UserFacingError(
              `Cannot edit the message of ${short}: it is not on the current branch, or a merge commit comes after it.`,
            );
          }
        },
        () => `Reworded ${short}`,
      );
      return null;
    },
    closeDialog: async ({ dialog }) => {
      ui.closeDialog(dialog);
      return null;
    },
    getPushTarget: async ({ branch }) => {
      const root = repository.location.root;
      const local = localBranch(await repository.run(getRefs, root), branch);
      if (local === undefined) throw new UserFacingError(`Branch ${branch} no longer exists.`);
      const remotes = await repository.run(listRemotes, root);
      return { remotes, ...defaultPushTarget(branch, local.upstream, remotes) };
    },
    getOutgoingCommits: async ({ branch, remote, remoteBranch }) => {
      const root = repository.location.root;
      const known = (await repository.run(getRefs, root)).some(
        (ref) =>
          ref.kind === RefKind.RemoteBranch && ref.remote === remote && ref.name === remoteBranch,
      );
      // 多取一条，用来判断还有没有没列出的。
      const commits = await repository.run(
        getOutgoingCommits,
        root,
        OUTGOING_LIMIT + 1,
        branch,
        remote,
        known ? remoteBranch : undefined,
      );
      return { commits: commits.slice(0, OUTGOING_LIMIT), more: commits.length > OUTGOING_LIMIT };
    },
    push: async ({ branch, remote, remoteBranch, force, remoteUrl, tags }) => {
      const root = repository.location.root;
      const local = localBranch(await repository.run(getRefs, root), branch);
      if (local === undefined) throw new UserFacingError(`Branch ${branch} no longer exists.`);
      const tracked = `${remote}/${remoteBranch}`;
      if (
        force &&
        !(await ui.confirm(
          `Force push to ${tracked}? It may overwrite commits at the remote.`,
          "Force Push",
        ))
      ) {
        return null;
      }
      // 点了就关，推送在后台跑。
      ui.closeDialog(DialogKind.Push);
      await ui.withProgress(
        `Pushing ${branch}…`,
        async () => {
          if (remoteUrl !== undefined) await repository.run(addRemote, root, remote, remoteUrl);
          // 没有上游（或上游已 gone）时带 `-u`：推完上游就是刚推到的那个分支，远程上原来就有它也一样。
          const result = await repository.run(
            push,
            root,
            remote,
            branch,
            remoteBranch,
            pushUpstream(local.upstream) === undefined,
            force,
            tags,
          );
          if (result.kind === PushKind.Rejected) {
            throw new UserFacingError(
              `Push rejected: ${tracked} has commits that ${branch} doesn't have. Update it first.`,
              result.stderr,
            );
          }
          // 分支已经推完，只是有 tag 没推上：前半句照实说分支，后半句列出每个 tag 和 git 给的原因。
          if (result.rejectedTags.length > 0) {
            const tags = result.rejectedTags.map((tag) => `${tag.name} ${tag.summary}`).join(", ");
            throw new UserFacingError(
              `${pushDone(result.kind, branch, tracked)}, but tags were rejected: ${tags}`,
            );
          }
          return result.kind;
        },
        (kind) => pushDone(kind, branch, tracked),
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
    resetTo: async ({ hash }) => {
      const root = repository.location.root;
      const [head, [commit]] = await Promise.all([
        repository.run(getHead, root),
        repository.run(getCommitDetails, root, [hash]),
      ]);
      const short = hash.slice(0, 7);
      const target = head.kind === RefKind.Head && head.branch !== undefined ? head.branch : "HEAD";
      const subject = commit === undefined ? "" : ` "${firstLine(commit.message)}"`;
      const index = await ui.choose(
        `Reset ${target} to ${short}${subject}?`,
        RESET_MODES.map(resetLabel),
        RESET_MODES.map((mode) => `${resetLabel(mode)}: ${resetEffect(mode)}`).join("\n"),
      );
      const mode = index === undefined ? undefined : RESET_MODES[index];
      if (mode === undefined) return null;
      await ui.withProgress(
        `Resetting ${target} to ${short}…`,
        () => repository.run(resetTo, root, mode, hash),
        () => `Reset ${target} to ${short}`,
      );
      return null;
    },
    cherryPick: async ({ hashes }) => {
      await replay(OperationKind.CherryPick, hashes);
      return null;
    },
    revert: async ({ hashes }) => {
      await replay(OperationKind.Revert, hashes);
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
    deleteBranches: async ({ local, remote }) => {
      const root = repository.location.root;
      let deleted = 0;
      // 本地：每个分支各一条 `branch -d`，状态栏各说一句 git 那句（带短 hash，日志里留着找回）。
      // 只改引用、立刻看得见，不走进度出口。
      const unmerged: string[] = [];
      for (const branch of local) {
        const result = await repository.run(deleteBranch, root, branch);
        switch (result.kind) {
          case DeleteBranchKind.Deleted:
            ui.notify(result.said);
            deleted += 1;
            break;
          case DeleteBranchKind.NotMerged:
            unmerged.push(branch);
            break;
          default:
            assertNever(result, "delete branch");
        }
      }
      const [onlyUnmerged] = unmerged;
      if (onlyUnmerged !== undefined) {
        const sure =
          unmerged.length === 1
            ? await ui.confirm(
                `${onlyUnmerged} has commits that are not merged anywhere. Delete it anyway?`,
                "Delete",
              )
            : await ui.confirm(
                `${unmerged.length} branches have commits that are not merged anywhere. Delete them anyway?`,
                "Delete",
                unmerged,
              );
        if (sure) {
          for (const branch of unmerged) {
            ui.notify(await repository.run(forceDeleteBranch, root, branch));
            deleted += 1;
          }
        }
      }
      // 远程：问一次，每个远程一条 push --delete。
      const [onlyRemote] = remote;
      if (onlyRemote !== undefined) {
        const names = remote.map(({ remote: r, branch }) => `${r}/${branch}`);
        const sure =
          remote.length === 1
            ? await ui.confirm(
                `Delete ${onlyRemote.branch} on ${onlyRemote.remote}? This removes it for everyone using the remote.`,
                "Delete",
              )
            : await ui.confirm(
                `Delete ${remote.length} branches on remotes? This removes them for everyone using the remote.`,
                "Delete",
                names,
              );
        if (sure) {
          const byRemote = new Map<string, string[]>();
          for (const { remote: r, branch } of remote) {
            byRemote.set(r, [...(byRemote.get(r) ?? []), branch]);
          }
          // git 只说 `To <地址>` 与 ` - [deleted] feat`，没有能直接用的一句，完成消息自己写。
          const [onlyName] = names;
          const what =
            names.length === 1 && onlyName !== undefined
              ? onlyName
              : `${names.length} remote branches`;
          await ui.withProgress(
            `Deleting ${what}…`,
            async () => {
              for (const [r, branches] of byRemote) {
                await repository.run(deleteRemoteBranches, root, r, branches);
              }
            },
            () => `Deleted ${what}`,
          );
          deleted += remote.length;
        }
      }
      if (deleted > 1) ui.notify(`Deleted ${deleted} branches`);
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
      const { withRenamePartners, stagedDeletions } = await inspect(paths);
      const deletions = stagedDeletions(paths);
      await ui.withProgress(
        "Stashing selected changes…",
        async () => {
          // 已暂存的删除先退回成未暂存的，`stash push -- <路径>` 才不会存了一半（见 `stashPaths`）。
          // 代价：Apply 回来后改名显示成新增 + 删除两行（不带 --index 的 Apply 本来就不还原暂存状态）。
          if (deletions.length > 0) await repository.run(unstage, root, deletions);
          return repository.run(stashPaths, root, withRenamePartners(paths));
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
    markResolved: async ({ paths }) => {
      await markResolved(paths);
      return null;
    },
    removeConflictFile: async ({ paths }) => {
      await repository.run(removeConflictPaths, repository.location.root, paths);
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
        if (index === 0) await repository.run(removeConflictPaths, root, [path]);
        return null;
      }
      const index = await ui.choose(deletionQuestion(name, change.conflict), [
        "Keep",
        "Delete File",
      ]);
      if (index === 0) await markResolved([path]);
      if (index === 1) await repository.run(removeConflictPaths, root, [path]);
      return null;
    },
    addUntracked: async ({ paths }) => {
      // 和标记已解决是同一条 git add：把工作区里的这几份写进暂存区。不确认。
      await repository.run(addPaths, repository.location.root, paths);
      return null;
    },
    deleteUntracked: async ({ paths }) => {
      const [only] = paths;
      if (only === undefined) return null;
      const sure =
        paths.length === 1
          ? await ui.confirm(`Delete ${basename(only)}? This cannot be undone.`, "Delete")
          : await ui.confirm(
              `Delete ${paths.length} files? This cannot be undone.`,
              "Delete",
              paths.map(basename),
            );
      if (!sure) return null;
      // 未跟踪的文件 git 不管，直接删磁盘上的；watcher 看到变化就刷新。
      const root = repository.location.root;
      for (const path of paths) await rm(join(root, ...path.split("/")));
      return null;
    },
    rollback: async ({ paths }) => {
      // 未跟踪文件不归 Rollback 管。一个已跟踪的都没有就什么都不做。
      const { tracked, withRenamePartners } = await inspect(paths);
      if (tracked.length === 0 || !(await ui.confirmRollback(tracked))) return null;
      await repository.run(rollback, repository.location.root, withRenamePartners(tracked));
      return null;
    },
  });
}

function pushDone(
  kind: PushKind.Pushed | PushKind.UpToDate,
  branch: string,
  tracked: string,
): string {
  switch (kind) {
    case PushKind.Pushed:
      return `Pushed ${branch} → ${tracked}`;
    case PushKind.UpToDate:
      return `${tracked} is up to date`;
    default:
      return assertNever(kind, "pushDone");
  }
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

enum UpdateKind {
  Updated = "updated",
  UpToDate = "upToDate",
  Diverged = "diverged",
}

/** 更新一个分支的结局：快进了、本来就是最新、分叉了。 */
interface UpdateResult {
  readonly kind: UpdateKind;
  readonly branch: string;
  /** 跟踪的远程分支，`origin/feat`。 */
  readonly tracked: string;
}

/** 一个分支更新完的说法。分叉时是空的：接下来要问变基还是合并，或者在汇总里报。 */
function updateDone({ kind, branch, tracked }: UpdateResult): string {
  switch (kind) {
    case UpdateKind.Updated:
      return `Updated ${branch} from ${tracked}`;
    case UpdateKind.UpToDate:
      return `${branch} is up to date`;
    case UpdateKind.Diverged:
      return "";
    default:
      return assertNever(kind, "updateDone");
  }
}

/** 一次更新好几个的汇总：`Updated 2 branches, 1 already up to date, 1 diverged`，为 0 的不写。 */
function updateSummary(results: readonly UpdateResult[]): string {
  const count = (kind: UpdateKind) => results.filter((result) => result.kind === kind).length;
  const updated = count(UpdateKind.Updated);
  const parts = [
    ...(count(UpdateKind.UpToDate) > 0 ? [`${count(UpdateKind.UpToDate)} already up to date`] : []),
    ...(count(UpdateKind.Diverged) > 0 ? [`${count(UpdateKind.Diverged)} diverged`] : []),
  ];
  const head = `Updated ${updated === 1 ? "1 branch" : `${updated} branches`}`;
  return [head, ...parts].join(", ");
}

/** 摘、撤一串提交时状态栏上的说法。 */
const REPLAY_WORDS: Readonly<
  Record<ReplayKind, { readonly doing: string; readonly done: string; readonly skipped: string }>
> = {
  [OperationKind.CherryPick]: {
    doing: "Cherry-picking",
    done: "Cherry-picked",
    skipped: "already applied",
  },
  [OperationKind.Revert]: { doing: "Reverting", done: "Reverted", skipped: "already reverted" },
};

/** 一条写短 hash，多条写条数：`1a2b3c4`、`3 commits`。 */
function commitsText(hashes: readonly string[]): string {
  const [only] = hashes;
  return hashes.length === 1 && only !== undefined ? only.slice(0, 7) : countText(hashes.length);
}

function countText(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}

/**
 * 摘、撤完的完成消息：`Cherry-picked 3 commits`；有跳过的写上
 * `Cherry-picked 2 commits, skipped 1 already applied`；全跳过了写 `Skipped 1 already applied`。
 */
function replayDone(kind: ReplayKind, hashes: readonly string[], result: ReplayResult): string {
  switch (result.kind) {
    case ReplayOutcome.Stopped:
      return "Stopped for conflicts";
    case ReplayOutcome.Done: {
      const words = REPLAY_WORDS[kind];
      const made = hashes.length - result.skipped;
      if (result.skipped === 0) return `${words.done} ${commitsText(hashes)}`;
      const skipped = `${result.skipped} ${words.skipped}`;
      return made === 0
        ? `Skipped ${skipped}`
        : `${words.done} ${countText(made)}, skipped ${skipped}`;
    }
    default:
      return assertNever(result, "replayDone");
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

/** 继续做完的完成消息。cherry-pick、revert 里有变空跳过的，写上跳过了几条。 */
function continueDone(kind: OperationKind, result: ContinueResult): string {
  if (result.kind === ContinueOutcome.Stopped) return "Stopped for conflicts";
  const done = completedText(kind);
  if (result.skipped === 0) return done;
  switch (kind) {
    case OperationKind.CherryPick:
    case OperationKind.Revert:
      return `${done}, skipped ${result.skipped} ${REPLAY_WORDS[kind].skipped}`;
    case OperationKind.Merge:
    case OperationKind.Rebase:
      return done;
    default:
      return assertNever(kind, "continueDone");
  }
}

function completedText(kind: OperationKind): string {
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
      return assertNever(kind, "completedText");
  }
}

/** 「正在做的操作」放进句子里的说法。 */
function operationNoun(kind: OperationKind): string {
  switch (kind) {
    case OperationKind.Merge:
      return "a merge";
    case OperationKind.Rebase:
      return "a rebase";
    case OperationKind.CherryPick:
      return "a cherry-pick";
    case OperationKind.Revert:
      return "a revert";
    default:
      return assertNever(kind, "operationNoun");
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

/** reset 对话框的按钮顺序：对文件的影响从小到大。 */
const RESET_MODES: readonly ResetMode[] = [
  ResetMode.Soft,
  ResetMode.Mixed,
  ResetMode.Keep,
  ResetMode.Hard,
];

function resetLabel(mode: ResetMode): string {
  switch (mode) {
    case ResetMode.Soft:
      return "Soft";
    case ResetMode.Mixed:
      return "Mixed";
    case ResetMode.Keep:
      return "Keep";
    case ResetMode.Hard:
      return "Hard";
    default:
      return assertNever(mode, "resetLabel");
  }
}

/** 每种做法对文件的影响，写在 reset 对话框的说明里，让人选之前知道会不会丢改动。 */
function resetEffect(mode: ResetMode): string {
  switch (mode) {
    case ResetMode.Soft:
      return "Files won't change, differences will be staged for commit.";
    case ResetMode.Mixed:
      return "Files won't change, differences won't be staged.";
    case ResetMode.Keep:
      return "Files will be reverted to the state of the selected commit, but local changes will be kept intact.";
    case ResetMode.Hard:
      return "Files will be reverted to the state of the selected commit. Warning: any local changes will be lost.";
    default:
      return assertNever(mode, "resetEffect");
  }
}

function firstLine(text: string): string {
  const end = text.indexOf("\n");
  return end === -1 ? text : text.slice(0, end);
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
