"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import { btnPrimary } from "@/lib/ui";
import { MAX_SHORTCUTS, SHORTCUT_GROUPS, type ShortcutDef } from "@/lib/shortcuts";
import { saveShortcutsAction, resetShortcutsAction } from "./shortcut-actions";

/**
 * 工作台「快捷入口」面板。
 *
 * 查看态：每块是一个链接，点一下直达（如「开售卖单」）。
 * 编辑态：**直接拖动**每块来调整顺序（指针事件自己实现，不引第三方库），每块右上角 ✕ 移除；
 * 下方列出还能加的入口，点一下就加进来；保存后写回当前用户。
 *
 * 为什么不用原生 HTML5 拖放：它只认鼠标，触屏上按住不动——而界面上写着"拖动可以调整
 * 顺序"，等于说了做不到的话。改用 pointer 事件后鼠标、触屏、手写笔通用。
 * 触屏的取舍：手机上四处拖会跟页面上下滚动打架，所以触屏只认从 ⠿ 把手起拖
 * （把手加了 touch-none 阻止浏览器接管手势）；鼠标仍是整块可拖，手感不变。
 *
 * 上限 MAX_SHORTCUTS：工作台放太多等于没有重点，加满后给明确提示而不是静默失败。
 */
export function ShortcutBoard({
  shortcuts,
  catalog,
}: {
  /** 当前显示的入口（已按角色过滤） */
  shortcuts: ShortcutDef[];
  /** 该角色可选的入口全集（编辑态用来展示"还能加什么"） */
  catalog: ShortcutDef[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // draft 只在编辑态用；查看态直接渲染服务端给的 shortcuts，
  // 这样「保存 / 恢复默认」后 router.refresh() 带回来的新值立刻生效（本地副本不会盖住它）
  const [draft, setDraft] = useState<ShortcutDef[]>(shortcuts);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  /** 拖动排序：dragIndex = 正在拖的那块，overIndex = 当前悬停到哪块（用于画插入位置） */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  /** 记下起拖的指针（id + 起始下标），避免多指操作串台、也不怕 state 迟到 */
  const dragPointer = useRef<{ id: number; from: number } | null>(null);
  /** 拖动中的最新落点：贴边自动滚动按它判断方向（手机单列时列表比一屏高，不滚就够不到远处） */
  const lastY = useRef(0);
  const scrollRaf = useRef<number | null>(null);

  /** 贴边自动滚动：落点贴近屏幕上下缘就持续滚动，手指停住也继续（拖动期间才跑） */
  function runAutoScroll() {
    const MARGIN = 72;
    const SPEED = 14;
    const step = () => {
      const y = lastY.current;
      const vh = window.innerHeight;
      const delta = y < MARGIN ? -SPEED : y > vh - MARGIN ? SPEED : 0;
      if (delta !== 0) window.scrollBy(0, delta);
      scrollRaf.current = requestAnimationFrame(step);
    };
    if (scrollRaf.current == null) scrollRaf.current = requestAnimationFrame(step);
  }

  function stopAutoScroll() {
    if (scrollRaf.current != null) {
      cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = null;
    }
  }

  // 拖到一半组件被换掉（保存/取消/路由跳走）就停掉自动滚动，别留一个空转的 rAF
  useEffect(() => stopAutoScroll, []);

  const list = editing ? draft : shortcuts;
  const chosen = new Set(draft.map((s) => s.id));
  const addable = catalog.filter((s) => !chosen.has(s.id));

  function openEdit() {
    setDraft(shortcuts);
    setMsg(null);
    setEditing(true);
  }

  /** 把第 from 块放到第 to 个位置（其余块顺延） */
  function dropAt(from: number, to: number) {
    if (from === to) return;
    setDraft((list) => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  /** 起拖：鼠标整块可拖；触屏/手写笔只认 ⠿ 把手（否则跟页面上下滚动打架） */
  function startDrag(e: ReactPointerEvent<HTMLDivElement>, from: number) {
    if ((e.target as HTMLElement).closest("button")) return; // 顶到 ✕ 就让它照常点击
    const onHandle = !!(e.target as HTMLElement).closest("[data-drag-handle]");
    if (e.pointerType !== "mouse" && !onHandle) return;
    dragPointer.current = { id: e.pointerId, from };
    lastY.current = e.clientY;
    setDragIndex(from);
    setOverIndex(from);
    runAutoScroll();
    // 抓住指针：拖到块外也能继续收到 pointermove
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragPointer.current;
    if (!d || d.id !== e.pointerId) return;
    lastY.current = e.clientY;
    // 指针被 setPointerCapture 抓在源块上，但 elementFromPoint 拿到的仍是真实落点下的块
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const tile = under?.closest<HTMLElement>("[data-tile-index]");
    if (!tile) return;
    setOverIndex(Number(tile.dataset.tileIndex));
  }

  /** 松手：落到哪块就插到哪块；pointercancel（被系统手势打断）则原样放弃 */
  function endDrag(e: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    const d = dragPointer.current;
    if (!d || d.id !== e.pointerId) return;
    const to = overIndex;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    stopAutoScroll();
    dragPointer.current = null;
    setDragIndex(null);
    setOverIndex(null);
    if (commit && to != null) dropAt(d.from, to);
  }

  function remove(id: string) {
    setDraft((list) => list.filter((s) => s.id !== id));
  }

  function add(def: ShortcutDef) {
    setDraft((list) => (list.length >= MAX_SHORTCUTS ? list : [...list, def]));
  }

  function save() {
    startTransition(async () => {
      const r = await saveShortcutsAction(draft.map((s) => s.id));
      if (r?.error) {
        setMsg({ kind: "error", text: r.error });
        return;
      }
      setEditing(false);
      setMsg({ kind: "ok", text: "已保存" });
      router.refresh();
    });
  }

  function resetDefault() {
    startTransition(async () => {
      const r = await resetShortcutsAction();
      if (r?.error) {
        setMsg({ kind: "error", text: r.error });
        return;
      }
      setEditing(false);
      setMsg({ kind: "ok", text: "已恢复默认" });
      router.refresh();
    });
  }

  const tileBase =
    "group flex items-center gap-3 rounded-xl border bg-white p-4 transition";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-700">
          快捷入口
          {editing && (
            <span className="ml-2 text-xs font-normal text-gray-400">
              已选 {draft.length} / {MAX_SHORTCUTS}
            </span>
          )}
        </h2>
        {!editing ? (
          <div className="flex items-center gap-3">
            {msg?.kind === "ok" && (
              <span className="text-xs text-green-700">{msg.text}</span>
            )}
            <button type="button" onClick={openEdit} className="whitespace-nowrap text-xs text-blue-600 hover:underline">
              编辑
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button type="button" onClick={resetDefault} disabled={pending} className="whitespace-nowrap text-xs text-gray-500 hover:underline">
              恢复默认
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setMsg(null);
              }}
              disabled={pending}
              className="whitespace-nowrap text-xs text-gray-500 hover:underline"
            >
              取消
            </button>
            <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
              {pending ? "保存中…" : "保存"}
            </button>
          </div>
        )}
      </div>

      {msg?.kind === "error" && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {msg.text}
        </p>
      )}

      {list.length === 0 && !editing ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-400">
          还没有快捷入口，点右上角「编辑」挑几个常用的放上来。
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((s, i) => {
            const badge = (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-base font-medium text-blue-600 transition group-hover:bg-blue-100">
                {s.badge}
              </span>
            );
            const text = (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900 group-hover:text-blue-700">
                  {s.label}
                </span>
                <span className="block truncate text-xs text-gray-500">{s.desc}</span>
              </span>
            );
            const chevron = (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500"
              >
                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            );

            if (!editing) {
              return (
                <Link key={s.id} href={s.href} className={`${tileBase} border-gray-200 hover:border-blue-300 hover:shadow-sm`}>
                  {badge}
                  {text}
                  {chevron}
                </Link>
              );
            }

            const dragging = dragIndex === i;
            const isTarget = overIndex === i && dragIndex != null && dragIndex !== i;
            return (
              <div
                key={s.id}
                data-tile-index={i}
                onPointerDown={(e) => startDrag(e, i)}
                onPointerMove={moveDrag}
                onPointerUp={(e) => endDrag(e, true)}
                onPointerCancel={(e) => endDrag(e, false)}
                className={[
                  tileBase,
                  "cursor-grab touch-manipulation select-none border-dashed active:cursor-grabbing",
                  dragging ? "border-blue-300 opacity-40" : "border-gray-300",
                  isTarget ? "ring-2 ring-blue-400" : "",
                ].join(" ")}
                title="按住拖动可以调整位置"
              >
                {/* 拖拽把手：鼠标整块可拖，触屏从这里按住再拖（touch-none 阻止浏览器接管手势）
                    -m-1 + p-1：把手指的落点从十来个像素扩到约 26px，不影响视觉间距 */}
                <span data-drag-handle aria-hidden className="-m-1 shrink-0 touch-none p-1 text-gray-300">
                  ⠿
                </span>
                {badge}
                {text}
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  aria-label={`移除 ${s.label}`}
                  className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs text-gray-500">
            拖动上面的入口调整顺序（鼠标直接拖，手机上按住块左侧的 ⠿ 再拖）；点下面的入口加到上面；加满 {MAX_SHORTCUTS} 个后先移除再添加。「恢复默认」会按你的角色重置。
          </p>
          {addable.length === 0 ? (
            <p className="text-xs text-gray-400">该角色可用的入口都已放上去了。</p>
          ) : (
            SHORTCUT_GROUPS.map((group) => {
              const items = addable.filter((s) => s.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="flex flex-wrap items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-gray-400">{group}</span>
                  {items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => add(s)}
                      disabled={draft.length >= MAX_SHORTCUTS}
                      title={s.desc}
                      className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 transition hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      + {s.label}
                    </button>
                  ))}
                </div>
              );
            })
          )}
          {draft.length >= MAX_SHORTCUTS && (
            <p className="text-xs text-amber-700">
              已放满 {MAX_SHORTCUTS} 个：想加新的，先在上面移除一个。
            </p>
          )}
        </div>
      )}

      {!editing && (
        <p className="text-xs text-gray-400">
          这块由你决定：点「编辑」后拖动可以调整顺序、也能增删，保存后只影响你自己的账号。
        </p>
      )}
    </section>
  );
}
