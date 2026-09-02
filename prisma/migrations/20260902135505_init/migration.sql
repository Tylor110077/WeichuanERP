-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `display_name` VARCHAR(50) NOT NULL,
    `role` ENUM('admin', 'sales', 'boss') NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token_hash` CHAR(64) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sessions_token_hash_key`(`token_hash`),
    INDEX `sessions_user_id_idx`(`user_id`),
    INDEX `sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `username` VARCHAR(50) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `ip` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `login_logs_user_id_success_created_at_idx`(`user_id`, `success`, `created_at`),
    INDEX `login_logs_username_created_at_idx`(`username`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `action` VARCHAR(50) NOT NULL,
    `entity_type` VARCHAR(50) NOT NULL,
    `entity_id` BIGINT NULL,
    `before_json` JSON NULL,
    `after_json` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `audit_logs_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `units` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(20) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `units_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `parent_id` INTEGER NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `spec` VARCHAR(100) NULL,
    `category_id` INTEGER NULL,
    `unit_id` INTEGER NOT NULL,
    `ref_purchase_price` DECIMAL(12, 2) NOT NULL,
    `ref_sale_price` DECIMAL(12, 2) NOT NULL,
    `min_stock` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `stock_qty` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `stock_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `avg_cost` DECIMAL(12, 4) NOT NULL DEFAULT 0,
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_code_key`(`code`),
    INDEX `products_name_idx`(`name`),
    INDEX `products_category_id_idx`(`category_id`),
    INDEX `products_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `contact` VARCHAR(50) NULL,
    `phone` VARCHAR(30) NULL,
    `address` VARCHAR(200) NULL,
    `remark` VARCHAR(200) NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `suppliers_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `contact` VARCHAR(50) NULL,
    `phone` VARCHAR(30) NULL,
    `address` VARCHAR(200) NULL,
    `remark` VARCHAR(200) NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customers_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(30) NOT NULL,
    `supplier_id` INTEGER NOT NULL,
    `status` ENUM('pending', 'received', 'voided') NOT NULL DEFAULT 'pending',
    `total_amount` DECIMAL(14, 2) NOT NULL,
    `paid_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `source_sale_order_id` INTEGER NULL,
    `source_type` ENUM('manual', 'auto') NOT NULL DEFAULT 'manual',
    `remark` VARCHAR(200) NULL,
    `operator_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `received_at` DATETIME(3) NULL,
    `voided_by` INTEGER NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(200) NULL,

    UNIQUE INDEX `purchase_orders_order_no_key`(`order_no`),
    INDEX `purchase_orders_supplier_id_idx`(`supplier_id`),
    INDEX `purchase_orders_status_idx`(`status`),
    INDEX `purchase_orders_operator_id_idx`(`operator_id`),
    INDEX `purchase_orders_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchase_order_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `unit_id` INTEGER NOT NULL,
    `unit_price` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,

    INDEX `purchase_order_items_purchase_order_id_idx`(`purchase_order_id`),
    INDEX `purchase_order_items_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(30) NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `status` ENUM('confirmed', 'voided') NOT NULL DEFAULT 'confirmed',
    `total_amount` DECIMAL(14, 2) NOT NULL,
    `received_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `remark` VARCHAR(200) NULL,
    `operator_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voided_by` INTEGER NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(200) NULL,

    UNIQUE INDEX `sale_orders_order_no_key`(`order_no`),
    INDEX `sale_orders_customer_id_idx`(`customer_id`),
    INDEX `sale_orders_status_idx`(`status`),
    INDEX `sale_orders_operator_id_idx`(`operator_id`),
    INDEX `sale_orders_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sale_order_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `unit_id` INTEGER NOT NULL,
    `unit_price` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `cost_amount` DECIMAL(14, 2) NOT NULL,

    INDEX `sale_order_items_sale_order_id_idx`(`sale_order_id`),
    INDEX `sale_order_items_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_returns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(30) NOT NULL,
    `purchase_order_id` INTEGER NOT NULL,
    `supplier_id` INTEGER NOT NULL,
    `total_amount` DECIMAL(14, 2) NOT NULL,
    `remark` VARCHAR(200) NULL,
    `operator_id` INTEGER NOT NULL,
    `status` ENUM('confirmed', 'voided') NOT NULL DEFAULT 'confirmed',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voided_by` INTEGER NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(200) NULL,

    UNIQUE INDEX `purchase_returns_order_no_key`(`order_no`),
    INDEX `purchase_returns_purchase_order_id_idx`(`purchase_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_return_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchase_return_id` INTEGER NOT NULL,
    `purchase_order_item_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `unit_id` INTEGER NOT NULL,
    `unit_price` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,

    INDEX `purchase_return_items_purchase_return_id_idx`(`purchase_return_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_returns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(30) NOT NULL,
    `sale_order_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `total_amount` DECIMAL(14, 2) NOT NULL,
    `remark` VARCHAR(200) NULL,
    `operator_id` INTEGER NOT NULL,
    `status` ENUM('confirmed', 'voided') NOT NULL DEFAULT 'confirmed',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voided_by` INTEGER NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(200) NULL,

    UNIQUE INDEX `sale_returns_order_no_key`(`order_no`),
    INDEX `sale_returns_sale_order_id_idx`(`sale_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_return_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sale_return_id` INTEGER NOT NULL,
    `sale_order_item_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `unit_id` INTEGER NOT NULL,
    `unit_price` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `cost_amount` DECIMAL(14, 2) NOT NULL,

    INDEX `sale_return_items_sale_return_id_idx`(`sale_return_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction` ENUM('receipt', 'payment') NOT NULL,
    `order_type` ENUM('sale', 'purchase', 'sale_return', 'purchase_return') NOT NULL,
    `order_id` INTEGER NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `method` ENUM('cash', 'bank', 'wechat', 'alipay', 'other') NOT NULL,
    `remark` VARCHAR(200) NULL,
    `operator_id` INTEGER NOT NULL,
    `status` ENUM('confirmed', 'voided') NOT NULL DEFAULT 'confirmed',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voided_by` INTEGER NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(200) NULL,

    INDEX `payments_order_type_order_id_idx`(`order_type`, `order_id`),
    INDEX `payments_operator_id_idx`(`operator_id`),
    INDEX `payments_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_movements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `product_id` INTEGER NOT NULL,
    `change_qty` DECIMAL(12, 3) NOT NULL,
    `before_qty` DECIMAL(12, 3) NOT NULL,
    `after_qty` DECIMAL(12, 3) NOT NULL,
    `unit_cost` DECIMAL(12, 4) NOT NULL,
    `biz_type` ENUM('purchase_in', 'sale_out', 'purchase_return_out', 'sale_return_in', 'void_reverse') NOT NULL,
    `biz_order_no` VARCHAR(30) NOT NULL,
    `operator_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_movements_product_id_created_at_idx`(`product_id`, `created_at`),
    INDEX `stock_movements_biz_order_no_idx`(`biz_order_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `login_logs` ADD CONSTRAINT `login_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_categories` ADD CONSTRAINT `product_categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `product_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `product_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_source_sale_order_id_fkey` FOREIGN KEY (`source_sale_order_id`) REFERENCES `sale_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_purchase_order_id_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_orders` ADD CONSTRAINT `sale_orders_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_orders` ADD CONSTRAINT `sale_orders_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_order_items` ADD CONSTRAINT `sale_order_items_sale_order_id_fkey` FOREIGN KEY (`sale_order_id`) REFERENCES `sale_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_order_items` ADD CONSTRAINT `sale_order_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_order_items` ADD CONSTRAINT `sale_order_items_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_purchase_order_id_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_items` ADD CONSTRAINT `purchase_return_items_purchase_return_id_fkey` FOREIGN KEY (`purchase_return_id`) REFERENCES `purchase_returns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_items` ADD CONSTRAINT `purchase_return_items_purchase_order_item_id_fkey` FOREIGN KEY (`purchase_order_item_id`) REFERENCES `purchase_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_items` ADD CONSTRAINT `purchase_return_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_items` ADD CONSTRAINT `purchase_return_items_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_returns` ADD CONSTRAINT `sale_returns_sale_order_id_fkey` FOREIGN KEY (`sale_order_id`) REFERENCES `sale_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_returns` ADD CONSTRAINT `sale_returns_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_returns` ADD CONSTRAINT `sale_returns_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_items` ADD CONSTRAINT `sale_return_items_sale_return_id_fkey` FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_items` ADD CONSTRAINT `sale_return_items_sale_order_item_id_fkey` FOREIGN KEY (`sale_order_item_id`) REFERENCES `sale_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_items` ADD CONSTRAINT `sale_return_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_items` ADD CONSTRAINT `sale_return_items_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
