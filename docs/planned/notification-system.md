# Notification & Data Management System

Overhaul of how the game surfaces information to players — replacing the current toast-based notification system with a structured three-tier approach: real-time notification feed, persistent captain's log, and filterable active/entity list screens.

**Replaces**: Current `EventToastContainer` (auto-dismiss toasts), `ActivityPanel` (modal dialog with Economy/Missions/Ship Log tabs), and inline event history ring buffer.

**Depends on**: [map-centric-ui.md](./map-centric-ui.md) (notification feed location depends on final shell layout)

---

## 1. Data Categories

All player-facing information falls into one of three categories, each with a distinct UX pattern:

| Category | Examples | Lifecycle | UX Pattern |
|---|---|---|---|
| **Notifications** | Ship arrived, mission complete, battle resolved | Ephemeral — created on event, read once, auto-pruned | Feed with unread indicator |
| **Activity Log** | All notification types, persisted | Persistent — last N entries, survives sessions | Dedicated log screen with filters |
| **Active/Entity Lists** | Events, missions, ships, convoys, battles | Live — exist while entity exists | Filterable list screens |

---

## 2. Notification Feed

**Purpose**: Alert the player to things that just happened and are personally relevant.

### What generates notifications

Only events the player has a direct stake in:

| Notification Type | Trigger | Priority |
|---|---|---|
| `ship_arrived` | Ship/convoy completes a hop | Normal |
| `mission_complete` | Trade or operational mission delivered/resolved | High |
| `mission_expired` | Accepted mission deadline passed | High |
| `battle_resolved` | Combat encounter concludes | High |
| `cargo_lost` | Hazard or piracy causes cargo loss | Normal |
| `hazard_incident` | Ship encounters navigation danger | Normal |
| `import_duty` | Duty charged on arrival | Low |
| `contraband_seized` | Contraband confiscated on arrival | Normal |

**Not included**: Game events (solar flare, trade boom, etc.) — these are too frequent and often irrelevant to the player's current activity. Events have their own dedicated screen.

### UI: Bell indicator + dropdown feed

- **Location**: Sidebar header area or top bar — bell icon with unread count badge
- **Interaction**: Click bell → dropdown/popover showing recent notifications, newest first
- **Unread tracking**: Notifications created since last feed open are "unread" (bold/highlighted)
- **Max visible**: ~20 most recent in the dropdown, with "View full log" link to captain's log
- **Auto-dismiss**: No auto-dismiss — notifications persist in the feed until the player opens it (then marked as read)
- **Notification anatomy**:
  - Left: colored indicator by type (reuse existing `NOTIFICATION_BADGE_COLOR` palette)
  - Center: message text with inline entity links (system/ship names as clickable refs)
  - Right: relative timestamp
- **Sound/visual pulse**: Optional subtle pulse on the bell icon when new notifications arrive (no intrusive animation)

### Data model

Notifications are stored in a client-side ring buffer (current `EventHistoryProvider` pattern) for the feed, and persisted server-side for the captain's log.

Server-side model (new `PlayerNotification` table):

| Field | Type | Description |
|---|---|---|
| `id` | String | CUID |
| `playerId` | String | FK to Player |
| `type` | String | Notification type enum |
| `message` | String | Human-readable message |
| `refs` | JSON | Entity references `{ systemId?, shipId?, missionId?, battleId? }` |
| `tick` | Int | Game tick when created |
| `read` | Boolean | Whether player has seen it (default false) |
| `createdAt` | DateTime | Wall-clock timestamp |

Index on `(playerId, createdAt)` for log queries. Auto-prune entries older than N ticks (configurable, e.g. 500 ticks).

---

## 3. Captain's Log

**Purpose**: Persistent record of significant events for catch-up after being offline, or reviewing past activity.

### Content

Same notification types as the feed, but persisted server-side. When a player returns after being offline, the log contains everything that happened to their assets.

### UI: Dedicated screen (panel/page)

- **Access**: Sidebar nav item (log/journal icon)
- **Layout**: Reverse-chronological list of log entries
- **Filter bar**: Chip toggles by category:
  - All | Trade | Combat | Fleet | Missions
- **Session divider**: Visual separator or heading showing "Since your last session" — marks the boundary between current session entries and older ones. Determined by comparing entry timestamps against the player's last login.
- **Entry anatomy**: Same as notification (colored indicator, message, entity links, timestamp) but with tick number displayed
- **Scroll**: Virtual scroll or "load more" pattern — initial load of ~50 entries, load more on scroll

### API

- `GET /api/game/log` — paginated, filterable by type, returns `PlayerNotification[]`
- Query params: `?type=trade,combat&cursor=<lastId>&limit=50`
- Mark-as-read happens implicitly when the feed is opened (batch update)

---

## 4. Active & Entity List Screens

**Purpose**: Browse and manage current game state — active events, missions, ships, convoys.

### Shared filterable list pattern

All list screens share a consistent interaction model:

**Filter bar component** (reusable across all lists):
- **Category chips**: Toggle filters by type/status (e.g. event type, ship status)
- **Search**: Text input for name/keyword matching (ships by name, systems by name)
- **Sort**: Dropdown for sort order (by name, date, distance, deadline, etc.)
- **Result count**: "Showing X of Y" indicator

**List body**:
- Virtual scroll or "show more" — no traditional pagination
- Sensible default limit: 30 items visible, "Show more" loads next batch
- Empty state messaging when filters exclude all items

### Per-screen specifics

**Events screen**:
- Default filter: events in systems where the player has ships (relevant events)
- Available filters: event type, severity/danger level, region
- Sort: by severity (default), by ticks remaining, by system name
- "Show all events" toggle to see universe-wide events
- Entry: event name, type icon, system link, phase badge, ticks remaining, affected goods summary

**Missions screen**:
- Two sections: "Active" (accepted by player) and "Available" (not yet accepted, in reachable systems)
- Available filters: mission type (trade/patrol/survey/bounty), deadline urgency, reward range
- Sort: by deadline (default), by reward, by distance
- Entry: mission type icon, description, source → destination, reward, deadline countdown

**Ships screen** (fleet):
- Default grouping: by status (docked, in transit, in combat)
- Collapsible status groups
- Available filters: ship class, location (system), status
- Search: by ship name
- Sort: by name (default), by class, by location
- Entry: ship name, class, status badge, location/destination, cargo summary

**Convoys screen**:
- Same pattern as ships — grouped by status, filterable, searchable
- Entry: convoy name, ship count, status, location/route

**Battles screen**:
- Active battles only (resolved battles go to captain's log)
- Sort: by tick started
- Entry: battle type, location, participating ships, tick count

---

## 5. Migration from Current System

### What gets removed
- `EventToastContainer` — replaced by notification feed
- `ActivityPanel` (the three-tab modal dialog) — split into:
  - Economy tab → Events screen
  - Missions tab → Missions screen
  - Ship Log tab → Captain's Log
- Client-only ring buffer in `EventHistoryProvider` — replaced by server-persisted `PlayerNotification`

### What gets preserved
- SSE notification pipeline (`useTickContext` → `eventNotifications` / `gameNotifications`) — still the transport layer, now writes to both client feed and server log
- `NOTIFICATION_BADGE_COLOR` palette — reused in all three tiers
- `NotificationEntityLinks` component — reused for inline entity references
- Event type icons (`event-icon.tsx`) — reused in events screen

### What's new
- `PlayerNotification` Prisma model + auto-prune tick processor
- `GET /api/game/log` endpoint (paginated, filterable)
- Notification feed component (bell + dropdown)
- Captain's Log page/panel
- Shared `FilterBar` component
- Per-screen filter/sort configurations
- Virtual scroll or "show more" list component

---

## 6. Implementation Sequence

1. **Schema + service**: `PlayerNotification` model, notification service (create, query, prune), log API endpoint
2. **Notification feed**: Bell indicator component, dropdown feed, wire to SSE pipeline
3. **Captain's Log**: Log screen with filter bar, cursor-based pagination, session divider
4. **FilterBar component**: Extract shared filter/search/sort pattern
5. **Events screen**: Rebuild with FilterBar, remove from ActivityPanel
6. **Missions screen**: Rebuild with FilterBar, remove from ActivityPanel
7. **Fleet/Convoys**: Add FilterBar + search to existing screens
8. **Cleanup**: Remove ActivityPanel, EventToastContainer, client-only ring buffer
