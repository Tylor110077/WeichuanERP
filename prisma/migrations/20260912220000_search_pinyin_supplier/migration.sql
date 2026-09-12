-- 补上厂家：售卖单按客户搜、进货单按厂家搜，都要能用拼音首字母。
ALTER TABLE `suppliers` ADD COLUMN `search_pinyin` VARCHAR(255) NULL;
