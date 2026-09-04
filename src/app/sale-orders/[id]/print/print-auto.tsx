"use client";

import { useEffect } from "react";

/** 打印视图加载后自动唤起浏览器打印（可重复打印，关闭标签即返回）。 */
export function PrintAuto() {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.print();
    }, 500);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
