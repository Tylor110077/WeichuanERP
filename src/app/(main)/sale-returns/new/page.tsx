import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ReturnForm } from "./return-form";

export const metadata = { title: "销售退货 - 玮川进销存" };

export default async function NewSaleReturnPage({
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
    ? await prisma.saleOrder.findUnique({
        where: { id },
        include: {
          customer: { select: { name: true } },
          items: { include: { product: true, unit: true } },
          returns: { where: { status: "confirmed" }, include: { items: true } },
        },
      })
    : null;

  if (!order) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        未找到原售卖单，请从售卖单详情页发起退货。
      </div>
    );
  }
  if (order.status !== "confirmed") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        仅已开单的售卖单可退货（当前状态：{order.status}）
      </div>
    );
  }
  if (user.role === "sales" && order.operatorId !== user.id) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        只能对自己开的售卖单退货
      </div>
    );
  }

  const returnedByItem = new Map<number, number>();
  for (const r of order.returns) {
    for (const rItem of r.items) {
      returnedByItem.set(
        rItem.saleOrderItemId,
        (returnedByItem.get(rItem.saleOrderItemId) ?? 0) + Number(rItem.quantity)
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
      unitPrice: Number(item.unitPrice), // 默认退货价 = 原售价（Q4 口径）
      remaining,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          销售退货 ｜ 原单 {order.orderNo}（{order.customer.name}）
        </h1>
        <Link href={`/sale-orders/${order.id}`} className="text-sm text-blue-600 hover:underline">
          ← 返回原单
        </Link>
      </div>
      <ReturnForm saleOrderId={order.id} rows={rows} />
    </div>
  );
}
