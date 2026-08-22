CREATE TABLE `memory_extraction_jobs` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`userMessageId` int NOT NULL,
	`assistantMessageId` int NOT NULL,
	`role` enum('fast','smart','context','flagship') NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`runAfter` timestamp NOT NULL DEFAULT (now()),
	`lastErrorClass` varchar(64),
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memory_extraction_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `memory_extraction_jobs_assistantMessageId_unique` UNIQUE(`assistantMessageId`)
);
--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `sessionId` varchar(36);--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `lastSeenAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_extraction_jobs` ADD CONSTRAINT `memory_extraction_jobs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_extraction_jobs` ADD CONSTRAINT `memory_extraction_jobs_sessionId_chat_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_extraction_jobs` ADD CONSTRAINT `memory_extraction_jobs_userMessageId_messages_id_fk` FOREIGN KEY (`userMessageId`) REFERENCES `messages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_extraction_jobs` ADD CONSTRAINT `memory_extraction_jobs_assistantMessageId_messages_id_fk` FOREIGN KEY (`assistantMessageId`) REFERENCES `messages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `memory_jobs_user_status_due_idx` ON `memory_extraction_jobs` (`userId`,`status`,`runAfter`);--> statement-breakpoint
CREATE INDEX `memory_jobs_session_created_idx` ON `memory_extraction_jobs` (`sessionId`,`createdAt`);--> statement-breakpoint
ALTER TABLE `memory_entries` ADD CONSTRAINT `memory_entries_sessionId_chat_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `memory_entries_user_category_seen_idx` ON `memory_entries` (`userId`,`category`,`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `memory_entries_topic_session_seen_idx` ON `memory_entries` (`userId`,`sessionId`,`lastSeenAt`);