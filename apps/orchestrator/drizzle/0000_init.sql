CREATE TABLE `depositors` (
	`wallet` text PRIMARY KEY NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deposits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`depositor_wallet` text NOT NULL,
	`amount_usdc` real NOT NULL,
	`tx_signature` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`block_time` integer,
	`slot` integer,
	FOREIGN KEY (`depositor_wallet`) REFERENCES `depositors`(`wallet`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deposits_tx_signature_unique` ON `deposits` (`tx_signature`);--> statement-breakpoint
CREATE TABLE `hedges` (
	`position_pubkey` text PRIMARY KEY NOT NULL,
	`market_id` text NOT NULL,
	`event_id` text,
	`market_title` text,
	`event_title` text,
	`side` text NOT NULL,
	`contracts` integer NOT NULL,
	`cost_basis_usd` real NOT NULL,
	`fees_paid_usd` real,
	`opened_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`closed_at` integer,
	`resolved_outcome` text,
	`payout_usd` real,
	`open_signature` text
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`status` integer NOT NULL,
	`ok` integer NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `withdrawals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`depositor_wallet` text NOT NULL,
	`amount_usdc` real NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`settled_at` integer,
	`tx_signature` text,
	`error_message` text,
	FOREIGN KEY (`depositor_wallet`) REFERENCES `depositors`(`wallet`) ON UPDATE no action ON DELETE no action
);
