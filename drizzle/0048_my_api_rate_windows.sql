-- Per-user fixed-minute quota state for My API (BYOK) ingress.
--
-- Kept apart from `chat_stream_rate_windows` on purpose: that table already counts every ordinary
-- chat-stream request for the same user, so a shared row would let one My API turn consume the
-- ordinary-chat budget and vice versa, and neither limit would hold on its own.
CREATE TABLE `my_api_rate_windows` (
	`userId` int NOT NULL,
	`windowStarted` timestamp NOT NULL DEFAULT now(),
	`requestCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT now() ON UPDATE now(),
	PRIMARY KEY(`userId`),
	CONSTRAINT `my_api_rate_windows_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade
);
