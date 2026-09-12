"use client";

import { useMemo, useState } from "react";
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

  const keyword = query.trim();
  const exact = all.find((o) => o.label === keyword);
  const filtered = useMemo(() => {
    if (exact) return [exact];
    if (!keyword) return all;
    // 中文原样匹配 + 拼音首字母匹配（matchesSearch 同时管两种）
    return all.filter((o) => matchesSearch(o.label, o.py ?? "", keyword));
  }, [all, keyword, exact]);

  const pending = value === "" && keyword !== "" && !all.some((o) => o.label === keyword);

  function onChange2(text: string) {
    setQuery(text);
    const hit = all.find((o) => o.label === text.trim());
    setValue(hit ? hit.value : "");
    setOpen(true);
  }

  function pick(o: SearchSelectOption) {
    setValue(o.value);
    setQuery(o.label);
    setOpen(false);
    onChange?.(o.value);
  }

  return (
    <div className={`relative ${className}`}>
      <input type="hidden" name={name} value={value} />
      <input
        type="text"
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onChange={(e) => onChange2(e.target.value)}
        onFocus={(e) => {
          // 聚焦即全选：框里通常留着已选名称，直接打字不该变成追加
          selectAllOnFocus(e);
          setOpen(true);
        }}
        onClick={selectAllOnClick}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`${inputBase} w-full`}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
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
          {filtered.map((o) => (
            <button
              key={o.value || "__none__"}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${
                o.value === value && (o.value !== "" || !keyword)
                  ? "bg-blue-50 font-medium text-blue-700"
                  : "text-gray-900"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
