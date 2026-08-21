CREATE TABLE `search_quality_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`outcome` enum('found','empty','degraded','error') NOT NULL,
	`verification` enum('verified','no_results','degraded','unavailable') NOT NULL,
	`verifiedSourceCount` int NOT NULL,
	`attemptedLayerCount` int NOT NULL,
	`latencyMs` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `search_quality_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `search_quality_metrics_created_idx` ON `search_quality_metrics` (`createdAt`);