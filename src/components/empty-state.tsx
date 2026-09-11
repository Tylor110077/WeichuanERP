import Link from "next/link";
import { btnSmallPrimary } from "@/lib/ui";

/**
 * 空状态：无数据时告知「为什么空 + 下一步做什么」，而不是只丢一句"暂无数据"。
 * 可放在卡片内，也可放在表格的 <td colSpan> 内。
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  /** 可选的引导操作（如"去创建商品"） */
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-7 w-7 text-gray-300"
        aria-hidden
      >
        <path d="M3 7l9-4 9 4v10l-9 4-9-4z" strokeLinejoin="round" />
        <path d="M3 7l9 4 9-4M12 11v10" strokeLinejoin="round" />
      </svg>
      <p className="text-sm text-gray-500">{title}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
      {action && (
        <Link href={action.href} className={`${btnSmallPrimary} mt-1`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** 无权限提示：统一文案与版式（原先 22 处写法相近但不一致） */
export function NoPermission({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="mx-auto h-7 w-7 text-gray-300"
        aria-hidden
      >
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
      </svg>
      <p className="mt-2 text-sm text-gray-500">{text}</p>
    </div>
  );
}
