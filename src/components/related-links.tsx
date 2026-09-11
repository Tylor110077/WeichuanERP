import Link from "next/link";

/**
 * 页头「相关」链接组：把算的是同一件事、但分散在不同页面的入口串起来。
 *
 * 背景：销售额/成本/毛利在 5 个页面各算一遍，彼此却没有链接，
 * 用户只能靠记忆找页面（详见 docs/系统梳理/04-资金与分析.md）。
 */
export function RelatedLinks({
  links,
  className,
}: {
  links: { href: string; label: string }[];
  className?: string;
}) {
  if (links.length === 0) return null;
  return (
    <span className={`text-xs text-gray-400 ${className ?? ""}`}>
      相关：
      {links.map((l, i) => (
        <span key={l.href}>
          {i > 0 && <span className="mx-1">·</span>}
          <Link href={l.href} className="text-blue-600 hover:underline">
            {l.label}
          </Link>
        </span>
      ))}
    </span>
  );
}
