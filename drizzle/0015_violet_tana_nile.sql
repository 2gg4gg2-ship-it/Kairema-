CREATE TABLE `search_outage_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`layer` enum('google','tavily','openrouter') NOT NULL,
	`errorClass` varchar(32) NOT NULL,
	`latencyMs` int NOT NULL,
	`fellBack` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `search_outage_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `search_outage_logs_created_idx` ON `search_outage_logs` (`createdAt`);