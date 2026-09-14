-- AlterTable
ALTER TABLE `audit_logs` ADD COLUMN `actor_kind` ENUM('human', 'agent') NOT NULL DEFAULT 'human',
    ADD COLUMN `agent_run_id` VARCHAR(50) NULL,
    ADD COLUMN `api_token_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `actor_kind` ENUM('human', 'agent') NOT NULL DEFAULT 'human',
    ADD COLUMN `agent_run_id` VARCHAR(50) NULL,
    ADD COLUMN `api_token_id` INTEGER NULL,
    ADD COLUMN `review_status` ENUM('not_required', 'pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'not_required',
    ADD COLUMN `reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `reviewed_by` INTEGER NULL,
    ADD COLUMN `revision_of` INTEGER NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `purchase_orders` ADD COLUMN `actor_kind` ENUM('human', 'agent') NOT NULL DEFAULT 'human',
    ADD COLUMN `agent_run_id` VARCHAR(50) NULL,
    ADD COLUMN `api_token_id` INTEGER NULL,
    ADD COLUMN `review_status` ENUM('not_required', 'pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'not_required',
    ADD COLUMN `reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `reviewed_by` INTEGER NULL,
    ADD COLUMN `revision_of` INTEGER NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `purchase_returns` ADD COLUMN `actor_kind` ENUM('human', 'agent') NOT NULL DEFAULT 'human',
    ADD COLUMN `agent_run_id` VARCHAR(50) NULL,
    ADD COLUMN `api_token_id` INTEGER NULL,
    ADD COLUMN `review_status` ENUM('not_required', 'pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'not_required',
    ADD COLUMN `reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `reviewed_by` INTEGER NULL,
    ADD COLUMN `revision_of` INTEGER NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `sale_orders` ADD COLUMN `actor_kind` ENUM('human', 'agent') NOT NULL DEFAULT 'human',
    ADD COLUMN `agent_run_id` VARCHAR(50) NULL,
    ADD COLUMN `api_token_id` INTEGER NULL,
    ADD COLUMN `review_status` ENUM('not_required', 'pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'not_required',
    ADD COLUMN `reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `reviewed_by` INTEGER NULL,
    ADD COLUMN `revision_of` INTEGER NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `sale_returns` ADD COLUMN `actor_kind` ENUM('human', 'agent') NOT NULL DEFAULT 'human',
    ADD COLUMN `agent_run_id` VARCHAR(50) NULL,
    ADD COLUMN `api_token_id` INTEGER NULL,
    ADD COLUMN `review_status` ENUM('not_required', 'pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'not_required',
    ADD COLUMN `reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `reviewed_by` INTEGER NULL,
    ADD COLUMN `revision_of` INTEGER NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `review_notes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `doc_type` VARCHAR(30) NOT NULL,
    `doc_id` INTEGER NOT NULL,
    `round` INTEGER NOT NULL DEFAULT 1,
    `verdict` VARCHAR(20) NOT NULL,
    `notes` VARCHAR(1000) NOT NULL,
    `reviewer_user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `review_notes_doc_type_doc_id_round_idx`(`doc_type`, `doc_id`, `round`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `review_notes` ADD CONSTRAINT `review_notes_reviewer_user_id_fkey` FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

