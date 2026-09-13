import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PrintEditor } from "./print-editor";
import { PRINT_TEMPLATE_KIND, parsePrintTemplateConfig } from "@/lib/print-template";

export const metadata = { title: "打印预览（可编辑） - 玮川进销存" };

/** 打印前可编辑预览：标题/抬头/列显隐/行内容/行数均可编辑，再打印。 */
export default async function SaleOrderPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  const order = Number.isInteger(id)
    ? await prisma.saleOrder.findUnique({
        where: { id },
        include: {
          customer: true,
          operator: { select: { displayName: true } },
          items: { include: { product: true, unit: true } },
        },
      })
    : null;
  if (!order) notFound();
  // 打印权限不做限制：所有操作员可打印所有销售单

  const data = {
    orderNo: order.orderNo,
    createdAt: order.createdAt.toLocaleDateString("zh-CN"),
    customer: {
      name: order.customer.name,
      phone: order.customer.phone ?? "",
      address: order.customer.address ?? "",
    },
    operatorName: order.operator.displayName,
    /** 制单人：当前登录用户（打印稿上的"制单人"） */
    editorName: user.displayName,
    /** 已收金额：预填到打印稿的"收款金额" */
    receivedAmount: Number(order.receivedAmount),
    remark: order.remark ?? "",
    rows: order.items.map((item) => ({
      code: item.product.code,
      name: item.product.name,
      qty: Number(item.quantity),
      unit: item.unit.name,
      price: Number(item.unitPrice),
      remark: item.remark ?? "",
    })),
  };

  const templates = await prisma.printTemplate.findMany({
    where: { kind: PRINT_TEMPLATE_KIND },
    // 默认模板排最前，打印页打开时套用的就是它
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: { id: true, name: true, isDefault: true, config: true },
  });

  return (
    <PrintEditor
      data={data}
      canManage={user.role === "admin"}
      templates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        isDefault: t.isDefault,
        config: parsePrintTemplateConfig(t.config),
      }))}
    />
  );
}
