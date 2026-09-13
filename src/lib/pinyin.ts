/**
 * 拼音首字母搜索。
 *
 * 目标：原本要打全「张敬玮」才能搜到，现在打 `zjw` 也要能搜到；
 * 商品名里的「单芯铜线」打 `dxtx`、厂家「远东电缆」打 `yddl` 同理。
 *
 * 两种用法（**不要再各写一套**）：
 * 1. 服务端 SQL 搜索：写入侧用 `searchPinyin()` 算好存进 `search_pinyin` 列，
 *    查询侧用 `pinyinQuery()` 归一化关键字后 `contains` 该列；
 * 2. 客户端本地过滤（左栏列表、下拉候选）：条目上带一个由服务端算好的 `py`，
 *    用 `matchesSearch(label, py, q)` 判断命中。
 *
 * 多音字交给 pinyin-pro 按词组判断（「重庆」→ `cq` 而不是 `zq`，这类在我们这儿很常见），
 * 那部分在服务端算（lib/pinyin-server.ts），浏览器里只做匹配。
 * 非汉字（字母、数字、空格）原样保留并转小写，所以 `bv`、`2.5`、`p001` 这些照样能搜。
 */

/** 取拼音首字母：张敬玮 → zjw；BV 2.5平方 单芯铜线 → bv 2.5pf dxtx */

/**
 * 由若干字段拼出存库的搜索串：每个字段各取首字母，字段之间用空格分隔。
 * 例：searchPinyin("远东电缆", "P001079") → "yddl p001079"
 * 这样「搜名字的首字母」和「搜编码」在同一个 like 里都能命中。
 */

/** 把用户输入的关键字归一化成用于匹配拼音串的形式：去空白 + 小写 */
/**
 * 这个模块**不能**引入 pinyin-pro：它会被客户端组件引用（下拉候选、左栏过滤）。
 * 需要拼音词典的部分在 lib/pinyin-server.ts。
 */

export function pinyinQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * 关键字里是否含中文（含中文时拼音串没有意义，交给原有的中文 like 分支即可）。
 * 用于决定要不要拼 `search_pinyin` 那个 OR 条件。
 */
export function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * 本地过滤（客户端）：标签本身命中，或它的拼音首字母串命中，都算匹配。
 * `py` 由服务端用 `initials()` / `searchPinyin()` 预先算好随数据下发，
 * 这样浏览器里不需要带一份拼音词典（否则首屏要白白多几百 KB）。
 */
export function matchesSearch(label: string, py: string, query: string): boolean {
  const q = pinyinQuery(query);
  if (!q) return true;
  return label.toLowerCase().includes(q) || py.includes(q);
}
