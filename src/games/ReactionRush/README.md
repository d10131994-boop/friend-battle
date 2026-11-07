# Reaction Rush

Reaction Rush supports solo play and multiplayer play. Its ranking behavior is intentionally game-specific.

## Solo mode

- The player's current score, personal best, and number of completed rounds are kept in browser local storage.
- Solo results are not uploaded to a cross-game or global leaderboard.
- No global rating screen or global score endpoint is used.

## Multiplayer mode

- Room creation, invites, membership, readiness, heartbeats, and private Realtime snapshots use the shared Multiplayer Core.
- Game-specific start, tap, finish, and leaderboard actions use the trusted `reaction-rush` Edge Function.
- The server validates Telegram initData and counts taps in PostgreSQL. The browser never submits a final score.
- Each match consists of three 10-second rounds.
- Match scores and the game-specific ranking are stored in `public.games_reaction_rush_scores` and `public.games_reaction_rush_leaderboard`.
- The in-game multiplayer leaderboard ranks Reaction Rush players by wins and best match score. It is independent of any other game's data.

## Server setup

- Apply the canonical shared SQL in `supabase/sql/universal_lobby_reaction_rush.sql`.
- Apply `supabase/sql/multiplayer_room_maintenance.sql` for shared room maintenance functions.
- Apply `supabase/sql/reaction_rush_room_lifecycle.sql` for Reaction Rush-owned cleanup when a room is reset or closed.
- Deploy `supabase/functions/multiplayer/index.ts` and `supabase/functions/reaction-rush/index.ts` together.
