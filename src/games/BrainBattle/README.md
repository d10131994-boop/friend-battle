# Brain Battle

Brain Battle is a ten-question quiz game. Each question has four answer options
and a 15-second server-authoritative time limit. A correct answer awards 100
base points plus a speed bonus of up to 50 points. Incorrect answers and skips
award zero points.

## Multiplayer

Multiplayer uses the shared Multiplayer Core and Database module:

- Universal rooms support 2–4 players.
- The host selects Brain Battle and starts a match after every player is ready.
- The server selects and stores ten questions from a 20-question bank for each match. A rematch excludes the immediately previous match's question IDs, so it uses a different set. Correct answers and explanations are never returned to clients.
- The server validates each answer, response time, and score.
- A question advances as soon as every active player has answered, or when its
  15-second deadline expires. Missing answers are recorded as skips.
- The highest total score wins. A tie has no winner.
- Match wins and match counts are recorded in the common room statistics.
- After a completed match, the shared Multiplayer Core opens a 60-second unanimous rematch vote. An approved rematch starts Brain Battle again with a fresh question set and without selecting the game again.
- Leaving a room during a match cancels that match through the shared room
  lifecycle. Remaining players return to the room lobby.

The client uses `createDatabaseMultiplayerAdapter` and
`createMultiplayerRoomSession`; it does not access Multiplayer tables
directly. Game-specific actions are sent to the `brain-battle` Edge Function,
which authenticates Telegram initData and calls service-role-only RPCs.

The SQL schema and RPCs are defined in
`supabase/sql/brain_battle_multiplayer.sql`. The migration intentionally
removes the legacy `brain_battle_rooms`, `brain_battle_players`, and
`brain_battle_answers` tables and their RPCs. Those tables are replaced by
`games_brain_battle_matches` and `games_brain_battle_answers`, linked to
the common Multiplayer room and player records.

Solo mode continues to use the local Brain Battle question selector and game
engine; this multiplayer migration does not change solo scoring or UI.
