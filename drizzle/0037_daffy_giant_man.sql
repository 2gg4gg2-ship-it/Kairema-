ALTER TABLE `capacity_provider_budgets` ADD `maxConcurrent` int;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `rpmLimit` int;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `tpmLimit` int;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `dailyUnitsLimit` int;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `resetWindow` varchar(96);--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `eligibilityState` enum('unknown','eligible','not_eligible','paid_required') DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `capacity_provider_budgets` ADD `billingState` enum('unknown','free','paid','not_configured') DEFAULT 'unknown' NOT NULL;