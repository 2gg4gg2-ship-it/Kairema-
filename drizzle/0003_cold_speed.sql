CREATE TABLE `provider_health` (
	`provider` varchar(32) NOT NULL,
	`state` enum('ready','cooldown','auth_failed','unavailable','not_configured') NOT NULL,
	`category` varchar(32),
	`http` int,
	`confirmed` text NOT NULL,
	`checkedAt` timestamp NOT NULL DEFAULT (now()),
	`blockedUntil` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `provider_health_provider` PRIMARY KEY(`provider`)
);
