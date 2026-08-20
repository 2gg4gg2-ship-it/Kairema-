CREATE TABLE `flash_ttft_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`durationMs` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `flash_ttft_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `flash_ttft_metrics_created_idx` ON `flash_ttft_metrics` (`createdAt`);