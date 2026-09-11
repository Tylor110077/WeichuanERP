-- 单据行备注（如包装、交货要求等按行说明）
ALTER TABLE `sale_order_items` ADD COLUMN `remark` VARCHAR(200) NULL;
ALTER TABLE `purchase_order_items` ADD COLUMN `remark` VARCHAR(200) NULL;
