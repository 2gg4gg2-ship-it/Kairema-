CREATE TABLE `provider_daily_usage` (
	`provider` varchar(32) NOT NULL,
	`dayKey` varchar(10) NOT NULL,
	`successCount` int NOT NULL DEFAULT 0,
	CONSTRAINT `provider_daily_usage_provider_dayKey_pk` PRIMARY KEY(`provider`,`dayKey`)
);
