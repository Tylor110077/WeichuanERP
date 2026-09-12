import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlankOrZero, isNegative, parseReturnRows } from "../src/lib/return-rows";

/**
 * 回归背景：退货单要求「不填就是不退」。原先每一行的退货数量都是 required + min 0.001，
 * 于是只想退其中两样时，其余行必须删掉才能提交；把 required 去掉之后，
 * 判断"这一行到底退不退"就落到了 parseReturnRows 上——
 * 一旦判错就是"该退的没退"或"没填的也退了"，从界面看不出来，所以用测试钉住。
 */

function fd(rows: Record<string, string | null>[]): FormData {
  const f = new FormData();
  rows.forEach((row, i) => {
    for (const [k, v] of Object.entries(row)) {
      if (v !== null) f.set(`item_${i}_${k}`, v);
    }
  });
  return f;
}

test("留空 / 填 0 / 只有空格：这一行不退（整行跳过）", () => {
  const { items, skipped } = parseReturnRows(
    fd([
      { orderItemId: "1", quantity: "", unitPrice: "120" },
      { orderItemId: "2", quantity: "0", unitPrice: "99" },
      { orderItemId: "3", quantity: "0.000", unitPrice: "99" },
      { orderItemId: "4", quantity: "   ", unitPrice: "99" },
      { orderItemId: "5", quantity: "10", unitPrice: "99" },
    ])
  );
  assert.equal(items.length, 1, "只有第 5 行要退");
  assert.equal(String(items[0].orderItemId), "5");
  assert.equal(skipped, 4);
});

test("负数不是「跳过」，要留给校验报错", () => {
  const { items } = parseReturnRows(
    fd([{ orderItemId: "1", quantity: "-5", unitPrice: "120" }])
  );
  assert.equal(items.length, 1, "负数必须进入校验流程，不能被静默忽略");
  assert.ok(isNegative(items[0].quantity));
  assert.equal(isNegative("0"), false);
  assert.equal(isNegative(""), false);
  assert.equal(isNegative("-0.001"), true);
});

test("没选商品的行跳过（用户点了「+ 添加退货行」但没用）", () => {
  const { items, skipped } = parseReturnRows(
    fd([
      { orderItemId: "", quantity: "10", unitPrice: "99" },
      { orderItemId: "7", quantity: "3", unitPrice: "99" },
    ])
  );
  assert.equal(items.length, 1);
  assert.equal(skipped, 1);
});

test("没选商品且没填数量的空行同样跳过", () => {
  const { items, skipped } = parseReturnRows(fd([{ orderItemId: "", quantity: "", unitPrice: "" }]));
  assert.equal(items.length, 0);
  assert.equal(skipped, 1);
});

test("跳过的行不校验退货价（只填了数量的行才算数）", () => {
  // 第 1 行：有数量但没价格 —— 必须留下，让"请填写退货单价"报出来
  const { items } = parseReturnRows(
    fd([
      { orderItemId: "1", quantity: "5", unitPrice: "" },
      { orderItemId: "2", quantity: "", unitPrice: "" },
    ])
  );
  assert.equal(items.length, 1);
  assert.equal(String(items[0].orderItemId), "1");
});

test("非数字文本不会被当成 0（留给校验报错，而不是静默跳过）", () => {
  const { items } = parseReturnRows(
    fd([{ orderItemId: "1", quantity: "abc", unitPrice: "99" }])
  );
  assert.equal(items.length, 1, "填了乱七八糟的内容要报错，不能悄悄当没填");
  assert.equal(isBlankOrZero("abc"), false);
});

test("行数按索引连续读取，删行后重新编号也能读全", () => {
  const { items } = parseReturnRows(
    fd([
      { orderItemId: "1", quantity: "1", unitPrice: "10" },
      { orderItemId: "2", quantity: "2", unitPrice: "20" },
      { orderItemId: "3", quantity: "3", unitPrice: "30" },
    ])
  );
  assert.deepEqual(items.map((r) => String(r.orderItemId)), ["1", "2", "3"]);
});

test("全部留空：items 为空（由上层给出「请至少填写一行」的提示）", () => {
  const { items, skipped } = parseReturnRows(
    fd([
      { orderItemId: "1", quantity: "", unitPrice: "120" },
      { orderItemId: "2", quantity: "", unitPrice: "99" },
    ])
  );
  assert.equal(items.length, 0);
  assert.equal(skipped, 2);
});
