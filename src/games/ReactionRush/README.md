# Reaction Rush

Reaction Rush supports solo and multiplayer play. The shared top-ten leaderboard records the highest number of taps, not match round points.

## Solo mode

- A solo round lasts 10 seconds and its taps are counted by the trusted Supabase backend.
- The solo best score and completed-round count come from the server; the leaderboard stores only the ten best records.
- The solo ranking uses the same tap units as multiplayer records.

## Multiplayer mode

- Room creation, invites, membership, readiness, heartbeats, and private Realtime snapshots use the shared Multiplayer Core.
- Reaction Rush allows **2–4 players** (configured through `public.common_game_availability`).
- The server verifies Telegram initData and counts every accepted tap in PostgreSQL.
- Each match contains **three 10-second rounds**.
- Each round awards **one round point to every player with the highest tap count**. Tied leaders all receive one point, including a 0–0 round.
- The match winners are **all players tied for the highest number of round points** across the three rounds, regardless of total taps.
- Every match winner receives **one win** in `public.common_multiplayer_room_stats`; each participant gets one match played.
- The game persists `final_results` with `score` (round points), `totalTaps` (sum of taps), and `isWinner` for each participant. The legacy single `winner_user_id` is populated only for a unique winner.
- The shared `games_reaction_rush_records` top-ten leaderboard continues to use **total taps** from multiplayer games and taps from solo games, keeping the same units.
- Individual taps are authoritative only when accepted by the server; client score/winner values are never trusted.

## Deployment

- Apply `supabase/migrations/20261114030000_reaction_rush_round_points_four_players.sql` to the database before releasing the updated frontend.
- The existing `reaction-rush` Edge Function requires no changes: it forwards the server's round/final results to clients.
- Use the normal shared Multiplayer Core room lifecycle. The game does not add its own lobby state.
