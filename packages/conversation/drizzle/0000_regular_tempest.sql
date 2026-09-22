CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`conversation_id` text NOT NULL,
	`position` integer NOT NULL,
	`messages` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `position`)
);
