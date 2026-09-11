import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  describeZodIssue,
  emptyToUndefined,
  firstIssueMessage,
  optionalNumber,
  requiredNumber,
} from "../src/lib/form-number";

/**
 * 回归背景：销售开单的「用库存」留空提交时，整单报
 * 「Invalid input: expected number, received NaN」——
 * 原因是 z.preprocess() 外面套 .optional()，Zod 看到的仍是原始空串，
 * 走进内层 schema 后 undefined 被 coerce 成 NaN。
 */

test("optionalNumber：留空/未填一律视为未填写", () => {
  const s = optionalNumber({ invalid: "用库存必须是数字", min: 0, minMessage: "用库存不能为负" });
  assert.equal(s.parse(""), undefined);
  assert.equal(s.parse(undefined), undefined);
  assert.equal(s.parse(null), undefined);
  assert.equal(s.parse("0"), 0);
  assert.equal(s.parse("0.000"), 0);
  assert.equal(s.parse("12.5"), 12.5);
  assert.equal(s.parse(7), 7);
});

test("optionalNumber：非法输入给中文提示而不是英文 NaN", () => {
  const s = optionalNumber({ invalid: "用库存必须是数字", min: 0, minMessage: "用库存不能为负" });
  for (const bad of ["abc", "1,000", "1e", "."]) {
    const r = s.safeParse(bad);
    assert.equal(r.success, false, `应由 ${bad} 触发校验失败`);
    assert.equal(r.error.issues[0].message, "用库存必须是数字");
    assert.doesNotMatch(r.error.issues[0].message, /Invalid input|NaN/);
  }
  const neg = s.safeParse("-1");
  assert.equal(neg.success, false);
  assert.equal(neg.error.issues[0].message, "用库存不能为负");
});

test("requiredNumber：留空/非法都给同一个中文提示", () => {
  const s = requiredNumber({ invalid: "请填写数量", min: 0.001, minMessage: "数量必须大于 0" });
  for (const bad of ["", undefined, null, "abc", "1e"]) {
    const r = s.safeParse(bad);
    assert.equal(r.success, false, `应由 ${JSON.stringify(bad)} 触发校验失败`);
    assert.match(r.error.issues[0].message, /请填写数量|数量必须大于 0/);
    assert.doesNotMatch(r.error.issues[0].message, /Invalid input|NaN/);
  }
  assert.equal(s.parse("666"), 666);
});

test("describeZodIssue：报错定位到「第几行、哪个字段」", () => {
  const items = z.object({
    items: z.array(
      z.object({
        quantity: requiredNumber({ invalid: "请填写数量" }),
        stockUsed: optionalNumber({ invalid: "用库存必须是数字", min: 0 }),
      })
    ),
  });
  const r = items.safeParse({ items: [{ quantity: "666" }, { quantity: "1", stockUsed: "oops" }] });
  assert.equal(r.success, false);
  assert.equal(describeZodIssue(r.error.issues[0]), "第 2 行「用库存」：用库存必须是数字");
  assert.equal(firstIssueMessage(r.error), "第 2 行「用库存」：用库存必须是数字");
});

test("describeZodIssue：支持按场景覆盖字段名（进货单的 unitPrice 是「进价」）", () => {
  const s = z.object({ items: z.array(z.object({ unitPrice: requiredNumber({ invalid: "请填写进价" }) })) });
  const r = s.safeParse({ items: [{ unitPrice: "" }] });
  assert.equal(r.success, false);
  assert.equal(firstIssueMessage(r.error, { unitPrice: "进价" }), "第 1 行「进价」：请填写进价");
});

test("describeZodIssue：非明细字段原样返回（如「请选择客户」）", () => {
  const s = z.object({ customerId: z.coerce.number().int().positive("请选择客户") });
  const r = s.safeParse({ customerId: "" });
  assert.equal(r.success, false);
  assert.equal(firstIssueMessage(r.error), "请选择客户");
});

test("emptyToUndefined：空串/null/undefined 转 undefined，其余原样", () => {
  assert.equal(emptyToUndefined(""), undefined);
  assert.equal(emptyToUndefined(null), undefined);
  assert.equal(emptyToUndefined(undefined), undefined);
  assert.equal(emptyToUndefined("0"), "0");
  assert.equal(emptyToUndefined(0), 0);
});
