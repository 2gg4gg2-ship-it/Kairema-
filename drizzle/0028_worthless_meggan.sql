CREATE TABLE `memory_entries` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`category` enum('profile','fact','dialog_topic') NOT NULL,
	`value` varchar(500) NOT NULL,
	`memoryKey` varchar(160),
	`role` enum('fast','smart','context','flagship'),
	`source` enum('manual','auto') NOT NULL DEFAULT 'manual',
	`sourceMessageId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memory_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memory_settings` (
	`userId` int NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`autoExtract` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memory_settings_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `memory_entries` ADD CONSTRAINT `memory_entries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_entries` ADD CONSTRAINT `memory_entries_sourceMessageId_messages_id_fk` FOREIGN KEY (`sourceMessageId`) REFERENCES `messages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_settings` ADD CONSTRAINT `memory_settings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `memory_entries_user_category_created_idx` ON `memory_entries` (`userId`,`category`,`createdAt`);--> statement-breakpoint
CREATE INDEX `memory_entries_user_category_updated_idx` ON `memory_entries` (`userId`,`category`,`updatedAt`);--> statement-breakpoint
INSERT INTO `memory_settings` (`userId`, `enabled`, `autoExtract`)
SELECT `userId`, `enabled`, `autoExtract` FROM `memory_profiles`
ON DUPLICATE KEY UPDATE `enabled` = VALUES(`enabled`), `autoExtract` = VALUES(`autoExtract`);--> statement-breakpoint
INSERT INTO `memory_entries` (`id`, `userId`, `category`, `value`, `memoryKey`, `role`, `source`, `sourceMessageId`, `createdAt`, `updatedAt`)
SELECT `id`, `userId`, 'fact', `fact`, NULL, NULL, `source`, `sourceMessageId`, `createdAt`, `updatedAt`
FROM `memory_facts`;
