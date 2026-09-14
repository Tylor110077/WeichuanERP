import { prisma, type TxClient } from "@/lib/prisma";

/**
 * dry-run 的落地方式：**事务回滚探针**。
 *
 * 不另写一套"预演逻辑"，而是让 dry-run **跑真实的业务代码路径**：
 * 在事务里照常写入、算出真实的库存与成本，然后抛一个标记异常把事务回滚掉，
 * 把过程中算出的 plan 带出来。这样"预告的"和"真做的"在结构上不可能不一致。
 *
 * 为什么不另写预演：这个项目里凡是"同一件事写两遍"的地方最后都漂了——
 * 7 份 dateRange 副本、4 处应收应付 SQL、页面与服务各一份列表查询。
 * 预告与实际一旦分叉，Agent 场景下就是"照着预告做决策、结果账不对"。
 *
 * 前提（违反了探针就不准）：事务内**不做不可回滚的外部副作用**——不写文件、
 * 不发邮件、不调外部接口。目前所有业务写都在事务内，符合。
 *
 * ⚠️ 一个已知代价：**MySQL 的 AUTO_INCREMENT 不随事务回滚**，所以每次预演都会
 * 烧掉一个自增 id（实测：预演拿到 1164、随后真落库是 1165）。业务上无害——
 * 商品编码是"取当前最大 id + 1 再查重"，不依赖 id 与编码对齐——但要知道
 * "预演一百次"会把自增计数器推后一百。这是"预告必须等于实际"换来的代价，我接受它。
 */

/** 内部标记异常：只用来把事务回滚并把 plan 带出来，不该被当成业务错误 */
export class DryRunRollback<T> extends Error {
  constructor(readonly plan: T) {
    super("__DRY_RUN_ROLLBACK__");
    this.name = "DryRunRollback";
  }
}

export interface RunResult<T> {
  /** true = 已提交落库；false = dry-run，什么都没写 */
  committed: boolean;
  plan: T;
}

/**
 * 在事务里跑 fn；dryRun 为 true 时回滚并返回 plan。
 * fn 内部应当把"这次要改什么"都放进返回值——它就是 dry-run 的摘要。
 */
export async function runInTransaction<T>(
  dryRun: boolean,
  fn: (tx: TxClient) => Promise<T>
): Promise<RunResult<T>> {
  try {
    const plan = await prisma.$transaction(async (tx) => {
      const result = await fn(tx);
      if (dryRun) throw new DryRunRollback(result);
      return result;
    });
    return { committed: true, plan };
  } catch (e) {
    if (e instanceof DryRunRollback) return { committed: false, plan: e.plan as T };
    throw e;
  }
}
