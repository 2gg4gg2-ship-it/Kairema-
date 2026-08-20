CREATE TABLE `provider_health_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(32) NOT NULL,
	`state` enum('ready','cooldown','auth_failed','unavailable','not_configured') NOT NULL,
	`category` varchar(32),
	`http` int,
	`checkedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `provider_health_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `provider_health_history_provider_checked_idx` ON `provider_health_history` (`provider`,`checkedAt`);