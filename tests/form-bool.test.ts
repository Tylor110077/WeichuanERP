import { test } from "node:test";
import assert from "node:assert/strict";
import { zBoolean } from "../src/lib/form-bool";

/**
 * 布尔字段的边界（踩过的坑）：
 * `z.coerce.boolean()` 走 JS 的 Boolean()，**非空字符串一律为 true**——
 * 于是命令行里的 `--enabled false` 会被当成"启用"。这些用例把字面量钉死。
 */

const parse = (v: unknown) => zBoolean().safeParse(v);

test("字符串 false / true 按字面理解（这是本文件存在的理由）", () => {
  assert.equal(parse("false").data, false);
  assert.equal(parse("true").data, true);
  assert.equal(parse("  false  ").data, false, "带空格也要认");
  assert.equal(parse("FALSE").data, false, "大小写不敏感");
});

test("数字与 0/1 文字", () => {
  assert.equal(parse(0).data, false);
  assert.equal(parse(1).data, true);
  assert.equal(parse("0").data, false);
  assert.equal(parse("1").data, true);
});

test("常见同义词", () => {
  assert.equal(parse("no").data, false);
  assert.equal(parse("off").data, false);
  assert.equal(parse("yes").data, true);
  assert.equal(parse("on").data, true);
  assert.equal(parse("否").data, false);
  assert.equal(parse("是").data, true);
});

test("真布尔直接通过", () => {
  assert.equal(parse(true).data, true);
  assert.equal(parse(false).data, false);
});

test("认不出的输入报错，而不是猜一个真值", () => {
  // 关键：不能被 Boolean("随便") === true 蒙过去
  for (const bad of ["随便", "2", "", null, undefined, {}]) {
    const r = parse(bad);
    assert.equal(r.success, false, `${JSON.stringify(bad)} 应当报错`);
  }
});

test("报错文案可定制（给用户看的中文）", () => {
  const r = zBoolean("启用标记只能是 true 或 false").safeParse("嗯");
  assert.equal(r.success, false);
  assert.match(r.error!.issues[0].message, /只能是 true 或 false/);
});
