CREATE TABLE `chat_stream_rate_windows` (
	`userId` int NOT NULL,
	`windowStarted` timestamp NOT NULL DEFAULT (now()),
	`requestCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_stream_rate_windows_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `chat_stream_rate_windows` ADD CONSTRAINT `chat_stream_rate_windows_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;