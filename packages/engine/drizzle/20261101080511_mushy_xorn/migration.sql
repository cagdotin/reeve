CREATE TABLE `item_categories` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`parent_id` text,
	`budget_category_id` text,
	`hidden` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_item_categories_parent_id_item_categories_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `item_categories`(`id`),
	CONSTRAINT `fk_item_categories_budget_category_id_accounts_id_fk` FOREIGN KEY (`budget_category_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `product_aliases` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`payee_id` text,
	`text` text NOT NULL,
	`key` text NOT NULL,
	`code` text,
	`pack_size` real,
	`rejected` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_product_aliases_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_product_aliases_payee_id_payees_id_fk` FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`parent_id` text,
	`item_category_id` text,
	`unit` text DEFAULT 'piece' NOT NULL,
	`size` real,
	`size_unit` text,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_products_parent_id_products_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `products`(`id`),
	CONSTRAINT `fk_products_item_category_id_item_categories_id_fk` FOREIGN KEY (`item_category_id`) REFERENCES `item_categories`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `receipt_adjustments` (
	`id` text PRIMARY KEY,
	`receipt_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text,
	CONSTRAINT `fk_receipt_adjustments_receipt_id_receipts_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `receipt_lines` (
	`id` text PRIMARY KEY,
	`receipt_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`code` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text,
	`unit_price` real,
	`line_total` integer NOT NULL,
	`pack_size` real,
	`product_id` text,
	`item_category_id` text,
	`budget_category_id` text,
	`notes` text,
	CONSTRAINT `fk_receipt_lines_receipt_id_receipts_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_receipt_lines_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_receipt_lines_item_category_id_item_categories_id_fk` FOREIGN KEY (`item_category_id`) REFERENCES `item_categories`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_receipt_lines_budget_category_id_accounts_id_fk` FOREIGN KEY (`budget_category_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `receipt_payments` (
	`id` text PRIMARY KEY,
	`receipt_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_receipt_payments_receipt_id_receipts_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_receipt_payments_transaction_id_transactions_id_fk` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `receipt_photos` (
	`id` text PRIMARY KEY,
	`receipt_id` text NOT NULL,
	`position` integer NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_receipt_photos_receipt_id_receipts_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY,
	`payee_id` text,
	`date` integer NOT NULL,
	`time` text,
	`total` integer NOT NULL,
	`notes` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_receipts_payee_id_payees_id_fk` FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `item_categories_parent` ON `item_categories` (`parent_id`);--> statement-breakpoint
CREATE INDEX `product_aliases_key` ON `product_aliases` (`key`);--> statement-breakpoint
CREATE INDEX `product_aliases_code` ON `product_aliases` (`code`);--> statement-breakpoint
CREATE INDEX `product_aliases_product` ON `product_aliases` (`product_id`);--> statement-breakpoint
CREATE INDEX `products_parent` ON `products` (`parent_id`);--> statement-breakpoint
CREATE INDEX `receipt_adjustments_receipt` ON `receipt_adjustments` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_receipt` ON `receipt_lines` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_product` ON `receipt_lines` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_payments_pair` ON `receipt_payments` (`receipt_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `receipt_payments_transaction` ON `receipt_payments` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `receipt_photos_receipt` ON `receipt_photos` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipts_date` ON `receipts` (`date`);--> statement-breakpoint
CREATE INDEX `receipts_payee` ON `receipts` (`payee_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_external_id` ON `receipts` (`external_id`);