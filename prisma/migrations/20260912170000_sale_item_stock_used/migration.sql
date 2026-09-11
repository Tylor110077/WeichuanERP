-- 销售行：记录本次使用现有库存的数量（其余为现场进货）
ALTER TABLE `sale_order_items`
  ADD COLUMN `stock_qty_used` DECIMAL(12, 3) NOT NULL DEFAULT 0;
