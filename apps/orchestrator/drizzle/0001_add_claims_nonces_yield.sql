CREATE TABLE `claim_distributions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position_pubkey` text NOT NULL,
	`depositor_wallet` text NOT NULL,
	`share_fraction` real NOT NULL,
	`amount_usd` real NOT NULL,
	`claim_signature` text NOT NULL,
	`distributed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`depositor_wallet`) REFERENCES `depositors`(`wallet`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`consumed_at` integer,
	`purpose` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `yield_withdrawals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`amount_usdc` real NOT NULL,
	`tx_signature` text NOT NULL,
	`rebalance_started_at` integer NOT NULL,
	`performed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
