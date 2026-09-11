"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SidebarNav, type NavGroup } from "./sidebar-nav";

const STORAGE_KEY = "wc-sidebar-collapsed";

/**
 * 应用外壳：左侧导航 + 主内容区。
 * 整条侧边栏可收起（收起后左上角留一个 ☰ 按钮随时展开），状态记忆在 localStorage，
 * 便于小屏/需要宽视野时把空间让给内容区。
 */
export function AppShell({
  groups,
  footer,
  children,
}: {
  groups: NavGroup[];
  /** 侧边栏底部内容（用户信息 / 退出登录；由服务端渲染后作为插槽传入） */
  footer: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // 恢复上次的收起状态（异步读取，避免 SSR 与首屏不一致）
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
      } catch {
        // ignore
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {collapsed ? (
        <button
          type="button"
          onClick={toggle}
          title="展开菜单"
          aria-label="展开菜单"
          className="fixed left-3 top-3 z-40 rounded-md border border-gray-200 bg-white p-2 text-gray-600 shadow-sm transition hover:border-blue-300 hover:text-blue-600"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <aside className="flex w-52 shrink-0 flex-col border-r border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
            <div className="text-base font-semibold text-gray-900">玮川进销存</div>
            <button
              type="button"
              onClick={toggle}
              title="收起菜单"
              aria-label="收起菜单"
              className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <SidebarNav groups={groups} />
          {footer}
        </aside>
      )}
      <main className={`flex-1 overflow-x-auto p-6 ${collapsed ? "pl-16" : ""}`}>
        {children}
      </main>
    </div>
  );
}
