CREATE TABLE `dev_api_audit_records` (
	`id` varchar(36) NOT NULL,
	`userId` int,
	`outcome` enum('allowed','denied','invalid','rate_limited','provider_error') NOT NULL,
	`status` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_api_audit_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_api_rate_windows` (
	`userId` int NOT NULL,
	`windowStarted` timestamp NOT NULL DEFAULT (now()),
	`requestCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_api_rate_windows_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `dev_api_audit_records` ADD CONSTRAINT `dev_api_audit_records_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dev_api_rate_windows` ADD CONSTRAINT `dev_api_rate_windows_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dev_api_audit_user_created_idx` ON `dev_api_audit_records` (`userId`,`createdAt`);