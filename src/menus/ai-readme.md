# Menus — AI integration guide

## Responsibility

`src/menus` owns the application-level navigation and shared room experience:
- `MainMenu`: entry points for solo and multiplayer play;
- `SoloRoomMenu`: solo game selection and start callback;
- `MultiplayerRoomMenu`: shared multiplayer room lifecycle and UI.

The menus layer coordinates the public Multiplayer Core API. It owns room creation and joining, invite deep links, game selection, common readiness, host-only match start requests, room session/Realtime, player roster, room wins and match counts, and return navigation.

Game modules own only their game-specific match state and gameplay. Multiplayer match components are mounted with an existing `MultiplayerRoom`; they receive the room and callbacks to publish room snapshots, handle a host start request, acknowledge that request, and return to the room. Do not add generic room lifecycle operations to game screens.

## Public components

- `MainMenu({ onSolo, onMultiplayer })`
- `SoloRoomMenu({ onBack, onStart })`
- `MultiplayerRoomMenu({ initData, inviteCode?, onBack })`

`MultiplayerRoomMenu` creates a room with a maximum of four participants, accepts an optional invite code, and uses `createMultiplayerRoomSession` for heartbeat and private Realtime updates. Room snapshots remain canonical. The host is automatically marked ready when the room is created or returns to `finished`, because the agreed UI does not show the host a Ready button while the server start contract requires all players to be ready.

The Start button is shown only to the host. It is enabled only when a game is selected, there are 2–4 participants and all participants are ready. Other participants can toggle their own readiness. These checks are UI guidance; the trusted backend must enforce permissions and lifecycle rules.

The room roster displays common `wins` and `matchesPlayed` fields. Game-specific match scores are not used for the common room score.

## Telegram invitations

The universal invite parameter uses `fb_<inviteCode>`. Legacy `rr_<inviteCode>` and `bb_<inviteCode>` values are still parsed by the application so old invite links continue to enter the common room flow.

The Mini App uses Telegram's `t.me/share/url` share sheet. Telegram does not return the selected recipient list to the Mini App, so the UI must not claim to know how many contacts were selected. Actual participant count comes from the room snapshot. The bot username and Mini App short name can be configured through `VITE_TELEGRAM_BOT_USERNAME` and `VITE_TELEGRAM_APP_SHORT_NAME`; current fallbacks match the existing project invite URL.

## Constraints

- Never trust browser-provided Telegram IDs, host flags, room membership or scores.
- Do not change live Supabase functions, SQL, RLS, or secrets in this module.
- Do not claim the room lifecycle works end-to-end against the live database without testing the deployed RPC. The checked-in Multiplayer SQL definitions have known conflicts around no-game room creation, `select_game`, capacity enforcement and leaving during a match.
- A finished match does not destroy the room. Return to the room menu and reuse the same room for a rematch.


## Game availability catalog

Both room menus read their available games from
`public.common_game_availability` through the public `src/database`
facade. Do not add another hard-coded list of enabled games to either menu.

The menus filter rows by:
- `is_enabled = true` for the global switch;
- `is_solo_enabled = true` in `SoloRoomMenu`;
- `is_multiplayer_enabled = true` in `MultiplayerRoomMenu`.

Rows are ordered by `sort_order`. Multiplayer start-button guidance uses
the selected row's `min_players` and `max_players`; the trusted SQL RPC and
room-capacity trigger enforce those limits independently.

The catalog controls availability, but it does not contain executable
components. `src/menus/gameAvailability.ts` maps stable game IDs to display
metadata and is the frontend presentation registry. A new game must be added
to the catalog and to this registry, then routed to its solo/multiplayer
components as applicable. Do not show an unknown catalog ID if the current
frontend build has no implementation for it.

If the catalog read fails, show an error and a retry action. Do not silently
fall back to a hard-coded game list: doing so would bypass the single source
of truth. An empty filtered result is a valid state and should be explained
to the player.

### Adding a game

Before enabling a new game, add its row to
`public.common_game_availability` using the approved SQL workflow. Set
`game_id` to the exact stable ID used by the game, then configure
`is_enabled`, both mode flags, `min_players`, `max_players` and
`sort_order`. Player limits must satisfy
`2 <= min_players <= max_players <= 4`. Set equal min/max values for games
that require an exact player count.

Keep the menu registry and app routing in sync with the catalog row. A game
is not ready for users merely because its database row exists; its required
frontend and trusted server implementation must also be deployed.
