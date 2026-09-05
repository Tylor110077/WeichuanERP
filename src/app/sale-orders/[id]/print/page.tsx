import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PrintEditor } from "./print-editor";

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
      contact: order.customer.contact ?? "",
      phone: order.customer.phone ?? "",
      address: order.customer.address ?? "",
    },
    operatorName: order.operator.displayName,
    remark: order.remark ?? "",
    rows: order.items.map((item) => ({
      code: item.product.code,
      name: item.product.name,
      qty: Number(item.quantity),
      unit: item.unit.name,
      price: Number(item.unitPrice),
    })),
  };

  return <PrintEditor data={data} />;
}
