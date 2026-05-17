DROP TABLE `adp_trend_snapshots`;--> statement-breakpoint
DROP TABLE `champ_equity_predictions`;--> statement-breakpoint
DROP TABLE `chat_history`;--> statement-breakpoint
DROP TABLE `espn_season_cache`;--> statement-breakpoint
DROP TABLE `espn_view_health`;--> statement-breakpoint
DROP TABLE `fantasy_data_cache`;--> statement-breakpoint
DROP TABLE `fear_index`;--> statement-breakpoint
DROP TABLE `funnel_events`;--> statement-breakpoint
DROP TABLE `gm_decision_tags`;--> statement-breakpoint
DROP TABLE `gm_decisions`;--> statement-breakpoint
DROP TABLE `league_connections`;--> statement-breakpoint
DROP TABLE `league_events`;--> statement-breakpoint
DROP TABLE `league_identity`;--> statement-breakpoint
DROP TABLE `llm_usage`;--> statement-breakpoint
DROP TABLE `mock_draft_results`;--> statement-breakpoint
DROP TABLE `monte_carlo_calibration`;--> statement-breakpoint
DROP TABLE `onboarding_state`;--> statement-breakpoint
DROP TABLE `pick_trades`;--> statement-breakpoint
DROP TABLE `player_news_signals`;--> statement-breakpoint
DROP TABLE `refresh_manifest`;--> statement-breakpoint
DROP TABLE `reputation_events`;--> statement-breakpoint
DROP TABLE `rivalry_scores`;--> statement-breakpoint
DROP TABLE `scheduled_jobs`;--> statement-breakpoint
DROP TABLE `scraped_trades`;--> statement-breakpoint
DROP TABLE `start_sit_decisions`;--> statement-breakpoint
DROP TABLE `trade_decisions`;--> statement-breakpoint
DROP TABLE `trade_narratives`;--> statement-breakpoint
DROP TABLE `usage_events`;--> statement-breakpoint
DROP TABLE `user_memory`;--> statement-breakpoint
DROP TABLE `weekly_player_stats`;--> statement-breakpoint
DROP TABLE `weekly_storylines`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `activeLeagueId`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `stripeCustomerId`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `stripeSubscriptionId`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `subscriptionStatus`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `trialStartedAt`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `currentPeriodEnd`;