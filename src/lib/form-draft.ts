"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 开单草稿箱：把「正在填、还没提交」的单据存在浏览器本地，分「售卖单 / 进货单」两类，
 * 同时可以留多张（/drafts 能看到全部），填到一半切走再回来也能接着填。
 *
 * 为什么存本地而不是入库：草稿是"这台机器上没填完的单子"，不用加表、不用等迁移窗口。
 * 键里带用户 id：同一台电脑换人登录，各看各的草稿，不会串。
 */

const LIST_PREFIX = "wc-order-drafts";
/** 旧版是「每种单据只留一份」，读到就顺手迁进草稿箱 */
const LEGACY_PREFIX = "wc-order-draft";
const VERSION = 1;
/** 超过这么久没动过的草稿视为过期：翻出一张上个月的单子只会添乱 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** 每类最多留几份，超出丢最旧的，免得草稿箱越积越多 */
const MAX_PER_SCOPE = 20;
/** 输入停顿多久才落盘（边打字边写太频繁，写太晚又怕来不及） */
const SAVE_DELAY_MS = 700;

export type DraftScope = "sale" | "purchase";

export const DRAFT_SCOPE_LABEL: Record<DraftScope, string> = {
  sale: "售卖单",
  purchase: "进货单",
};

/** 草稿箱列表要展示的摘要（存的时候就记下来，列表页不必懂单据结构） */
export interface DraftSummary {
  /** 客户名（售卖单）/ 厂家名（进货单） */
  partner: string;
  /** 商品行数 */
  lines: number;
  /** 金额合计 */
  amount: number;
  /** 头几个商品名，便于一眼认出是哪张单 */
  preview: string;
}

export interface DraftRecord<T = unknown> {
  id: string;
  scope: DraftScope;
  savedAt: number;
  summary: DraftSummary;
  data: T;
}

function listKey(userId: number | string): string {
  return `${LIST_PREFIX}:${userId}`;
}

function legacyKey(scope: DraftScope, userId: number | string): string {
  return `${LEGACY_PREFIX}:${scope}:${userId}`;
}

function newDraftId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `d${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  }
}

function isDraftRecord(x: unknown): x is DraftRecord {
  const d = x as DraftRecord;
  return !!d && typeof d.id === "string" && (d.scope === "sale" || d.scope === "purchase") && typeof d.savedAt === "number";
}

/** 读盘：解析失败/版本不符/过期的都丢掉（别让一份坏数据挡住整个草稿箱） */
function readAll(userId: number | string): DraftRecord[] {
  try {
    const raw = localStorage.getItem(listKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { v?: number; drafts?: unknown };
    if (parsed?.v !== VERSION || !Array.isArray(parsed.drafts)) return [];
    const now = Date.now();
    return parsed.drafts.filter(isDraftRecord).filter((d) => now - d.savedAt <= MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeAll(userId: number | string, drafts: DraftRecord[]) {
  try {
    localStorage.setItem(listKey(userId), JSON.stringify({ v: VERSION, drafts }));
  } catch {
    // 无痕模式等场景写不了，忽略：存不下不该挡住开单
  }
  emit();
}

/** 把旧版「每种一份」的草稿迁进草稿箱，迁完删掉旧的键 */
function migrateLegacy(userId: number | string, existing: DraftRecord[]): DraftRecord[] {
  const out = [...existing];
  for (const scope of ["sale", "purchase"] as const) {
    try {
      const raw = localStorage.getItem(legacyKey(scope, userId));
      if (!raw) continue;
      localStorage.removeItem(legacyKey(scope, userId));
      const parsed = JSON.parse(raw) as { v?: number; savedAt?: number; data?: unknown };
      const data = (parsed as { data?: unknown })?.data;
      if (parsed?.v !== VERSION || typeof parsed?.savedAt !== "number" || data == null) continue;
      if (out.some((d) => d.scope === scope)) continue;
      out.push({
        id: newDraftId(),
        scope,
        savedAt: parsed.savedAt,
        // 旧草稿没存摘要，列表里先按"未命名"显示，进去填一次就会补上
        summary: { partner: "", lines: 0, amount: 0, preview: "（旧草稿）" },
        data,
      });
    } catch {
      // 单个旧草稿坏了就跳过
    }
  }
  return out;
}

// ---- 读写接口（草稿箱页与表单共用） ----

export function listDrafts(userId: number | string, scope?: DraftScope): DraftRecord[] {
  const all = readAll(userId)
    .filter((d) => !scope || d.scope === scope)
    .sort((a, b) => b.savedAt - a.savedAt);
  return all;
}

export function newestDraft(userId: number | string, scope: DraftScope): DraftRecord | null {
  return listDrafts(userId, scope)[0] ?? null;
}

export function findDraft(userId: number | string, id: string): DraftRecord | null {
  return readAll(userId).find((d) => d.id === id) ?? null;
}

/** 存一份草稿：同 id 覆盖，新 id 追加；每类只留最近的若干份，超出的丢最旧的 */
export function saveDraft(userId: number | string, record: DraftRecord) {
  const drafts = migrateLegacy(userId, readAll(userId));
  const idx = drafts.findIndex((d) => d.id === record.id);
  if (idx >= 0) drafts[idx] = record;
  else drafts.push(record);
  const keptCount: Record<string, number> = {};
  const kept = [...drafts]
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter((d) => {
      keptCount[d.scope] = (keptCount[d.scope] ?? 0) + 1;
      return keptCount[d.scope] <= MAX_PER_SCOPE;
    });
  writeAll(userId, kept);
}

export function deleteDraft(userId: number | string, id: string) {
  writeAll(userId, readAll(userId).filter((d) => d.id !== id));
}

export function deleteAllDrafts(userId: number | string) {
  writeAll(userId, []);
}

export function createDraftId(): string {
  return newDraftId();
}

// ---- 让 React 能读到（草稿箱页 / 列表页的入口） ----

const listeners = new Set<() => void>();
/** 快照缓存：listDrafts 每次都新建数组，直接当 getSnapshot 返回值会无限重渲染 */
let snapshotCache: { key: string; raw: string | null; drafts: DraftRecord[] } | null = null;

function emit() {
  for (const l of listeners) l();
}

export function subscribeDrafts(cb: () => void): () => void {
  listeners.add(cb);
  // 别的标签页改了草稿也跟着刷新
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(LIST_PREFIX)) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** 稳定的草稿列表快照（内容没变就返回同一个数组引用） */
export function getDraftsSnapshot(userId: number | string): DraftRecord[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(listKey(userId));
  } catch {
    raw = null;
  }
  const key = listKey(userId);
  if (snapshotCache && snapshotCache.key === key && snapshotCache.raw === raw) return snapshotCache.drafts;
  const drafts = listDrafts(userId);
  snapshotCache = { key, raw, drafts };
  return drafts;
}

/** 服务端渲染时的空快照（服务端本来就看不到本地草稿） */
export function emptyDraftsSnapshot(): DraftRecord[] {
  return EMPTY_DRAFTS;
}
const EMPTY_DRAFTS: DraftRecord[] = [];

/** 保存时间的人话描述：刚刚 / 12 分钟前 / 今天 14:32 / 昨天 14:32 / 9月11日 14:32 */
export function formatSavedAt(ts: number): string {
  const d = new Date(ts);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const day = new Date();
  if (d.toDateString() === day.toDateString()) return `今天 ${hhmm}`;
  const yesterday = new Date(day.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hhmm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/**
 * 在表单里挂草稿：挂载时恢复（优先 URL 里指定的那份，否则最近一份），之后按输入防抖保存。
 *
 * @param draftId  URL 上的 ?draft=<id>（从草稿箱点进来的那份）；不传就恢复最近一份
 * @param summary  列表里要展示的摘要，随草稿一起存
 */
export function useFormDraft<T>({
  scope,
  userId,
  draftId,
  value,
  hasContent,
  summary,
  apply,
  onDiscard,
  skipRestore,
}: {
  scope: DraftScope;
  userId: number | string;
  draftId?: string;
  value: T;
  hasContent: boolean;
  summary: DraftSummary;
  apply: (data: T) => void;
  onDiscard: () => void;
  /** 带着原单来"改单"时不要恢复草稿：草稿会盖掉原单内容 */
  skipRestore?: boolean;
}): {
  /** 恢复的草稿的保存时间（没恢复就是 null） */
  restoredAt: number | null;
  /** 最近一次自动保存时间（还没存过是 null） */
  savedAt: number | null;
  /** 当前草稿 id（新草稿在第一次保存时生成） */
  currentId: string | null;
  /** 删除当前草稿并重置表单 */
  discard: () => void;
  /** 另开一张：当前这份草稿留在草稿箱里，表单清空重开（之后会自动存成新的一份） */
  startNew: () => void;
  /** 删除当前草稿但不动表单：提交时调用；万一提交失败，下次改动会重新存一份 */
  clearStored: () => void;
} {
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(draftId ?? null);
  /** 恢复之前不许保存：否则首屏的空表单会把好草稿盖掉 */
  const hydrated = useRef(false);
  const applyRef = useRef(apply);

  // 让 apply 保持最新，又不用把它放进下面恢复 effect 的依赖里：
  // 调用方传的是内联箭头函数，每次都换引用，进依赖会导致反复恢复草稿
  useEffect(() => {
    applyRef.current = apply;
  });

  const snapshot = JSON.stringify(value);
  const summaryJson = JSON.stringify(summary);

  useEffect(() => {
    hydrated.current = false;
    /*
     * 服务端渲染的是空表单，草稿只能等挂载后在客户端恢复——放 effect 里就必然要 setState；
     * 改成 useState 初始化器会与 SSR 结果不一致、触发 hydration 报错，所以这里豁免该规则。
     */
    /* eslint-disable react-hooks/set-state-in-effect */
    if (skipRestore) {
      // 改单来的：表单已被原单内容预填，草稿不再参与
      setCurrentId(draftId ?? null);
    } else {
      const target = draftId ? findDraft(userId, draftId) : newestDraft(userId, scope);
      if (target) {
        applyRef.current(target.data as T);
        setCurrentId(target.id);
        setRestoredAt(target.savedAt);
        setSavedAt(target.savedAt);
      } else {
        setCurrentId(draftId ?? null);
      }
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    hydrated.current = true;
  }, [userId, scope, draftId, skipRestore]);

  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      if (!hasContent) {
        // 全清空了：把当前这份草稿删掉，别在草稿箱里留个空壳
        if (currentId) deleteDraft(userId, currentId);
        setCurrentId(null);
        setSavedAt(null);
        return;
      }
      const id = currentId ?? createDraftId();
      const record: DraftRecord = {
        id,
        scope,
        savedAt: Date.now(),
        summary: JSON.parse(summaryJson) as DraftSummary,
        data: JSON.parse(snapshot) as unknown,
      };
      saveDraft(userId, record);
      if (!currentId) setCurrentId(id);
      setSavedAt(record.savedAt);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [userId, scope, currentId, snapshot, summaryJson, hasContent]);

  function clearStored() {
    if (currentId) deleteDraft(userId, currentId);
    setSavedAt(null);
  }

  function discard() {
    if (currentId) deleteDraft(userId, currentId);
    setCurrentId(null);
    setRestoredAt(null);
    setSavedAt(null);
    onDiscard();
  }

  /** 另开一张：只解开与当前草稿的绑定（它留在草稿箱里），表单清空 */
  function startNew() {
    setCurrentId(null);
    setRestoredAt(null);
    setSavedAt(null);
    onDiscard();
  }

  return { restoredAt, savedAt, currentId, discard, startNew, clearStored };
}
