import { type ChildProcess, spawn } from "node:child_process";
import {
  type ExecResult,
  GitCancelledError,
  type GitLogger,
  NOOP_LOGGER,
  type RawExecResult,
} from "./types.js";

export interface ExecOptions {
  /** git 的工作目录。决定命令作用在哪个仓库上。 */
  readonly cwd: string;
  /**
   * 这条命令额外需要的环境变量，由命令层按需传入。
   * 优先级：`process.env` < `options.env` < 全局强制项。
   *
   * 典型用途：`status` 要带 `GIT_OPTIONAL_LOCKS=0` 防刷新回路。
   * 进程层不认识「status」是什么，所以这种按命令区分的变量必须从上面传下来。
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * 喂给 git 的 stdin 内容。不传则 stdin 指向 /dev/null，git 读到立刻 EOF。
   *
   * 注意：空 stdin 对某些命令是**静默成功**（`hash-object --stdin` 会返回空内容的
   * 合法哈希）。进程层无从判断命令是否需要输入，所以这条约束落在命令层：
   * 读 stdin 的命令，其包装函数的 input 参数必填。
   */
  readonly input?: string;
  /** 取消信号。abort 时杀掉子进程，`execRaw`/`exec` 抛 `GitCancelledError`。 */
  readonly signal?: AbortSignal;
}

/**
 * 每个 git 子进程都强制注入，调用方不可覆盖。
 *
 * 前两条堵「git 停下来等人」——那是最坏的故障：无错误、无退出码、无法诊断，
 * 只能重启宿主。宁可快速失败。
 */
const FORCED_ENV = {
  // git 要密码时不读 stdin，而是直接开 /dev/tty 绕过管道。这是唯一拦得住的开关。
  GIT_TERMINAL_PROMPT: "0",
  // 防 less 挂住。git 本来就检测 isatty 自动关分页器，这条是零成本的冗余保险。
  GIT_PAGER: "cat",
  // 错误消息锁定英文。⚠️ `failure.ts` 的两条分类正则是英文的，删掉这三行会让分类
  // **静默失效**——不报错，只是永远返回 undefined。用 en_US.UTF-8 而非 C：C locale 字符集是 ASCII。
  LANGUAGE: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  LANG: "en_US.UTF-8",
  // 非 ASCII 路径原样输出，不转义成 \344\275\240。
  GIT_CONFIG_PARAMETERS: "'core.quotepath=false'",
} as const;

/** git 进程层。`gitPath` 由外部注入——探测它需要读 VSCode 配置，不属于这一层。 */
export class GitCli {
  constructor(
    private readonly gitPath: string,
    private readonly logger: GitLogger = NOOP_LOGGER,
  ) {}

  /**
   * 造一个「只记一次」的日志函数，并开始计时。
   *
   * 必须只记一次：进程起不来时 Node 先发 `error`、**随后还会发 `close`**
   * （带一个假退出码，errno 取负），两个处理器会把同一条命令记两遍。
   *
   * 只记命令行、耗时、结局——**不记 stdout**：它可能是几 MB 的 log 或文件内容。
   */
  private makeLogOnce(args: readonly string[]): (outcome: string) => void {
    const startedAt = Date.now();
    let logged = false;
    return (outcome: string): void => {
      if (logged) return;
      logged = true;
      const shown = args.map((arg) => {
        // --format= 的值是一长串分隔符，刷屏且无信息量，折叠掉。
        if (arg.startsWith("--format=")) return "--format=...";
        if (arg === "") return '""';
        return arg.includes(" ") ? `"${arg}"` : arg;
      });
      this.logger.log(`> git ${shown.join(" ")} [${Date.now() - startedAt}ms] ${outcome}`);
    };
  }

  /** 所有 spawn 配置的唯一出处（stdio、取消信号后续都加在这里）。 */
  private spawnChild(args: readonly string[], options: ExecOptions): ChildProcess {
    // POSIX 下独立成一个进程组，为的是取消时能连子孙一起杀（见下面 onAbort 的注释）。
    // Windows 上 `detached` 不提供同等的组信号语义，这里置 false，保持原行为。
    const detached = process.platform !== "win32";
    const child = spawn(this.gitPath, args, {
      cwd: options.cwd,
      // 不走 shell：参数以数组传递，没有引号转义问题。
      shell: false,
      // 必须合并而非替换：git 依赖 PATH 找子命令、HOME 读 ~/.gitconfig、
      // SSH_AUTH_SOCK 做认证。FORCED_ENV 在最后，确保覆盖用户的同名设置。
      env: { ...process.env, ...options.env, ...FORCED_ENV },
      // 不给 stdin 管道，git 就无法停下来等输入。
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached,
    });

    if (options.input !== undefined) {
      // end() 而非 write()：不关闭管道的话 git 等不到 EOF，一样会挂住。
      child.stdin?.end(options.input, "utf8");
    }

    const { signal } = options;
    if (signal !== undefined) {
      const onAbort = (): void => {
        // 只杀 git 自己是不够的：它可能起了子进程（pre-commit 钩子、
        // 将来的 askpass 凭据助手），且那些子进程继承了 stdout/stderr 管道。
        // 我们监听的是 `close`（见下方注释），而 `close` 要等**所有持有管道的
        // 进程**都退出才触发——单杀 git 本身，孤儿子进程会继续跑到自然结束，
        // 取消形同虚设（实测：pre-commit 钩子 sleep 3 秒，单杀 git 时 `close`
        // 仍然要等满 3 秒；杀整个进程组后降到 ~300ms）。
        //
        // 用负 pid 给整个进程组发信号是 POSIX 语义，Windows 没有对应物，
        // 那边退回单杀 git——已知的不完整取消，记入 `.notes/NFR.md`。
        if (detached && child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGTERM");
            return;
          } catch {
            // 进程组已经不存在（比如子进程已经自己退出了），退到单杀兜底。
          }
        }
        child.kill();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // 必须摘掉：signal 可能活很久（一个仓库一个），每条命令留一个监听器就是泄漏。
      child.once("close", () => signal.removeEventListener("abort", onAbort));
    }

    return child;
  }

  /** 跑完一条命令，交回原始字节。非零退出码不抛；只有进程起不来或被信号杀死才 reject。 */
  execRaw(args: readonly string[], options: ExecOptions): Promise<RawExecResult> {
    return new Promise<RawExecResult>((resolve, reject) => {
      const logOnce = this.makeLogOnce(args);
      // 已经取消了就别起进程：批量取消时队列里排着的命令都拿到已 abort 的 signal，
      // 少了这一步就是几十次白起白杀。
      if (options.signal?.aborted === true) {
        logOnce("cancelled before start");
        reject(new GitCancelledError(args));
        return;
      }
      const child = this.spawnChild(args, options);

      if (child.stdout === null || child.stderr === null) {
        reject(new Error("spawn 未能建立 stdout/stderr 管道"));
        return;
      }

      // 存 Buffer 不存 string：逐块解码会把跨块的多字节字符劈成两半。
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      // error = 进程起不来（ENOENT 等），与 git 返回非零是两回事。
      child.on("error", (error) => {
        logOnce(`failed: ${error.message}`);
        reject(error);
      });

      // 用 close 不用 exit：exit 时管道可能还有没读完的数据。
      child.on("close", (code, signal) => {
        // 被信号杀死时没有退出码。不伪造一个数字糊弄过去。
        if (code === null) {
          logOnce(`killed by ${signal}`);
          // 区分「我们主动取消」和「被别人杀了」：前者是控制流，不是故障。
          reject(
            options.signal?.aborted === true
              ? new GitCancelledError(args)
              : new Error(`git 被信号 ${signal} 终止：${args.join(" ")}`),
          );
          return;
        }
        logOnce(`exit ${code}`);
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        });
      });
    });
  }

  /** 日常入口：`execRaw()` 加一层 UTF-8 解码。 */
  async exec(args: readonly string[], options: ExecOptions): Promise<ExecResult> {
    const raw = await this.execRaw(args, options);
    return {
      exitCode: raw.exitCode,
      stdout: raw.stdout.toString("utf8"),
      stderr: raw.stderr,
    };
  }
}
