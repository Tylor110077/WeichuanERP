import { test } from "node:test";
import assert from "node:assert/strict";
import { initials, searchPinyin, matchesSearch, pinyinQuery, hasChinese } from "../src/lib/pinyin";

/**
 * 回归背景：所有搜索都要支持拼音首字母（打 zjw 就能搜到「张敬玮」）。
 * 这里锁住三件事：
 * 1. 首字母算得对，尤其是**多音字按词组判**（重庆 → cq，不是 zq；长城 → cc，长虹 → ch）；
 * 2. 非汉字原样保留（编码、型号、数字照样能搜）；
 * 3. 本地过滤 matchesSearch 与 SQL 侧用的是同一套语义，不会一半支持一半不支持。
 */

test("常见名称的首字母", () => {
  assert.equal(initials("张敬玮"), "zjw");
  assert.equal(initials("李燕芬"), "lyf");
  assert.equal(initials("远东电缆"), "yddl");
  assert.equal(initials("正泰电器"), "ztdq");
  assert.equal(initials("远东电缆有限公司"), "yddlyxgs");
});

test("多音字按词组判断（重庆→cq、长城→cc、长虹→ch）", () => {
  assert.equal(initials("重庆"), "cq", "重庆应是 chongqing，不是 zhongqing");
  assert.equal(initials("重庆鑫玮川物资有限公司"), "cqxwcwzyxgs");
  assert.equal(initials("长城"), "cc");
  assert.equal(initials("长虹"), "ch");
});

test("非汉字原样保留：编码 / 型号 / 数字都能搜", () => {
  assert.equal(initials("P001079"), "p001079");
  assert.equal(initials("BV 2.5平方 单芯铜线"), "bv 2.5pf dxtx");
  assert.equal(initials(""), "");
  assert.equal(initials("ABC"), "abc");
});

test("searchPinyin 多字段拼接（名称 + 编码 + 厂家）", () => {
  assert.equal(searchPinyin("远东电缆", "P001079"), "yddl p001079");
  assert.equal(searchPinyin("张敬玮", null, undefined), "zjw");
  assert.equal(searchPinyin(null, ""), "", "全是空值时给空串，不是 undefined");
  // 超长截断，避免写爆 varchar(255)
  assert.ok(searchPinyin("电".repeat(400)).length <= 255);
});

test("matchesSearch：中文原样与首字母都能命中", () => {
  const py = searchPinyin("张敬玮", "李燕芬");
  assert.equal(matchesSearch("张敬玮", py, "张敬"), true, "中文片段");
  assert.equal(matchesSearch("张敬玮", py, "zjw"), true, "全拼首字母");
  assert.equal(matchesSearch("张敬玮", py, "zj"), true, "前缀");
  assert.equal(matchesSearch("张敬玮", py, "jw"), true, "中间片段（跳过姓）");
  assert.equal(matchesSearch("张敬玮", py, "lyf"), true, "命中另一字段的首字母");
  assert.equal(matchesSearch("张敬玮", py, "ww"), false, "无关关键字不应命中");
  assert.equal(matchesSearch("张敬玮", py, "  "), true, "空关键字＝不过滤");
});

test("关键字归一化：大小写与首尾空格都不影响", () => {
  assert.equal(pinyinQuery("  ZJW "), "zjw");
  assert.equal(matchesSearch("张敬玮", "zjw", " ZJW "), true);
});

test("hasChinese 用来决定要不要拼 search_pinyin 分支", () => {
  assert.equal(hasChinese("zjw"), false);
  assert.equal(hasChinese("BV2.5"), false);
  assert.equal(hasChinese("张"), true);
  assert.equal(hasChinese("电缆 BV"), true);
});
