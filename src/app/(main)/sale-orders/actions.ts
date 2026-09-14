"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { firstIssueMessage, optionalNumber, requiredNumber } from "@/lib/form-number";
import { createSaleOrder } from "@/lib/services/orders/sale-create";
import { humanActor } from "@/lib/cli/types";
import { voidSaleOrder } from "@/lib/services/orders/void-and-reopen";

export type FormState = { error?: string; ok?: string } | null;

const itemSchema = z.object({
  productId: z.coerce.number().int().positive("请选择商品"),
  /** 估价待补：只填售价，进价与货源后补 */
  estimated: z.boolean().optional(),
  /** 行内单位（估价行可选/可就地新建）；不传就用商品的单位 */
  unitId: z.coerce.number().int().positive().optional(),
  quantity: requiredNumber({
    invalid: "请填写数量",
    min: 0.001,
    minMessage: "数量必须大于 0",
    max: 9_999_999.999,
    maxMessage: "数量过大",
  }),
  unitPrice: requiredNumber({
    invalid: "请填写售价",
    min: 0,
    max: 9_999_999_999.99,
    maxMessage: "售价格式不正确",
  }), // 售价
  supplyPrice: requiredNumber({
    invalid: "请填写进价",
    min: 0,
    max: 9_999_999_999.99,
    maxMessage: "进价格式不正确",
  }), // 自动补货进价
  supplierId: z.coerce.number().int().positive().optional().nullable(), // 缺货行需厂家
  // 多补：在自动补足缺口之外额外多进的备货量（不允许负数）；不填＝不多补
  extraQty: optionalNumber({
    invalid: "多补必须是数字",
    min: 0,
    minMessage: "多补不能为负",
    max: 9_999_999.999,
    maxMessage: "多补过大",
  }).default(0),
  remark: z.string().trim().max(200).optional().default(""), // 行备注
  // 本次使用的现有库存数量（留空＝尽量用库存；填 0＝全部现场进货）
  // 留空必须视为「未填写」而不是 0，见 src/lib/form-number.ts 的说明
  stockUsed: optionalNumber({
    invalid: "用库存必须是数字",
    min: 0,
    minMessage: "用库存不能为负",
    max: 9_999_999.999,
    maxMessage: "用库存过大",
  }),
});

const createSchema = z.object({
  customerId: z.coerce.number().int().positive("请选择客户"),
  remark: z.string().trim().max(200),
  items: z.array(itemSchema).min(1, "请至少添加一行商品"),
});

/** 行字段的中文标签（报错说成「第 2 行「售价」：…」而不是字段名） */
const ITEM_LABELS = { unitPrice: "售价", supplyPrice: "进价" };


async function requireSaleWrite() {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  if (user.role === "boss") throw new Error("老板/财务无销售开单权限");
  return user;
}

function parseCreatePayload(formData: FormData) {
  const items: unknown[] = [];
  let i = 0;
  while (formData.has(`item_${i}_productId`)) {
    // 未选择商品的空行直接跳过（加行后未填写不应阻塞提交）
    if (!String(formData.get(`item_${i}_productId`) || "").trim()) {
      i++;
      continue;
    }
    items.push({
      productId: formData.get(`item_${i}_productId`),
      quantity: formData.get(`item_${i}_quantity`),
      unitPrice: formData.get(`item_${i}_unitPrice`),
      supplyPrice: formData.get(`item_${i}_supplyPrice`) ?? 0,
      supplierId: formData.get(`item_${i}_supplierId`) || undefined,
      extraQty: formData.get(`item_${i}_extraQty`) || 0,
      remark: formData.get(`item_${i}_remark`) || "",
      stockUsed: formData.get(`item_${i}_stockUsed`) ?? undefined,
      // 估价待补：这一行只知道售价，进价与货源后补（不消耗库存、不自动补货）
      estimated: formData.get(`item_${i}_estimated`) === "1",
      unitId: formData.get(`item_${i}_unitId`) || undefined,
    });
    i++;
  }
  return createSchema.safeParse({
    customerId: formData.get("customerId"),
    remark: formData.get("remark") ?? "",
    items,
  });
}


export async function createSaleOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireSaleWrite();

  // 薄壳：解析表单 → 调服务层 → 刷新与跳转。
  // 业务逻辑（库存扣减、成本快照、自动补货、审计）全在 lib/services/orders/sale-create.ts，
  // 与 CLI 走的是同一份代码——所以"页面开出来的单"和"CLI 开出来的单"不可能不一致。
  const parsed = parseCreatePayload(formData);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error, ITEM_LABELS) };
  }
  const { customerId, remark, items } = parsed.data;

  const result = await createSaleOrder(
    humanActor(user),
    { customerId, remark, items, starred: formData.get("starred") === "1" },
    { dryRun: false }
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/sale-orders");
  redirect("/sale-orders");
}

export async function voidSaleOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  // 薄壳：逻辑在 lib/services/orders/void-and-reopen.ts，与 CLI 共用同一份
  const result = await voidSaleOrder(
    humanActor(user),
    { id: Number(formData.get("id")), reason: String(formData.get("reason") ?? "").trim().slice(0, 200) },
    { dryRun: false }
  );
  if (!result.ok) return { error: result.error.message };

  const id = Number(formData.get("id"));
  revalidatePath(`/sale-orders/${id}`);
  revalidatePath("/sale-orders");
  return { ok: "已作废，库存已冲回" };
}

export async function toggleSaleOrderStarAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const id = Number(formData.get("id"));
  const starred = formData.get("starred") === "1";
  if (!Number.isInteger(id) || id <= 0) return;

  const order = await prisma.saleOrder.findUnique({
    where: { id },
    select: { id: true, operatorId: true, starred: true },
  });
  if (!order || order.starred === starred) return;
  if (user.role === "sales" && order.operatorId !== user.id) return;

  await prisma.saleOrder.update({ where: { id }, data: { starred } });
  await writeAudit({
    userId: user.id,
    action: "update",
    entityType: "sale_order",
    entityId: id,
    before: { starred: order.starred },
    after: { starred },
  });
  revalidatePath("/sale-orders");
  revalidatePath(`/sale-orders/${id}`);
}
