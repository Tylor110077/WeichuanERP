import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { rmbUpper } from "@/lib/rmb";
import { PrintAuto } from "./print-auto";

export const metadata = { title: "销售单打印 - 玮川进销存" };

/** 销售单打印视图（独立无侧边栏，A4 版式；可重复打印）。 */
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
  if (user.role === "sales" && order.operatorId !== user.id) notFound();

  const total = Number(order.totalAmount);

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 font-sans text-sm text-gray-900 print:max-w-none print:p-0">
      <PrintAuto />
      {/* 抬头 */}
      <div className="mb-6 border-b-2 border-gray-900 pb-3">
        <h1 className="text-center text-2xl font-bold tracking-widest">销售单（发货单）</h1>
        <div className="mt-2 flex justify-between text-xs text-gray-600">
          <span>单号：{order.orderNo}</span>
          <span>日期：{order.createdAt.toLocaleDateString("zh-CN")}</span>
        </div>
      </div>

      {/* 客户信息 */}
      <div className="mb-4 grid grid-cols-3 gap-2 rounded border border-gray-300 p-3 text-sm">
        <div>
          <span className="text-gray-500">客户：</span>
          <span className="font-medium">{order.customer.name}</span>
        </div>
        <div>
          <span className="text-gray-500">联系人：</span>
          <span>{order.customer.contact || "—"}</span>
        </div>
        <div>
          <span className="text-gray-500">电话：</span>
          <span>{order.customer.phone || "—"}</span>
        </div>
        <div className="col-span-3">
          <span className="text-gray-500">地址：</span>
          <span>{order.customer.address || "—"}</span>
        </div>
      </div>

      {/* 明细 */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y-2 border-gray-900 bg-gray-50 text-left">
            <th className="px-2 py-2">#</th>
            <th className="px-2 py-2">编码</th>
            <th className="px-2 py-2">商品名称</th>
            <th className="px-2 py-2 text-right">数量</th>
            <th className="px-2 py-2">单位</th>
            <th className="px-2 py-2 text-right">单价</th>
            <th className="px-2 py-2 text-right">金额</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, idx) => (
            <tr key={item.id} className="border-b border-gray-200">
              <td className="px-2 py-2 text-gray-500">{idx + 1}</td>
              <td className="px-2 py-2">{item.product.code}</td>
              <td className="px-2 py-2">{item.product.name}</td>
              <td className="px-2 py-2 text-right">{Number(item.quantity).toFixed(3)}</td>
              <td className="px-2 py-2">{item.unit.name}</td>
              <td className="px-2 py-2 text-right">¥{Number(item.unitPrice).toFixed(2)}</td>
              <td className="px-2 py-2 text-right font-medium">¥{Number(item.amount).toFixed(2)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-gray-900">
            <td colSpan={6} className="px-2 py-2 text-right font-bold">
              合计（大写：{rmbUpper(total)}）
            </td>
            <td className="px-2 py-2 text-right text-base font-bold">¥{total.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 text-sm text-gray-600">
        备注：{order.remark || "—"} 　开单操作人：{order.operator.displayName}
      </div>

      {/* 签收区 */}
      <div className="mt-10 flex justify-between text-sm">
        <div className="w-64 border-t border-gray-900 pt-1 text-center text-gray-600">
          客户签收 / 日期
        </div>
        <div className="w-64 border-t border-gray-900 pt-1 text-center text-gray-600">
          发货人 / 日期
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        玮川进销存 ・ {order.orderNo} ・ 打印时间 {new Date().toLocaleString("zh-CN")}
      </p>
    </div>
  );
}
