-- The undo triggers name the column this drops, and open.ts remakes them. The undo history's
-- reverse SQL names it too, so that history cannot run after this and goes with it.
DROP TRIGGER IF EXISTS undo_transactions_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS undo_transactions_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS undo_transactions_delete;--> statement-breakpoint
DELETE FROM undo_log;--> statement-breakpoint
CREATE TABLE `seen_imports` (
	`account_id` text NOT NULL,
	`imported_id` text NOT NULL,
	`date` integer NOT NULL,
	`amount` integer NOT NULL,
	`payee` text,
	`first_seen_at` integer NOT NULL,
	CONSTRAINT `seen_imports_pk` PRIMARY KEY(`account_id`, `imported_id`),
	CONSTRAINT `fk_seen_imports_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bank_connections` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`aspsp_name` text NOT NULL,
	`aspsp_country` text NOT NULL,
	`status` text NOT NULL,
	`state` text,
	`session_id` text,
	`valid_until` integer,
	`accounts` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_links` (
	`account_id` text PRIMARY KEY,
	`connection_id` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`identification_hash` text,
	`currency` text,
	`history_start` integer NOT NULL,
	`fetch_day` integer,
	`fetch_count` integer DEFAULT 0 NOT NULL,
	`sync_started_at` integer,
	`retry_after` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`status_message` text,
	`last_synced_at` integer,
	`bank_balance` integer,
	`bank_balance_type` text,
	`bank_balance_at` integer,
	CONSTRAINT `fk_bank_links_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_bank_links_connection_id_bank_connections_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `bank_connections`(`id`)
);
--> statement-breakpoint
ALTER TABLE `postings` ADD `imported_id` text;--> statement-breakpoint
-- A bank line names one posting: the transaction's balance posting, and on a transfer the leg
-- the import cleared, or both when that cannot tell. A repeated id keeps its first posting.
UPDATE `postings` SET `imported_id` = (SELECT t.`imported_id` FROM `transactions` t WHERE t.`id` = `postings`.`transaction_id`)
WHERE rowid IN (
  SELECT min(p.rowid)
  FROM `postings` p
  JOIN `transactions` t ON t.`id` = p.`transaction_id`
  JOIN `accounts` a ON a.`id` = p.`account_id`
  WHERE t.`imported_id` IS NOT NULL
    AND a.`type` IN ('asset', 'liability')
    AND (p.`cleared` = 1 OR NOT EXISTS (
      SELECT 1 FROM `postings` o JOIN `accounts` b ON b.`id` = o.`account_id`
      WHERE o.`transaction_id` = p.`transaction_id` AND o.`id` <> p.`id` AND o.`cleared` = 1
        AND b.`type` IN ('asset', 'liability')))
  GROUP BY p.`account_id`, t.`imported_id`
);--> statement-breakpoint
INSERT OR IGNORE INTO `seen_imports` (`account_id`, `imported_id`, `date`, `amount`, `payee`, `first_seen_at`)
SELECT p.`account_id`, p.`imported_id`, t.`date`, p.`amount`, py.`name`, t.`created_at`
FROM `postings` p
JOIN `transactions` t ON t.`id` = p.`transaction_id`
LEFT JOIN `payees` py ON py.`id` = t.`payee_id`
WHERE p.`imported_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `postings_imported_id` ON `postings` (`account_id`,`imported_id`) WHERE "postings"."imported_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `bank_links_connection` ON `bank_links` (`connection_id`);--> statement-breakpoint
ALTER TABLE `transactions` DROP COLUMN `imported_id`;