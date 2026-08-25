CREATE TABLE `chat_drafts` (
	`userId` int NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_drafts_userId_sessionId_pk` PRIMARY KEY(`userId`,`sessionId`)
);
--> statement-breakpoint
CREATE TABLE `provider_control_flags` (
	`targetKey` varchar(220) NOT NULL,
	`targetType` enum('provider','model') NOT NULL,
	`disabled` int NOT NULL DEFAULT 0,
	`preference` enum('normal','prefer','avoid') NOT NULL DEFAULT 'normal',
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `provider_control_flags_targetKey` PRIMARY KEY(`targetKey`)
);
--> statement-breakpoint
CREATE TABLE `technical_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('provider','fallback','search','owner_flag','attachment') NOT NULL,
	`title` varchar(220) NOT NULL,
	`code` varchar(48),
	`roleId` varchar(24),
	`actorUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `technical_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chat_drafts` ADD CONSTRAINT `chat_drafts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_drafts` ADD CONSTRAINT `chat_drafts_sessionId_chat_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `provider_control_flags` ADD CONSTRAINT `provider_control_flags_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `technical_events` ADD CONSTRAINT `technical_events_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `chat_drafts_session_updated_idx` ON `chat_drafts` (`sessionId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `provider_control_flags_updated_idx` ON `provider_control_flags` (`updatedAt`);--> statement-breakpoint
CREATE INDEX `technical_events_created_idx` ON `technical_events` (`createdAt`);