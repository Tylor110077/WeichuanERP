"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { firstIssueMessage, requiredNumber } from "@/lib/form-number";
import { createPurchaseOrder } from "@/lib/services/orders/purchase-create";
import { humanActor } from "@/lib/cli/types";
import { receivePurchaseOrder } from "@/lib/services/orders/purchase-receive";
import { voidPurchaseOrder } from "@/lib/services/orders/void-and-reopen";

export type FormState = { error?: string; ok?: string } | null;

const itemSchema = z.object({
  productId: z.coerce.number().int().positive("请选择商品"),
  quantity: requiredNumber({
    invalid: "请填写数量",
    min: 0.001,
    minMessage: "数量必须大于 0",
    max: 9_999_999.999,
    maxMessage: "数量过大",
  }),
  unitPrice: requiredNumber({
    invalid: "请填写进价",
    min: 0,
    max: 9_999_999_999.99,
    maxMessage: "进价格式不正确",
  }),
  remark: z.string().trim().max(200).optional().default(""), // 行备注
});

const createSchema = z.object({
  supplierId: z.coerce.number().int().positive("请选择厂家"),
  remark: z.string().trim().max(200),
  items: z.array(itemSchema).min(1, "请至少添加一行商品"),
});


async function requirePurchaseWrite() {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  if (user.role === "boss") throw new Error("老板/财务无进货开单权限");
  return user;
}

function parseCreatePayload(formData: FormData) {
  const items: unknown[] = [];
  let i = 0;
  while (formData.has(`item_${i}_productId`)) {
    // 未选择商品的空行直接跳过
    if (!String(formData.get(`item_${i}_productId`) || "").trim()) {
      i++;
      continue;
    }
    items.push({
      productId: formData.get(`item_${i}_productId`),
      quantity: formData.get(`item_${i}_quantity`),
      unitPrice: formData.get(`item_${i}_unitPrice`),
      remark: formData.get(`item_${i}_remark`) || "",
    });
    i++;
  }
  return createSchema.safeParse({
    supplierId: formData.get("supplierId"),
    remark: formData.get("remark") ?? "",
    items,
  });
}


export async function createPurchaseOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requirePurchaseWrite();

  // 薄壳：解析表单 → 调服务层 → 刷新与跳转（业务逻辑在 lib/services/orders/purchase-create.ts，
  // 与 CLI 共用同一份，所以"页面开出来的单"与"CLI 开出来的单"不可能不一致）。
  const parsed = parseCreatePayload(formData);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error, { unitPrice: "进价" }) };
  }
  const result = await createPurchaseOrder(
    humanActor(user),
    { ...parsed.data, starred: formData.get("starred") === "1" },
    { dryRun: false }
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/purchase-orders");
  redirect("/purchase-orders");
}

export async function receivePurchaseOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  // 薄壳：逻辑在 lib/services/orders/purchase-receive.ts，与 CLI 共用同一份
  const result = await receivePurchaseOrder(humanActor(user), { id: Number(formData.get("id")) }, { dryRun: false });
  if (!result.ok) return { error: result.error.message };

  const id = Number(formData.get("id"));
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  return { ok: "已确认入库，库存已增加" };
}

export async function voidPurchaseOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  const result = await voidPurchaseOrder(
    humanActor(user),
    { id: Number(formData.get("id")), reason: String(formData.get("reason") ?? "").trim().slice(0, 200) },
    { dryRun: false }
  );
  if (!result.ok) return { error: result.error.message };

  const id = Number(formData.get("id"));
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  return { ok: (result.data.plan as { 说明: string }).说明 };
}

export async function togglePurchaseOrderStarAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const id = Number(formData.get("id"));
  const starred = formData.get("starred") === "1";
  if (!Number.isInteger(id) || id <= 0) return;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, operatorId: true, starred: true },
  });
  if (!order || order.starred === starred) return;
  if (user.role === "sales" && order.operatorId !== user.id) return;

  await prisma.purchaseOrder.update({ where: { id }, data: { starred } });
  await writeAudit({
    userId: user.id,
    action: "update",
    entityType: "purchase_order",
    entityId: id,
    before: { starred: order.starred },
    after: { starred },
  });
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${id}`);
}
