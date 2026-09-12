"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { SidebarNav, type NavGroup } from "./sidebar-nav";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

function persist(collapsed: boolean) {
  try {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // ignore
  }
}

/** 品牌区（桌面侧栏与手机抽屉共用） */
function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Image src="/logo.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0" priority />
      <span className="truncate text-base font-semibold text-gray-900">玮川进销存</span>
    </div>
  );
}

/**
 * 应用外壳：左侧导航 + 主内容区。
 *
 * 三种形态（移动端优先，桌面端一切照旧）：
 * - **手机（< lg）**：顶部一条 fixed 栏（汉堡 + 品牌），点汉堡从左侧滑出抽屉放完整导航，
 *   点遮罩或选中菜单项即关闭。手机上不再有 208px 固定侧栏——那是手机上不可用的根源
 *   （375px 屏会被吃掉一半多）。
 * - **桌面（≥ lg）**：固定 208px 侧边栏，与以前完全一致。
 * - **桌面收起**：左上角留一个 ☰ 按钮（这个按钮只在桌面出现，手机上由抽屉承担）。
 */
export function AppShell({
  groups,
  footer,
  initialCollapsed,
  children,
}: {
  groups: NavGroup[];
  /** 侧边栏底部内容（用户信息 / 退出登录；由服务端渲染后作为插槽传入） */
  footer: ReactNode;
  /** 服务端从 Cookie 读出的初始收起状态 */
  initialCollapsed: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* 手机顶栏（桌面隐藏）：内容区顶部因此要留出 pt-16（顶栏实测 61px） */}
      <header className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white px-3 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          title="打开菜单"
          aria-label="打开菜单"
          className="rounded-md p-2 text-gray-600 transition hover:bg-gray-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
        <Brand />
      </header>

      {/* 手机抽屉：完整导航 + 遮罩；点遮罩或任一菜单项即关闭 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="导航菜单">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                title="关闭菜单"
                aria-label="关闭菜单"
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {/* 点菜单就关抽屉（链接点击会冒泡到这里） */}
            <div
              className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              onClick={() => setDrawerOpen(false)}
            >
              <SidebarNav groups={groups} />
            </div>
            {footer}
          </aside>
        </div>
      )}

      {collapsed ? (
        <button
          type="button"
          onClick={toggle}
          title="展开菜单"
          aria-label="展开菜单"
          className="fixed left-3 top-3 z-40 hidden rounded-md border border-gray-200 bg-white p-2 text-gray-600 shadow-sm transition hover:border-blue-300 hover:text-blue-600 lg:block"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <aside className="hidden w-52 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
            <Brand />
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

      {/* 手机上给固定顶栏让出高度、内边距也收窄；桌面沿用原来的 p-6 与收起时的 pl-16 */}
      <main
        className={`min-w-0 flex-1 overflow-x-auto px-3 pb-6 pt-16 lg:p-6 ${
          collapsed ? "lg:pl-16" : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
}
