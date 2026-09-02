"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireLogin } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { buildOrderNo, ORDER_NO_PREFIXES, todayCompact } from "@/lib/order-no";

export type FormState = { error?: string; ok?: string } | null;

const paymentSchema = z.object({
  direction: z.enum(["receipt", "payment"]),
  orderType: z.enum(["sale", "purchase"]),
  orderId: z.coerce.number().int().positive("请选择单据"),
  amount: z.coerce.number().positive("金额必须大于 0").max(9_999_999_999.99),
  method: z.enum(["cash", "bank", "wechat", "alipay", "other"]),
  remark: z.string().trim().max(200),
});

export async function createPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireLogin();
  if (user.role === "sales") return { error: "业务员无收付款权限" };

  const parsed = paymentSchema.safeParse({
    direction: formData.get("direction"),
    orderType: formData.get("orderType"),
    orderId: formData.get("orderId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    remark: formData.get("remark") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  const { direction, orderType, orderId, amount, method, remark } = parsed.data;

  let outstanding = 0;
  let orderNo = "";

  if (orderType === "sale") {
    const order = await prisma.saleOrder.findUnique({
      where: { id: orderId },
      include: { returns: { where: { status: "confirmed" } } },
    });
    if (!order) return { error: "售卖单不存在" };
    if (order.status === "voided") return { error: "已作废售卖单不可收款" };
    const returned = order.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
    outstanding = Number(order.totalAmount) - Number(order.receivedAmount) - returned;
    orderNo = order.orderNo;
  } else {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { returns: { where: { status: "confirmed" } } },
    });
    if (!order) return { error: "进货单不存在" };
    if (order.status === "voided") return { error: "已作废进货单不可付款" };
    const returned = order.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
    outstanding = Number(order.totalAmount) - Number(order.paidAmount) - returned;
    orderNo = order.orderNo;
  }
  if (amount > outstanding) {
    return { error: `超出未收付金额：该单未结清 ${outstanding.toFixed(2)}，本次 ${amount.toFixed(2)}` };
  }

  const prefix = direction === "receipt" ? ORDER_NO_PREFIXES.PAY : ORDER_NO_PREFIXES.POF;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const rows = await tx.payment.findMany({
          where: { orderNo: { startsWith: `${prefix}${todayCompact()}-` } },
          select: { orderNo: true },
        });
        let maxSeq = 0;
        for (const r of rows) {
          const seq = Number(/-(\d{4})$/.exec(r.orderNo)?.[1] ?? 0);
          if (seq > maxSeq) maxSeq = seq;
        }
        const payment = await tx.payment.create({
          data: {
            orderNo: buildOrderNo(prefix, maxSeq + 1),
            direction,
            orderType,
            orderId,
            amount,
            method,
            remark: remark || null,
            operatorId: user.id,
          },
          select: { id: true, orderNo: true },
        });
        // 同步冗余：单据已收/已付金额
        if (orderType === "sale") {
          await tx.saleOrder.update({
            where: { id: orderId },
            data: { receivedAmount: { increment: amount } },
          });
        } else {
          await tx.purchaseOrder.update({
            where: { id: orderId },
            data: { paidAmount: { increment: amount } },
          });
        }
        return payment;
      });
      await writeAudit({
        userId: user.id,
        action: "create",
        entityType: "payment",
        entityId: result.id,
        after: { orderNo: result.orderNo, direction, orderType, orderId, amount, method },
      });
      revalidatePath("/receivables-payables");
      revalidatePath(`/purchase-orders/${orderId}`);
      revalidatePath(`/sale-orders/${orderId}`);
      return {
        ok: `${direction === "receipt" ? "收款" : "付款"}登记成功（${result.orderNo}，关联 ${orderNo}）`,
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      console.error("[payment] 登记失败:", err);
      return { error: "登记失败，请重试" };
    }
  }
  return { error: "单据号生成失败，请重试" };
}

/** 作废收付款登记：冲回单据已收/已付金额（错误更正场景） */
export async function voidPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireLogin();
  if (user.role === "sales") return { error: "业务员无此权限" };

  const id = Number(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!reason) return { error: "请填写作废原因" };

  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) return { error: "收付款记录不存在" };
  if (payment.status === "voided") return { error: "记录已作废" };

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id },
      data: { status: "voided", voidedBy: user.id, voidedAt: new Date(), voidReason: reason },
    });
    const amount = Number(payment.amount);
    if (payment.orderType === "sale") {
      await tx.saleOrder.update({
        where: { id: payment.orderId },
        data: { receivedAmount: { decrement: amount } },
      });
    } else {
      await tx.purchaseOrder.update({
        where: { id: payment.orderId },
        data: { paidAmount: { decrement: amount } },
      });
    }
  });
  await writeAudit({
    userId: user.id,
    action: "void",
    entityType: "payment",
    entityId: id,
    before: { orderNo: payment.orderNo, status: payment.status },
    after: { orderNo: payment.orderNo, status: "voided", voidReason: reason },
  });
  revalidatePath("/receivables-payables");
  revalidatePath(`/purchase-orders/${payment.orderId}`);
  revalidatePath(`/sale-orders/${payment.orderId}`);
  return { ok: "已作废，收付金额已冲回" };
}
