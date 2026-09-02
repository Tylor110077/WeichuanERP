import { getCurrentUser } from "@/lib/auth/session";

/**
 * 工作台（文档 4#2）：今日销售额、待收货补货单、负库存预警、库存预警、应收应付概览。
 * M1 仅占位，数据指标在 M4/M5 实现后接入。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();

  const statCards = [
    { label: "今日销售额", value: "—", note: "M4 接入" },
    { label: "待收货补货单", value: "—", note: "M4 接入" },
    { label: "负库存商品", value: "—", note: "M5 接入" },
    { label: "库存预警", value: "—", note: "M5 接入" },
    { label: "应收余额", value: "—", note: "M5 接入" },
    { label: "应付余额", value: "—", note: "M5 接入" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">
        工作台
        <span className="ml-3 text-sm font-normal text-gray-500">
          你好，{user?.displayName}
        </span>
      </h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-gray-200 bg-white p-5"
          >
            <div className="text-sm text-gray-500">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">
              {card.value}
            </div>
            <div className="mt-1 text-xs text-gray-400">{card.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
