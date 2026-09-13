-- 星标：售卖单与进货单各加一列，默认不星标。
-- 开单时可标记，开单后在列表/详情可随时加上或取消。
ALTER TABLE `sale_orders` ADD COLUMN `starred` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `purchase_orders` ADD COLUMN `starred` BOOLEAN NOT NULL DEFAULT false;
