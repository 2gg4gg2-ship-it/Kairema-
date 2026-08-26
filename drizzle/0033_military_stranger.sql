CREATE TABLE `provider_identities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(64) NOT NULL,
	`providerSubject` varchar(128) NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `provider_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_identities_provider_subject_unique` UNIQUE(`provider`,`providerSubject`)
);
--> statement-breakpoint
ALTER TABLE `provider_identities` ADD CONSTRAINT `provider_identities_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `provider_identities_user_idx` ON `provider_identities` (`userId`);