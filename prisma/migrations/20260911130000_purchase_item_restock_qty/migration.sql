-- 自动补货支持「多进备货」：记录进货行中超出触发销售单需求的部分
-- 语义：quantity = 客户订单量 + restock_qty（备货量）
-- 备货进库存备用，不计入该客户的销售金额、成本快照与应收。
ALTER TABLE `purchase_order_items`
  ADD COLUMN `restock_qty` DECIMAL(12, 3) NOT NULL DEFAULT 0;
