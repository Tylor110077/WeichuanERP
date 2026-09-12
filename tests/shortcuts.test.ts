import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SHORTCUTS,
  SHORTCUTS,
  catalogForRole,
  defaultShortcutIds,
  readShortcutIds,
  resolveShortcuts,
} from "../src/lib/shortcuts";

/**
 * 回归背景：工作台快捷入口由用户自己编排，但「能放什么」必须由角色权限决定。
 * 前端保存时提交的是 id 数组，服务端要再过滤一遍——否则把请求里的 id 换成
 * 「users」（用户管理）就能让业务员的工作台上出现一个越权入口。
 */

test("目录里的 id 唯一，href 合法", () => {
  const ids = SHORTCUTS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "有重复 id");
  for (const s of SHORTCUTS) {
    assert.ok(s.href.startsWith("/"), `${s.id} 的 href 不是站内路径`);
    assert.ok(s.label.length > 0 && s.desc.length > 0, `${s.id} 缺 label/desc`);
  }
});

test("业务员看不到金钱相关与系统入口", () => {
  const ids = catalogForRole("sales").map((s) => s.id);
  for (const forbidden of ["receivables", "sales-analysis", "price-analysis", "reports", "stock-movements", "users", "audit-logs"]) {
    assert.ok(!ids.includes(forbidden), `业务员不该看到 ${forbidden}`);
  }
  assert.ok(ids.includes("sale-new"), "业务员应该能放「开售卖单」");
});

test("老板/财务不能放开单入口（老板不开单）", () => {
  const ids = catalogForRole("boss").map((s) => s.id);
  assert.ok(!ids.includes("sale-new"), "老板不该能放「开售卖单」");
  assert.ok(!ids.includes("purchase-new"), "老板不该能放「开进货单」");
  assert.ok(ids.includes("reports"), "老板应该能放「报表中心」");
});

test("越权 / 未知 / 重复的 id 都会被丢掉", () => {
  const got = resolveShortcuts(
    ["sale-new", "users", "nonexistent-id", "sale-new", "audit-logs"],
    "sales"
  ).map((s) => s.id);
  assert.deepEqual(got, ["sale-new"], "只应保留业务员有权且存在的 id，并去重");
});

test("顺序按传入的 id 顺序保留", () => {
  const got = resolveShortcuts(["customers", "sale-new", "inventory"], "sales").map((s) => s.id);
  assert.deepEqual(got, ["customers", "sale-new", "inventory"]);
});

test("数量截断到上限", () => {
  const all = catalogForRole("admin").map((s) => s.id);
  assert.ok(all.length > MAX_SHORTCUTS, "管理员可选项应该多于上限，否则这个测试没意义");
  assert.equal(resolveShortcuts(all, "admin").length, MAX_SHORTCUTS);
});

test("每个角色的默认入口都合法且不为空", () => {
  for (const role of ["admin", "sales", "boss"] as const) {
    const defaults = defaultShortcutIds(role);
    assert.ok(defaults.length > 0, `${role} 应有默认入口`);
    // 默认值必须原样通过过滤（否则说明默认里放了越权/不存在的 id）
    assert.deepEqual(
      resolveShortcuts(defaults, role).map((s) => s.id),
      defaults,
      `${role} 的默认入口里有非法项`
    );
  }
});

test("库里读出的脏数据不会炸", () => {
  assert.equal(readShortcutIds(null), null, "null（从没设置过）要能区分出来");
  assert.equal(readShortcutIds("not-an-array"), null);
  assert.deepEqual(readShortcutIds([]), [], "空数组 = 用户主动清空，不能当成没设置");
  assert.deepEqual(readShortcutIds(["a", 1, null, "b"]), ["a", "b"], "非字符串项要被过滤");
});

test("空数组（用户清空过）渲染成空，不回退默认", () => {
  assert.deepEqual(resolveShortcuts([], "admin"), []);
});
