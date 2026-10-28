CREATE TABLE `replies` (
	`cursor` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`input_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`reason` text
);
