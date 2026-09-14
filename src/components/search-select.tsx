"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { selectAllOnClick, selectAllOnFocus } from "./select-all-on-focus";
import { matchesSearch } from "@/lib/pinyin";
import { inputBase } from "@/lib/ui";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** 拼音首字母串（服务端算好下发）：打 zjw 就能搜到「张敬玮」 */
  py?: string;
}

/**
 * 可搜索下拉选择：选项很多时（如客户组织）聚焦展开候选、输入关键词过滤、点选确认。
 * - 文本与某个候选完全同名时自动选中（直接输入组织名也能生效）
 * - 未从候选点选时按「未选中」提交，并给出提示，避免误以为已选
 * 提交值通过同名 hidden input 传给 Server Action。
 *
 * 两种进阶用法（都不传时行为与以前完全一致）：
 * - `onSearch`：**按需远程搜索**。候选不再依赖一次性下发的全量列表，
 *   输入关键词（防抖 250ms）后由服务端返回候选，适合"厂家/商品上千"的场景；
 * - `createLabel` + `onCreate`：**在下拉里就地新建**。关键词不为空时，
 *   候选面板顶部出现「＋ 新建 XX：「输入的名字」」，点了把名字交给调用方去开表单。
 */
export function SearchSelect({
  name,
  options,
  defaultValue = "",
  placeholder = "输入关键词搜索…",
  noneLabel,
  emptyHint = "无匹配项",
  className = "",
  onChange,
  onSearch,
  createLabel,
  onCreate,
  ariaLabel,
  form,
}: {
  name: string;
  options: SearchSelectOption[];
  defaultValue?: string;
  placeholder?: string;
  /** 值为空时的候选标签（如「未分组」）；不传则无清空项 */
  noneLabel?: string;
  emptyHint?: string;
  className?: string;
  /** 选中变化回调（受控场景用，例如父级表单需要同步状态） */
  onChange?: (value: string) => void;
  /** 按需远程搜索：传入后，输入关键词时向服务端要候选（防抖 250ms） */
  onSearch?: (keyword: string) => Promise<SearchSelectOption[]>;
  /** 下拉顶部「＋ 新建 XX」的文案（如 (k) => `＋ 新建厂家：「${k}」`）；配合 onCreate 使用 */
  createLabel?: (keyword: string) => string;
  /** 点击「＋ 新建 XX」时把当前关键词交给调用方（通常用来打开新建表单并预填名字） */
  onCreate?: (keyword: string) => void;
  /** 无障碍标签（筛选栏里用，读屏能报出这是哪个字段） */
  ariaLabel?: string;
  /** 归属表单的 id：控件与表单不在同一处（例如分属表格不同单元格）时，用 html 的 form 属性关联 */
  form?: string;
}) {
  const all = useMemo(
    () => (noneLabel != null ? [{ value: "", label: noneLabel }, ...options] : options),
    [options, noneLabel]
  );
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState(
    () => all.find((o) => o.value === defaultValue)?.label ?? ""
  );
  const [open, setOpen] = useState(false);
  /** 远程候选（onSearch 模式下使用）；null 表示还没搜过 */
  const [remote, setRemote] = useState<SearchSelectOption[] | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  /** 面板锚点：fixed 定位所需的位置与可用高度（见下方 place） */
  const [anchor, setAnchor] = useState<
    { left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null
  >(null);

  /**
   * 候选面板要 fixed + portal 渲染，不能用「相对输入框绝对定位」。
   * 开单行的字段条是横向滚动容器（overflow-x-auto），绝对定位的面板会被容器裁掉，
   * 表现为下拉只露一半、还被下面的内容压住。
   */
  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 面板比输入框略宽：窄字段（如「单位」）才放得下「＋ 新建单位：「名字」」
    const width = Math.max(r.width, 176);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 8;
    const up = below < 240 && r.top - 8 > below; // 下面放不下且上面更宽敞时向上翻
    setAnchor(
      up
        ? { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(224, Math.max(96, r.top - 12)) }
        : { left, width, top: r.bottom + 4, maxHeight: Math.min(224, Math.max(96, below)) }
    );
  }, []);

  // 容器滚动/窗口缩放时跟着锚点走：面板是 fixed，不跟就会飘在旧位置
  useEffect(() => {
    if (!open) return;
    const move = () => place();
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
    };
  }, [open, place]);

  const keyword = query.trim();
  const exact = all.find((o) => o.label === keyword);
  /**
   * 真正的搜索词：框里显示的**就是当前选中项**时不算搜索（否则一打开就只剩它自己，
   * 比如客户筛选显示「全部客户」，展开却只看到「全部客户」一项，想换别的还得先删字）。
   */
  const searchText = exact && exact.value === value ? "" : keyword;
  const filtered = useMemo(() => {
    if (!searchText) return all;
    const hit = all.find((o) => o.label === searchText);
    if (hit) return [hit];
    // 远程模式：候选来自服务端搜索（关键词清空时回落到本地列表）
    if (onSearch && remote) return remote;
    // 中文原样匹配 + 拼音首字母匹配（matchesSearch 同时管两种）
    return all.filter((o) => matchesSearch(o.label, o.py ?? "", searchText));
  }, [all, searchText, onSearch, remote]);

  // 输入即搜（防抖 250ms）：只在远程模式下生效；在定时器回调里 setState，避免级联渲染
  useEffect(() => {
    if (!onSearch) return;
    let cancelled = false;
    // setState 一律放在定时器回调里（effect 体内同步 setState 会触发级联渲染，lint 也会拦）
    const timer = setTimeout(
      () => {
        if (cancelled) return;
        if (!searchText) {
          setRemote(null);
          return;
        }
        onSearch(searchText)
          .then((list) => {
            if (!cancelled) setRemote(list);
          })
          .catch(() => {
            if (!cancelled) setRemote([]);
          });
      },
      searchText ? 250 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchText, onSearch]);

  const pending = value === "" && searchText !== "" && !all.some((o) => o.label === searchText);

  /** 键盘高亮：候选项很多时用 ↑/↓ 选、回车确认（-1 = 没高亮） */
  const [active, setActive] = useState(-1);
  /** 置顶的「就地新建」也参与键盘选择，占第 0 位；后面的候选要相应偏移 */
  const hasCreate = !!(onCreate && createLabel && searchText && !exact);
  const optionOffset = hasCreate ? 1 : 0;
  const navCount = filtered.length + optionOffset;

  function onChange2(text: string) {
    setQuery(text);
    const hit = all.find((o) => o.label === text.trim());
    setValue(hit ? hit.value : "");
    place();
    setOpen(true);
    setActive(-1); // 换了关键词，原来的高亮就不作数了
  }

  function pick(o: SearchSelectOption) {
    setValue(o.value);
    setQuery(o.label);
    setOpen(false);
    setActive(-1);
    onChange?.(o.value);
  }

  /** ↑/↓ 移动高亮；回车没高亮时不动（筛选栏靠回车查询，别抢） */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (navCount === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((cur) => (e.key === "ArrowDown" ? (cur + 1) % navCount : cur <= 0 ? navCount - 1 : cur - 1));
      return;
    }
    if (e.key === "Enter") {
      if (!open || active < 0) return; // 交给表单提交
      e.preventDefault();
      if (hasCreate && active === 0) {
        onCreate?.(keyword);
        setOpen(false);
        setActive(-1);
        return;
      }
      const opt = filtered[active - optionOffset];
      if (opt) pick(opt);
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className={`relative ${className}`}>
      <input type="hidden" name={name} value={value} form={form} />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange2(e.target.value)}
        onFocus={(e) => {
          // 聚焦即全选：框里通常留着已选名称，直接打字不该变成追加
          selectAllOnFocus(e);
          place();
          setOpen(true);
        }}
        onClick={selectAllOnClick}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`${inputBase} w-full`}
      />
      {open &&
        anchor &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: anchor.left,
              width: anchor.width,
              top: anchor.top,
              bottom: anchor.bottom,
              maxHeight: anchor.maxHeight,
            }}
            className="z-50 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
          >
          {/* 就地新建：输入了关键词就置顶显示，点了把名字交给调用方（不必先去别的页面建） */}
          {hasCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCreate?.(keyword)}
              ref={(el) => {
                if (el && active === 0) el.scrollIntoView({ block: "nearest" });
              }}
              className={`block w-full border-b border-gray-100 px-3 py-2 text-left text-sm text-blue-600 ${
                active === 0 ? "bg-blue-50" : "hover:bg-blue-50"
              }`}
            >
              {createLabel?.(keyword)}
            </button>
          )}
          {/* 「已输入但未选中」的提示放在面板里，而不是输入框下面：
              放下面会让这个控件比同一行的其它控件高一行，筛选栏按底对齐后整行错位
              （同类的坑已出现多次：提示一旦参与行内布局，就会破坏对齐） */}
          {pending && (
            <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              请从候选中点选（输入名称可过滤）
            </div>
          )}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">{emptyHint}</div>
          )}
          {filtered.map((o, i) => (
            <button
              key={o.value || "__none__"}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              ref={(el) => {
                if (el && active === i + optionOffset) el.scrollIntoView({ block: "nearest" });
              }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${
                o.value === value && (o.value !== "" || !searchText)
                  ? "bg-blue-50 font-medium text-blue-700"
                  : active === i + optionOffset
                    ? "bg-blue-50 text-gray-900"
                    : "text-gray-900"
              }`}
            >
              {o.label}
            </button>
          ))}
          </div>,
          document.body
        )}
    </div>
  );
}
