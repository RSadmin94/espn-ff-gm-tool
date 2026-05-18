ALTER TABLE `espn_view_health` ADD COLUMN IF NOT EXISTS `errorMessage` text;--> statement-breakpoint
ALTER TABLE `espn_view_health` ADD COLUMN IF NOT EXISTS `recordCount` int;--> statement-breakpoint
ALTER TABLE `espn_view_health` ADD COLUMN IF NOT EXISTS `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
DELETE vh_old FROM `espn_view_health` vh_old
INNER JOIN `espn_view_health` vh_new
  ON vh_old.`season` = vh_new.`season`
  AND vh_old.`viewName` = vh_new.`viewName`
  AND vh_old.`id` < vh_new.`id`;--> statement-breakpoint
ALTER TABLE `espn_view_health` DROP INDEX `idx_view_health_season_view`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_view_health_season_view` ON `espn_view_health` (`season`,`viewName`);
