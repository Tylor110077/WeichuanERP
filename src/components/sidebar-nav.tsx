"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const STORAGE_KEY = "wc-nav-collapsed";

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // 恢复上次折叠状态（客户端；localStorage 读取放异步以防 hydration 闪烁）
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) setCollapsed(JSON.parse(saved) as Record<string, boolean>);
      } catch {
        // ignore
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
      {groups.map((group, gi) => {
        const key = group.label ?? "__top";
        const isCollapsed = collapsed[key];
        const showToggle = group.label !== null && group.items.length > 0;
        // 路径前缀竞争处理：/sale-orders/new 会同时命中 /sale-orders 与 /sale-orders/new，
        // 取本组内匹配项中"最长"的作为高亮（精确/更深路径优先）
        const activeHref = group.items
          .map((i) => i.href)
          .filter((h) => isActive(h))
          .sort((a, b) => b.length - a.length)[0];

        return (
          <div key={gi}>
            {showToggle ? (
              <button
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-100"
              >
                <span>{group.label}</span>
                <span
                  className={`inline-block text-[10px] transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                  aria-hidden
                >
                  ▸
                </span>
              </button>
            ) : (
              group.label && (
                <div className="px-3 pb-1 text-xs font-medium text-gray-400">{group.label}</div>
              )
            )}
            {!isCollapsed && (
              <div className="space-y-1">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-md px-3 py-2 text-sm ${
                      item.href === activeHref
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
