CREATE TABLE `accounts` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`on_budget` integer DEFAULT false NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`group_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`system` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_accounts_group_id_category_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `category_groups`(`id`),
	CONSTRAINT "accounts_on_budget_kind" CHECK("on_budget" = 0 OR "type" IN ('asset', 'liability'))
);
--> statement-breakpoint
CREATE TABLE `budget_months` (
	`budget_type` text NOT NULL,
	`month` integer NOT NULL,
	`hold` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `budget_months_pk` PRIMARY KEY(`budget_type`, `month`)
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`budget_type` text NOT NULL,
	`month` integer NOT NULL,
	`category_id` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`carryover` integer DEFAULT false NOT NULL,
	`goal` integer,
	`long_goal` integer,
	CONSTRAINT `budgets_pk` PRIMARY KEY(`budget_type`, `month`, `category_id`),
	CONSTRAINT `fk_budgets_category_id_accounts_id_fk` FOREIGN KEY (`category_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `category_groups` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`is_income` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_reports` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_pages` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY,
	`note` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payees` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`learn_categories` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `postings` (
	`id` text PRIMARY KEY,
	`transaction_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` integer NOT NULL,
	`memo` text,
	`category_id` text,
	`cleared` integer DEFAULT false NOT NULL,
	`reconciled` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_postings_transaction_id_transactions_id_fk` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_postings_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
	CONSTRAINT `fk_postings_category_id_accounts_id_fk` FOREIGN KEY (`category_id`) REFERENCES `accounts`(`id`)
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY,
	`stage` text DEFAULT 'default' NOT NULL,
	`conditions_op` text DEFAULT 'and' NOT NULL,
	`conditions` text NOT NULL,
	`actions` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY,
	`name` text,
	`rule_id` text NOT NULL,
	`next_date` integer,
	`completed` integer DEFAULT false NOT NULL,
	`posts_transaction` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_schedules_rule_id_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY,
	`tag` text NOT NULL UNIQUE,
	`color` text,
	`description` text
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY,
	`date` integer NOT NULL,
	`payee_id` text,
	`notes` text,
	`schedule_id` text,
	`imported_payee` text,
	`imported_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_transactions_payee_id_payees_id_fk` FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`)
);
--> statement-breakpoint
CREATE TABLE `undo_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`group_id` integer NOT NULL,
	`stack` text NOT NULL,
	`statement` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `undo_state` (
	`id` integer PRIMARY KEY,
	`group_id` integer DEFAULT 0 NOT NULL,
	`stack` text DEFAULT 'undo' NOT NULL,
	`active` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `widgets` (
	`id` text PRIMARY KEY,
	`page_id` text NOT NULL,
	`type` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`meta` text,
	CONSTRAINT `fk_widgets_page_id_dashboard_pages_id_fk` FOREIGN KEY (`page_id`) REFERENCES `dashboard_pages`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `accounts_type` ON `accounts` (`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_system` ON `accounts` (`system`);--> statement-breakpoint
CREATE INDEX `postings_transaction` ON `postings` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `postings_account` ON `postings` (`account_id`);--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_payee` ON `transactions` (`payee_id`);--> statement-breakpoint
CREATE INDEX `transactions_schedule` ON `transactions` (`schedule_id`);--> statement-breakpoint
CREATE INDEX `undo_log_group` ON `undo_log` (`group_id`);