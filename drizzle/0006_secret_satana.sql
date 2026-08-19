CREATE TABLE `role_runtime_status` (
	`roleId` enum('fast','smart','context','flagship') NOT NULL,
	`state` enum('ready','backup','unavailable') NOT NULL,
	`provider` varchar(32),
	`modelUsed` varchar(160),
	`checkedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `role_runtime_status_roleId` PRIMARY KEY(`roleId`)
);
