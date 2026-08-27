CREATE TABLE `capacity_inflight_counters` (
	`scopeKey` varchar(220) NOT NULL,
	`activeCount` int NOT NULL DEFAULT 0,
	`activeWcu` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `capacity_inflight_counters_scopeKey` PRIMARY KEY(`scopeKey`)
);
--> statement-breakpoint
ALTER TABLE `capacity_controller_settings` ADD `globalGenerationConcurrency` int;--> statement-breakpoint
ALTER TABLE `capacity_controller_settings` ADD `globalSearchConcurrency` int;--> statement-breakpoint
ALTER TABLE `capacity_controller_settings` ADD `globalGenerationInflightWcuLimit` int;--> statement-breakpoint
ALTER TABLE `capacity_controller_settings` ADD `degradationMode` enum('normal','elevated','high','critical','exhausted') DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `capacity_controller_settings` ADD `queueEligibleRolesJson` text;--> statement-breakpoint
UPDATE `capacity_controller_settings` SET `queueEligibleRolesJson` = '["fast"]' WHERE `queueEligibleRolesJson` IS NULL;--> statement-breakpoint
ALTER TABLE `capacity_controller_settings` MODIFY COLUMN `queueEligibleRolesJson` varchar(64) NOT NULL DEFAULT '["fast"]';--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `dailyRequestLimit` int;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `dailyTokenLimit` int;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `cooldownState` enum('unknown','inherit_provider_health','cooldown') DEFAULT 'inherit_provider_health' NOT NULL;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `roleEligibilityJson` text;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `searchEligibility` enum('unknown','eligible','not_eligible') DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `billingSafe` int;--> statement-breakpoint
ALTER TABLE `capacity_reservations` ADD `inflightScopeKeysJson` text;--> statement-breakpoint
UPDATE `capacity_reservations` SET `inflightScopeKeysJson` = '[]' WHERE `inflightScopeKeysJson` IS NULL;--> statement-breakpoint
ALTER TABLE `capacity_reservations` MODIFY COLUMN `inflightScopeKeysJson` text NOT NULL;
