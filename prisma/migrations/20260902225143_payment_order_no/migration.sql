-- 收款/付款单补单据号（文档 7.3：PAY/POF + 日期 + 序号）
ALTER TABLE `payments` ADD COLUMN `order_no` VARCHAR(30) NOT NULL;
CREATE UNIQUE INDEX `payments_order_no_key` ON `payments`(`order_no`);
