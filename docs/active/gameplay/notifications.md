# Notifications & Captain's Log

How the game tells a player about things that happened to *their* assets. Two surfaces, one backing store: a notification bell (recent, unread-aware) and the Captain's Log (full searchable history). Both read from per-player notifications persisted server-side, so a player who was offline sees everything that happened while they were away.

## What notifies the player

Notifications are only created for events the player has a direct stake in — never for ambient game events (solar flares, trade booms). Those have their own [Events screen](./events.md).

| Type | Triggered when |
|---|---|
| `ship_arrived` | A ship or convoy completes a hop |
| `ship_damaged` / `ship_disabled` | A ship takes hull damage or is knocked out |
| `cargo_lost` | Cargo is lost to a hazard or piracy |
| `hazard_incident` | A ship hits a navigation danger |
| `battle_round` / `battle_won` / `battle_lost` | A combat round resolves / a battle concludes |
| `mission_completed` / `mission_expired` | An accepted mission is delivered, or its deadline passes |
| `import_duty` | A duty is charged on arrival |
| `contraband_seized` | Contraband is confiscated on arrival |

Each notification carries a short message, a game-`tick`, a wall-clock timestamp, and entity `refs` (e.g. the system or ship involved) that render as clickable inline links.

## The bell + unread model

A bell icon in the sidebar shows an unread-count badge. Clicking it opens a popover with the most recent notifications, newest first, plus a link into the full Captain's Log. "Mark all read" clears the unread state up through the newest entry. Unread count and the recent list are fetched live and refresh as new notifications arrive.

Unread state is server-side: a notification is `read: false` until the player marks it. Marking-as-read accepts an optional cutoff so "mark all up to here" is a single batched update.

## Captain's Log

A dedicated panel (`/log`) showing the full reverse-chronological history. It uses the shared FilterBar with category chips (All / Trade / Combat / Fleet / Missions — each mapping to a set of notification types) and a free-text search over message contents. Results load in pages of 30 with a "load more" footer, and show an "X of Y" count. This panel is the first consumer of the shared server-side pagination infra (its expansion doc is deleted with the grand-strategy pivot — multiplayer-scale API concern).

## Pruning

A tick processor (`notification-prune`, runs every 50 ticks) deletes any notification older than `MAX_AGE_TICKS` (currently 500 ticks) so the table stays bounded. The log is a rolling window, not a permanent archive.

## Notes

- [PENDING: priority tiers / toast surfacing] The original design called for low/normal/high priority notifications with optional transient toasts for high-priority items. The current system has no priority field and no toasts — everything flows through the bell and log equally.
- [PENDING: session divider] A "since your last session" divider in the log was designed but is not yet implemented.
