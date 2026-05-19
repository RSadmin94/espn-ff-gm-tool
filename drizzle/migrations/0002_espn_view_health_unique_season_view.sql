ALTER TABLE `espn_view_health` ADD CONSTRAINT `uq_season_view` UNIQUE (`season`, `viewName`);
