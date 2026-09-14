import { fail, ok, type Actor, type CliResult } from "./types";

/**
 * 命令注册表：**唯一**声明"这个 op 需要什么权限"的地方。
 *
 * 为什么集中在这里：现状没有 middleware.ts，鉴权散落在每个 page 与每个 action 里
 * （同类问题在网页侧已经反复出现）。命令面会长到几十条，权限一旦分散，
 * 新增命令漏挂鉴权是迟早的事；集中成一张表，漏挂会立刻显出来。
 */
export interface OpDef {
  /** 需要的 scope；null = 登录即可 */
  requiredScope: string | null;
  /** 人类专属：Agent 令牌一律拒绝（审核类操作走这里，见 §5.6 的"不能自审自批"） */
  humanOnly?: boolean;
  /** 写操作：CLI 默认 dry-run，必须 --yes 才落库（Phase 3 起大量使用） */
  write?: boolean;
  /** 一句话说明，供 --help / 未知命令提示使用 */
  summary: string;
  handler: (actor: Actor, input: Record<string, unknown>) => Promise<CliResult<unknown>>;
}

export const OPS: Record<string, OpDef> = {
  /**
   * 最小闭环：证明 CLI 拿到了合法身份。
   * 返回的身份信息就是后续所有命令的 actor，所以它同时也是"令牌配错了"的排查入口。
   */
  "auth.whoami": {
    requiredScope: null,
    summary: "显示当前令牌对应的身份与权限",
    handler: async (actor) => ok({ actor }),
  },

  /** 仅供自检：验证权限判定真的在工作（Agent 令牌调用应得 403） */
  "auth.check-review": {
    requiredScope: null,
    humanOnly: true,
    summary: "自检用：人类专属操作，Agent 令牌调用必被拒绝",
    handler: async (actor) =>
      actor.kind === "human" ? ok({ allowed: true }) : fail("FORBIDDEN", "Agent 令牌无权审核"),
  },
};

export function findOp(name: string): OpDef | undefined {
  return OPS[name];
}

export function opNames(): string[] {
  return Object.keys(OPS).sort();
}
