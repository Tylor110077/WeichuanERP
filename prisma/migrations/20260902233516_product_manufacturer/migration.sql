-- 商品厂商（生产厂家，必填；应用层强制校验，历史数据先置空待补录）
ALTER TABLE `products` ADD COLUMN `manufacturer` VARCHAR(100) NOT NULL DEFAULT '';
