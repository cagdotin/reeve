ALTER TABLE `custom_reports` ADD `legacy_definition` text;--> statement-breakpoint
ALTER TABLE `dashboard_pages` ADD `host` text;--> statement-breakpoint
ALTER TABLE `widgets` ADD `report_id` text REFERENCES custom_reports(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `widgets` ADD `config` text;--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_pages_host` ON `dashboard_pages` (`host`) WHERE "dashboard_pages"."host" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `widgets_report` ON `widgets` (`report_id`);