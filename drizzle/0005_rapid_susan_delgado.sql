CREATE TABLE `web_search_status` (
	`key` varchar(32) NOT NULL,
	`state` enum('ready','unavailable','unknown') NOT NULL,
	`reason` varchar(255) NOT NULL,
	`googleHttp` int,
	`openrouterHttp` int,
	`checkedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `web_search_status_key` PRIMARY KEY(`key`)
);
