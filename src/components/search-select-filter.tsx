"use client";

import { useRef } from "react";
import { SearchSelect, type SearchSelectOption } from "./search-select";

/**
 * 筛选栏里的「可搜索下拉」。
 *
 * 相比原生 `<select>`（选项一多就得在长长的列表里滚、还不能搜），
 * 这里既支持中文/拼音首字母过滤，**选中后还会立刻提交外层筛选表单** ——
 * 行为与原生 select 的「选完即筛」保持一致，用户不用再去点「筛选」。
 */
export function SearchSelectFilter({
  name,
  options,
  defaultValue = "",
  noneLabel,
  placeholder = "搜索…",
  className = "",
  emptyHint,
  label,
}: {
  name: string;
  options: SearchSelectOption[];
  defaultValue?: string;
  noneLabel?: string;
  placeholder?: string;
  className?: string;
  emptyHint?: string;
  /** 与字段同名的说明文字（如「厂家」），用于无障碍标签 */
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div ref={box} className={className}>
      <SearchSelect
        name={name}
        options={options}
        defaultValue={defaultValue}
        noneLabel={noneLabel}
        placeholder={placeholder}
        emptyHint={emptyHint}
        ariaLabel={label}
        onChange={() => {
          // 选中即筛：原生 select 也是这个行为，保持一致
          box.current?.closest("form")?.requestSubmit();
        }}
      />
    </div>
  );
}
