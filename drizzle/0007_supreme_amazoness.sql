CREATE TABLE `knowledge_documents` (
	`id` varchar(36) NOT NULL,
	`sourceId` varchar(32) NOT NULL,
	`sourceUrl` varchar(512) NOT NULL,
	`title` varchar(512) NOT NULL,
	`excerpt` text NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`publishedAt` timestamp,
	`retrievedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_documents_url_unique` UNIQUE(`sourceUrl`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_ingestion_runs` (
	`id` varchar(36) NOT NULL,
	`sourceId` varchar(32),
	`trigger` enum('manual','scheduled','startup') NOT NULL,
	`state` enum('success','partial','failed') NOT NULL,
	`fetchedCount` int NOT NULL DEFAULT 0,
	`indexedCount` int NOT NULL DEFAULT 0,
	`updatedCount` int NOT NULL DEFAULT 0,
	`error` varchar(255),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	CONSTRAINT `knowledge_ingestion_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_sources` (
	`id` varchar(32) NOT NULL,
	`displayName` varchar(120) NOT NULL,
	`feedUrl` varchar(512) NOT NULL,
	`state` enum('ready','unavailable','unknown') NOT NULL DEFAULT 'unknown',
	`lastFetchedAt` timestamp,
	`lastSuccessAt` timestamp,
	`lastError` varchar(255),
	`indexedCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD CONSTRAINT `knowledge_documents_sourceId_knowledge_sources_id_fk` FOREIGN KEY (`sourceId`) REFERENCES `knowledge_sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `knowledge_ingestion_runs` ADD CONSTRAINT `knowledge_ingestion_runs_sourceId_knowledge_sources_id_fk` FOREIGN KEY (`sourceId`) REFERENCES `knowledge_sources`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `knowledge_documents_source_published_idx` ON `knowledge_documents` (`sourceId`,`publishedAt`);--> statement-breakpoint
CREATE INDEX `knowledge_documents_fingerprint_idx` ON `knowledge_documents` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `knowledge_ingestion_runs_started_idx` ON `knowledge_ingestion_runs` (`startedAt`);