"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { firstIssueMessage, requiredNumber } from "@/lib/form-number";
import { parseReturnRows } from "@/lib/return-rows";
import { createPurchaseReturn, voidPurchaseReturn } from "@/lib/services/orders/purchase-return";
import { humanActor } from "@/lib/cli/types";

export type FormState = { error?: string; ok?: string } | null;

const itemSchema = z.object({
  orderItemId: z.coerce.number().int().positive(),
  quantity: requiredNumber({
    invalid: "请填写退货数量",
    min: 0.001,
    minMessage: "退货数量必须大于 0（不退货的行留空即可）",
    max: 9_999_999.999,
    maxMessage: "退货数量过大",
  }),
  unitPrice: requiredNumber({
    invalid: "请填写退货单价",
    min: 0,
    max: 9_999_999_999.99,
    maxMessage: "退货单价格式不正确",
  }),
});

const createSchema = z.object({
  purchaseOrderId: z.coerce.number().int().positive(),
  items: z.array(itemSchema).min(1, "请至少填写一行退货数量（不退货的行留空即可）"),
});


export async function createPurchaseReturnAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  // 薄壳：解析表单 → 调服务层 → 刷新与跳转（逻辑在 lib/services/orders/purchase-return.ts）
  const { items } = parseReturnRows(formData);
  const parsed = createSchema.safeParse({ purchaseOrderId: formData.get("purchaseOrderId"), items });
  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  const result = await createPurchaseReturn(humanActor(user), parsed.data, { dryRun: false });
  if (!result.ok) return { error: result.error.message };

  const orderNo = (result.data.plan as { 退货单: string }).退货单;
  revalidatePath("/purchase-returns");
  revalidatePath(`/purchase-orders/${parsed.data.purchaseOrderId}`);
  redirect(`/purchase-returns?created=${encodeURIComponent(orderNo)}`);
}

/** 作废退货单：库存加回、应付冲减恢复（概览口径动态计算，作废即生效） */
export async function voidPurchaseReturnAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  const result = await voidPurchaseReturn(
    humanActor(user),
    { id: Number(formData.get("id")), reason: String(formData.get("reason") ?? "").trim().slice(0, 200) },
    { dryRun: false }
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/purchase-returns");
  return { ok: (result.data.plan as { 说明: string }).说明 };
}
