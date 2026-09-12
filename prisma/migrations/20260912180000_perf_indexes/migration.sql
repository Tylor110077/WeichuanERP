-- 大数据量性能：补齐高频筛选/排序的复合索引
-- 背景与实测见 docs/系统梳理/08-大数据量性能设计.md
-- 这些查询的共同形态是「按状态/对象过滤 + 按时间倒序取一页」，
-- 单列索引只能命中其中一个条件，复合索引可以同时服务过滤与排序，避免 filesort。

-- 单据列表：status + 时间倒序（售卖单/进货单列表、应收应付、报表）
CREATE INDEX `sale_orders_status_created_at_idx` ON `sale_orders`(`status`, `created_at`);
CREATE INDEX `purchase_orders_status_created_at_idx` ON `purchase_orders`(`status`, `created_at`);

-- 按对象钻取：某客户/某厂家的单据，按时间
CREATE INDEX `sale_orders_customer_id_created_at_idx` ON `sale_orders`(`customer_id`, `created_at`);
CREATE INDEX `purchase_orders_supplier_id_created_at_idx` ON `purchase_orders`(`supplier_id`, `created_at`);

-- 退货单列表（按时间倒序，无其他过滤）
CREATE INDEX `sale_returns_created_at_idx` ON `sale_returns`(`created_at`);
CREATE INDEX `purchase_returns_created_at_idx` ON `purchase_returns`(`created_at`);

-- 商品页「按厂家」分组与筛选（groupBy manufacturer / WHERE manufacturer = ?）
CREATE INDEX `products_manufacturer_idx` ON `products`(`manufacturer`);

-- 客户按电话搜索
CREATE INDEX `customers_phone_idx` ON `customers`(`phone`);

-- 库存流水：业务类型 + 时间（列表筛选）
CREATE INDEX `stock_movements_biz_type_created_at_idx` ON `stock_movements`(`biz_type`, `created_at`);
