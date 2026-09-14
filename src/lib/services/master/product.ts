import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, type TxClient } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { initials } from "@/lib/pinyin-server";
import { runInTransaction } from "@/lib/services/dry-run";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 商品档案的写操作服务（网页 action 与 CLI 共用）。
 *
 * 口径照抄 src/app/(main)/products/actions.ts，**改动必须同步改页面**：
 * - 名称/厂家必填；单位必须存在且启用；预警线不填按 1
 * - 自动 SKU：P + 6 位序号（按当前最大 id + 1），唯一索引兜底
 * - 仅管理员可维护（与 `requireMasterDataWrite` 同一句话）
 *
 * 与网页版的三点差别（都是 CLI 需要的，不是行为分叉）：
 * 1. **dryRun**：默认预演，用事务回滚探针跑真实路径后回滚（见 services/dry-run.ts）
 * 2. **审计与业务同事务**：写不进去就一起回滚，不留"改了却查不到谁干的"
 * 3. 编码生成在**事务内**做（网页版用的是全局 prisma，见报告 06 §5.2 的同类问题）
 *
 * 注意：**scope 与角色是两道门**。scope（write:master）在端点层由注册表判定；
 * 角色在服务层判定（与网页 guard 一致）。少了后者，一个 sales 的令牌就能改主数据。
 */

const createSchema = z.object({
  name: z.string().trim().min(1, "请填写商品名称（写全名称，如 BV 2.5平方 单芯铜线）").max(100),
  manufacturer: z.string().trim().min(1, "请选择或新建厂家").max(100),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  unitId: z.coerce.number().int().positive("请选择单位"),
  refPurchasePrice: z.coerce.number().min(0).max(9_999_999_999.99).optional(),
  refSalePrice: z.coerce.number().min(0).max(9_999_999_999.99).optional(),
  /** 预警线：不填按 1（与页面一致） */
  minStock: z.coerce.number().min(0).max(9_999_999_999.999).optional(),
});

export type CreateProductInput = z.input<typeof createSchema>;

/** 自动 SKU：P + 6 位序号。在事务内取号，避免并发下与网页同时建号撞车。 */
async function nextProductCode(tx: TxClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const last = await tx.product.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    const code = `P${String((last?.id ?? 0) + 1).padStart(6, "0")}`;
    const exists = await tx.product.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error("商品编码生成失败，请重试");
}

export async function createProduct(
  actor: Actor,
  rawInput: CreateProductInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role !== "admin") return fail("FORBIDDEN", "基础资料仅管理员可维护");

  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const input = parsed.data;

  const unit = await prisma.unit.findUnique({ where: { id: input.unitId }, select: { id: true, name: true, status: true } });
  if (!unit) return fail("INVALID", "单位不存在");
  if (unit.status !== 1) return fail("RULE", "单位已停用，请先启用或换一个");

  if (input.categoryId != null) {
    const cat = await prisma.productCategory.findUnique({ where: { id: input.categoryId }, select: { status: true } });
    if (!cat) return fail("INVALID", "分类不存在");
    if (cat.status !== 1) return fail("RULE", "分类已停用，请先启用或换一个");
  }

  // 同名 + 同厂家视为重复：厂家不同型号不同时允许同名（与页面的宽松策略一致，只在完全一样时拦）
  const dup = await prisma.product.findFirst({
    where: { name: input.name, manufacturer: input.manufacturer },
    select: { id: true, code: true },
  });
  if (dup) return fail("CONFLICT", `已存在同名同厂家的商品：${dup.code} ${input.name}`);

  try {
    const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
      const code = await nextProductCode(tx);
      const created = await tx.product.create({
        data: {
          code,
          name: input.name,
          manufacturer: input.manufacturer,
          categoryId: input.categoryId ?? null,
          unitId: input.unitId,
          refPurchasePrice: input.refPurchasePrice ?? 0,
          refSalePrice: input.refSalePrice ?? 0,
          minStock: input.minStock ?? 1,
          createdBy: actor.userId,
        },
        select: { id: true, code: true, name: true, searchPinyin: true },
      });
      await writeAudit({
        userId: actor.userId,
        action: "create",
        entityType: "product",
        entityId: created.id,
        tx,
        ip: "cli",
        after: {
          code: created.code,
          name: created.name,
          manufacturer: input.manufacturer,
          unitId: input.unitId,
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });
      return {
        商品: { id: created.id, code: created.code, name: created.name },
        厂家: input.manufacturer,
        单位: unit.name,
        分类: input.categoryId ?? null,
        参考进价: (input.refPurchasePrice ?? 0).toFixed(2),
        参考售价: (input.refSalePrice ?? 0).toFixed(2),
        预警线: (input.minStock ?? 1).toFixed(3),
        // 拼音检索串由 Prisma 扩展自动维护；这里回显出来，便于确认"建完能搜到"
        拼音检索串: created.searchPinyin,
      };
    });

    return ok({
      committed,
      dryRun: !committed,
      ...(committed ? {} : { 说明: "这是预演，什么都没写。确认无误后加 --yes 真落库" }),
      plan,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("CONFLICT", "商品编码冲突（并发建号），请重试");
    }
    console.error("[master.product.create] 失败:", e);
    return fail("INTERNAL", e instanceof Error ? e.message : "建商品失败");
  }
}

/** 启停商品：停用是软删（保留历史单据引用），因此只改 status */
export async function setProductStatus(
  actor: Actor,
  rawInput: { productId: number; enabled: boolean },
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role !== "admin") return fail("FORBIDDEN", "基础资料仅管理员可维护");

  const parsed = z
    .object({ productId: z.coerce.number().int().positive(), enabled: z.coerce.boolean() })
    .safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const { productId, enabled } = parsed.data;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, code: true, name: true, status: true },
  });
  if (!product) return fail("NOT_FOUND", `商品不存在：#${productId}`);
  if ((product.status === 1) === enabled) {
    return fail("RULE", `商品 ${product.code} 已经是「${enabled ? "启用" : "停用"}」状态`);
  }

  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    await tx.product.update({ where: { id: productId }, data: { status: enabled ? 1 : 0 } });
    await writeAudit({
      userId: actor.userId,
      action: "update",
      entityType: "product",
      entityId: productId,
      tx,
      ip: "cli",
      before: { code: product.code, name: product.name, status: product.status },
      after: { code: product.code, name: product.name, status: enabled ? 1 : 0 },
    });
    return { 商品: `${product.code} ${product.name}`, 状态: enabled ? "启用" : "停用" };
  });

  return ok({
    committed,
    dryRun: !committed,
    ...(committed ? {} : { 说明: "这是预演，什么都没写。确认无误后加 --yes 真落库" }),
    plan,
  });
}

/** 供 CLI 帮助显示：商品名的拼音首字母（与页面下拉候选同一套） */
export { initials };
