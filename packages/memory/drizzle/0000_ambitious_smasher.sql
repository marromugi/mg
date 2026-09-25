CREATE TABLE `items` (
	`persona_id` text NOT NULL,
	`id` text NOT NULL,
	`counterpart` text NOT NULL,
	`text` text NOT NULL,
	`created_at` real NOT NULL,
	`misses` integer NOT NULL,
	`seq` integer NOT NULL,
	PRIMARY KEY(`persona_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_text` text NOT NULL,
	`persona_version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `summaries` (
	`persona_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`text` text NOT NULL,
	`version` integer NOT NULL,
	PRIMARY KEY(`persona_id`, `conversation_id`)
);
