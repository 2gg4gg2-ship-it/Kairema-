CREATE TABLE `chat_attachments` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`contentType` varchar(128) NOT NULL,
	`byteSize` int NOT NULL,
	`kind` enum('image','document') NOT NULL,
	`processingStatus` enum('ready','unsupported','failed') NOT NULL DEFAULT 'ready',
	`extractedText` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memory_facts` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`fact` varchar(280) NOT NULL,
	`sourceMessageId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memory_facts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memory_profiles` (
	`userId` int NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`autoExtract` int NOT NULL DEFAULT 1,
	`profile` text NOT NULL,
	`summary` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memory_profiles_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`userId` int NOT NULL,
	`language` enum('ru','en') NOT NULL DEFAULT 'ru',
	`theme` enum('light','dark') NOT NULL DEFAULT 'dark',
	`responseStyle` enum('default','professional','friendly','concise','steps') NOT NULL DEFAULT 'default',
	`responseLength` enum('brief','balanced','detailed') NOT NULL DEFAULT 'balanced',
	`quickReplies` int NOT NULL DEFAULT 1,
	`effort` enum('low','standard','high') NOT NULL DEFAULT 'standard',
	`thinking` int NOT NULL DEFAULT 0,
	`defaultRole` enum('fast','smart','context','flagship') NOT NULL DEFAULT 'fast',
	`webSearch` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_settings_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `metadata` text;--> statement-breakpoint
ALTER TABLE `chat_attachments` ADD CONSTRAINT `chat_attachments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_attachments` ADD CONSTRAINT `chat_attachments_sessionId_chat_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_facts` ADD CONSTRAINT `memory_facts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_facts` ADD CONSTRAINT `memory_facts_sourceMessageId_messages_id_fk` FOREIGN KEY (`sourceMessageId`) REFERENCES `messages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_profiles` ADD CONSTRAINT `memory_profiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_settings` ADD CONSTRAINT `user_settings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `chat_attachments_user_session_idx` ON `chat_attachments` (`userId`,`sessionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `memory_facts_user_updated_idx` ON `memory_facts` (`userId`,`updatedAt`);