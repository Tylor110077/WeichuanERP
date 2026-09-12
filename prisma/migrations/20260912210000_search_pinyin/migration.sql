-- 拼音首字母搜索：把「名称等字段的拼音首字母串」预先算好存一列，
-- 页面上的搜索就能用 `LIKE '%zjw%'` 命中「张敬玮」。
--
-- 只给真正走 SQL 搜索的三张表加列；左栏/下拉那种小列表由服务端渲染时现算，
-- 不需要落库（也就不会过期）。
--
-- 不建索引：搜索用的是前置 %（包含匹配），索引用不上，建了只是白占空间。
ALTER TABLE `customers` ADD COLUMN `search_pinyin` VARCHAR(255) NULL;
ALTER TABLE `products`  ADD COLUMN `search_pinyin` VARCHAR(255) NULL;
ALTER TABLE `users`     ADD COLUMN `search_pinyin` VARCHAR(255) NULL;
