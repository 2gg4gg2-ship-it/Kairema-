CREATE TABLE `capacity_budget_windows` (
	`scopeKey` varchar(220) NOT NULL,
	`windowStarted` timestamp NOT NULL DEFAULT (now()),
	`usedWcu` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `capacity_budget_windows_scopeKey` PRIMARY KEY(`scopeKey`)
);
--> statement-breakpoint
CREATE TABLE `capacity_controller_settings` (
	`id` int NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`globalGenerationWcuLimit` int,
	`globalSearchWcuLimit` int,
	`perUserGenerationWcuLimit` int NOT NULL DEFAULT 12,
	`perUserSearchWcuLimit` int NOT NULL DEFAULT 6,
	`perUserGenerationConcurrency` int NOT NULL DEFAULT 2,
	`perUserSearchConcurrency` int NOT NULL DEFAULT 1,
	`apexPressureReservePercent` int NOT NULL DEFAULT 20,
	`roleWeightsJson` text NOT NULL,
	`modifierWeightsJson` text NOT NULL,
	`queueMaxWaitMs` int NOT NULL DEFAULT 0,
	`queueMaxDepth` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `capacity_controller_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `capacity_provider_budgets` (
	`scopeKey` varchar(220) NOT NULL,
	`provider` varchar(48) NOT NULL,
	`modelId` varchar(160),
	`enabled` int NOT NULL DEFAULT 1,
	`generationWcuLimit` int,
	`quotaState` enum('unknown','operator_configured') NOT NULL DEFAULT 'unknown',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `capacity_provider_budgets_scopeKey` PRIMARY KEY(`scopeKey`)
);
--> statement-breakpoint
CREATE TABLE `capacity_reservations` (
	`id` varchar(36) NOT NULL,
	`requestKey` varchar(180) NOT NULL,
	`userId` int,
	`kind` enum('generation','search') NOT NULL,
	`roleId` enum('fast','smart','context','flagship'),
	`provider` varchar(48),
	`modelId` varchar(160),
	`wcu` int NOT NULL,
	`scopeKeysJson` text NOT NULL,
	`state` enum('reserved','settled','released') NOT NULL DEFAULT 'reserved',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`finalizedAt` timestamp,
	CONSTRAINT `capacity_reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `capacity_reservations_requestKey_unique` UNIQUE(`requestKey`)
);
--> statement-breakpoint
ALTER TABLE `capacity_reservations` ADD CONSTRAINT `capacity_reservations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `capacity_provider_budgets_provider_idx` ON `capacity_provider_budgets` (`provider`);--> statement-breakpoint
CREATE INDEX `capacity_reservations_created_idx` ON `capacity_reservations` (`createdAt`);--> statement-breakpoint
CREATE INDEX `capacity_reservations_user_created_idx` ON `capacity_reservations` (`userId`,`createdAt`);