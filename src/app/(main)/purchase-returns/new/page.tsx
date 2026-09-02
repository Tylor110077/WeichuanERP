import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ReturnForm } from "./return-form";

export const metadata = { title: "进货退货 - 玮川进销存" };

export default async function NewPurchaseReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "boss") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限开退货单（管理员/业务员）
      </div>
    );
  }

  const { orderId } = await searchParams;
  const id = Number(orderId);
  const order = Number.isInteger(id)
    ? await prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: { select: { name: true } },
          items: { include: { product: true, unit: true } },
          returns: { where: { status: "confirmed" }, include: { items: true } },
        },
      })
    : null;

  if (!order) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        未找到原进货单，请从进货单详情页发起退货。
      </div>
    );
  }
  if (order.status !== "received") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        仅已入库的进货单可退货（当前状态：{order.status}）
      </div>
    );
  }
  if (user.role === "sales" && order.operatorId !== user.id) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        只能对自己开的进货单退货
      </div>
    );
  }

  const returnedByItem = new Map<number, number>();
  for (const r of order.returns) {
    for (const rItem of r.items) {
      returnedByItem.set(
        rItem.purchaseOrderItemId,
        (returnedByItem.get(rItem.purchaseOrderItemId) ?? 0) + Number(rItem.quantity)
      );
    }
  }

  const rows = order.items.map((item) => {
    const returned = returnedByItem.get(item.id) ?? 0;
    const remaining = Number(item.quantity) - returned;
    return {
      orderItemId: item.id,
      code: item.product.code,
      name: item.product.name,
      unitName: item.unit.name,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      remaining,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          进货退货 ｜ 原单 {order.orderNo}（{order.supplier.name}）
        </h1>
        <Link href={`/purchase-orders/${order.id}`} className="text-sm text-blue-600 hover:underline">
          ← 返回原单
        </Link>
      </div>
      <ReturnForm purchaseOrderId={order.id} rows={rows} />
    </div>
  );
}
