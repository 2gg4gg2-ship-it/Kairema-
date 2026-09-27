CREATE TABLE IF NOT EXISTS `user_provider_configs` (
	`id` int NOT NULL AUTO_INCREMENT,
	`userId` int NOT NULL,
	`provider` varchar(32) NOT NULL,
	`activeModel` varchar(191) NOT NULL,
	`encryptedApiKey` text NOT NULL,
	`keyHint` varchar(16) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_provider_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_provider_configs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action,
	UNIQUE INDEX `user_provider_configs_user_provider_unique` (`userId`,`provider`),
	INDEX `user_provider_configs_user_idx` (`userId`)
);
--> statement-breakpoint
ALTER TABLE `user_settings` ADD COLUMN `myApiProvider` varchar(32);
