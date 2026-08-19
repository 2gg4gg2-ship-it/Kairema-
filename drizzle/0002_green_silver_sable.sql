CREATE TABLE `chat_exports` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`format` enum('markdown','pdf') NOT NULL,
	`contentType` varchar(128) NOT NULL,
	`byteSize` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_exports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chat_exports` ADD CONSTRAINT `chat_exports_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_exports` ADD CONSTRAINT `chat_exports_sessionId_chat_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `chat_exports_user_created_idx` ON `chat_exports` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `chat_exports_session_created_idx` ON `chat_exports` (`sessionId`,`createdAt`);