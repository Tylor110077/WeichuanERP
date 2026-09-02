"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface FilterField {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  current: string;
}

/** 选择即筛选：下拉值变化后自动带参跳转（无需单独的"筛选"按钮）。 */
export function AutoFilterForm({
  basePath,
  fields,
}: {
  basePath: string;
  fields: FilterField[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, f.current]))
  );

  function onChange(name: string, value: string) {
    const next = { ...values, [name]: value };
    setValues(next);
    const sp = new URLSearchParams();
    for (const f of fields) {
      if (next[f.name]) sp.set(f.name, next[f.name]);
    }
    router.push(`${basePath}?${sp.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {fields.map((f) => (
        <select
          key={f.name}
          name={f.name}
          value={values[f.name]}
          onChange={(e) => onChange(f.name, e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        >
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
