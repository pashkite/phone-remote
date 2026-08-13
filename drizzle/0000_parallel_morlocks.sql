CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`platform` text DEFAULT 'android' NOT NULL,
	`app_version` text DEFAULT '1.0.0' NOT NULL,
	`token_hash` text NOT NULL,
	`battery_level` integer,
	`screen_width` integer,
	`screen_height` integer,
	`last_seen_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `devices_owner_idx` ON `devices` (`owner_email`);--> statement-breakpoint
CREATE INDEX `devices_last_seen_idx` ON `devices` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `pairing_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pairing_codes_owner_idx` ON `pairing_codes` (`owner_email`);--> statement-breakpoint
CREATE INDEX `pairing_codes_expires_idx` ON `pairing_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `remote_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`device_id` text NOT NULL,
	`state` text NOT NULL,
	`offer_type` text,
	`offer_sdp` text,
	`answer_type` text,
	`answer_sdp` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `remote_sessions_owner_idx` ON `remote_sessions` (`owner_email`);--> statement-breakpoint
CREATE INDEX `remote_sessions_device_state_idx` ON `remote_sessions` (`device_id`,`state`);--> statement-breakpoint
CREATE INDEX `remote_sessions_expires_idx` ON `remote_sessions` (`expires_at`);