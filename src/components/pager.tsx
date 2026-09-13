import Link from "next/link";

/**
 * 统一的翻页条：上一页 / 第 x / y 页 / 下一页。
 *
 * 两种用法：
 * - 服务端列表给 hrefFor（渲染成链接，页码进地址栏、可分享可回退）；
 * - 本地列表（如草稿箱，数据在浏览器里）给 onPageChange（渲染成按钮）。
 * 只有一页时返回 null：列表短的时候不占位置、也不显示无意义的「第 1 / 1 页」。
 */
export function Pager({
  page,
  totalPages,
  hrefFor,
  onPageChange,
  className = "",
}: {
  page: number;
  totalPages: number;
  hrefFor?: (page: number) => string;
  onPageChange?: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const ctrl = (target: number, text: string, enabled: boolean) => {
    if (!enabled) return <span className="text-gray-400">{text}</span>;
    if (hrefFor) {
      return (
        <Link href={hrefFor(target)} className="text-blue-600 hover:underline">
          {text}
        </Link>
      );
    }
    return (
      <button type="button" onClick={() => onPageChange?.(target)} className="text-blue-600 hover:underline">
        {text}
      </button>
    );
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm ${className}`}
    >
      <span className="text-gray-600">
        第 {page} / {totalPages} 页
      </span>
      {ctrl(page - 1, "上一页", page > 1)}
      {ctrl(page + 1, "下一页", page < totalPages)}
    </div>
  );
}
