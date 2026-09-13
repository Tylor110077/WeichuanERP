"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 开单草稿：把「正在填、还没提交」的单据存在浏览器本地，离开页面再回来能接着填。
 *
 * 为什么存本地而不是入库：
 * - 草稿是"这台机器上没填完的单子"，换台电脑接着填不是真实场景；
 * - 不用加表、不用等迁移窗口（线上还压着迁移），风险最小。
 * 键里带用户 id：同一台电脑换人登录时，各看各的草稿，不会串。
 */

const PREFIX = "wc-order-draft";
const VERSION = 1;
/** 超过这么久没动的草稿视为过期：翻出一张上个月的单子只会添乱 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** 输入停顿多久才落盘（边打字边写太频繁，写太晚又怕来不及） */
const SAVE_DELAY_MS = 700;

export function draftKey(scope: string, userId: number | string): string {
  return `${PREFIX}:${scope}:${userId}`;
}

interface StoredDraft<T> {
  v: number;
  savedAt: number;
  data: T;
}

/** 读草稿；解析失败、版本不符、过期都当没有（不抛错，别让一张坏草稿挡住开单） */
export function readDraft<T>(key: string): { data: T; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (parsed?.v !== VERSION || typeof parsed?.savedAt !== "number" || parsed.data == null) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return { data: parsed.data, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 无痕模式等场景写不了存储，忽略即可
  }
}

function writeDraft(key: string, json: string) {
  try {
    const payload = { v: VERSION, savedAt: Date.now(), data: JSON.parse(json) };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // 忽略：存不下也不该影响开单
  }
}

/** 保存时间的人话描述：刚刚 / 12 分钟前 / 今天 14:32 / 昨天 14:32 / 9月11日 14:32 */
export function formatSavedAt(ts: number): string {
  const d = new Date(ts);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const day = new Date();
  const sameDay = d.toDateString() === day.toDateString();
  if (sameDay) return `今天 ${hhmm}`;
  const yesterday = new Date(day.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hhmm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/**
 * 在表单里挂草稿：挂载时恢复一次，之后按输入防抖保存。
 *
 * @param scope    单据类型（"sale" / "purchase"），同类型只留一份草稿
 * @param userId   当前登录用户 id（换人登录不串草稿）
 * @param value    要保存的内容（每次渲染给最新值即可）
 * @param hasContent 有内容才存；清空了就顺手删掉草稿
 * @param apply    恢复草稿时把数据写回表单
 * @param onDiscard 用户点「清空草稿」时把表单也清干净
 */
export function useFormDraft<T>({
  scope,
  userId,
  value,
  hasContent,
  apply,
  onDiscard,
}: {
  scope: string;
  userId: number | string;
  value: T;
  hasContent: boolean;
  apply: (data: T) => void;
  onDiscard: () => void;
}): {
  /** 恢复的草稿的保存时间（没恢复就是 null） */
  restoredAt: number | null;
  /** 最近一次自动保存时间（还没存过是 null） */
  savedAt: number | null;
  /** 清空草稿并重置表单 */
  discard: () => void;
  /** 只删存储、不动表单：提交时调用，万一提交失败，下次改动会自动重新存 */
  clearStored: () => void;
} {
  const key = draftKey(scope, userId);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** 恢复之前不许保存：否则首屏的空表单会把好草稿盖掉 */
  const hydrated = useRef(false);
  const applyRef = useRef(apply);

  // 让 apply 保持最新，又不用把它放进下面恢复 effect 的依赖里：
  // 调用方传的是内联箭头函数，每次都换引用，进依赖会导致反复恢复草稿
  useEffect(() => {
    applyRef.current = apply;
  });

  const snapshot = JSON.stringify(value);

  useEffect(() => {
    const found = readDraft<T>(key);
    if (found) {
      applyRef.current(found.data);
      // 服务端渲染的是空表单，草稿只能等挂载后在客户端恢复——放 effect 里就必然要 setState
      // （改成 useState 初始化器会与 SSR 结果不一致，触发 hydration 报错），此处豁免该规则
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRestoredAt(found.savedAt);
      setSavedAt(found.savedAt);
    }
    hydrated.current = true;
  }, [key]);

  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      if (!hasContent) {
        clearDraft(key);
        setSavedAt(null);
        return;
      }
      writeDraft(key, snapshot);
      setSavedAt(Date.now());
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, snapshot, hasContent]);

  function clearStored() {
    clearDraft(key);
    setSavedAt(null);
  }

  function discard() {
    clearDraft(key);
    setRestoredAt(null);
    setSavedAt(null);
    onDiscard();
  }

  return { restoredAt, savedAt, discard, clearStored };
}
