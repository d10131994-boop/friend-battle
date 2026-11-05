# Reaction Rush multiplayer integration

Reaction Rush multiplayer is implemented on top of the shared Multiplayer Core.

- Shared room creation, invites, membership, readiness, heartbeats, and private Realtime snapshots use `src/multiplayer`.
- Game-specific start, tap, and finish actions use the trusted `reaction-rush` Edge Function.
- The server validates Telegram initData and counts taps in PostgreSQL. The browser never submits a final score.
- Each round lasts 10 seconds. The host starts a round after all room members are ready.
- Readiness is reset by the shared Multiplayer lifecycle when a round starts, so players confirm again before the next round.
- Game-specific scores are stored in `public.reaction_rush_scores`.
- The old `duels` table and `duels` Edge Function are legacy. They are retained until the new client is released and verified; they are not used by the new Reaction Rush UI.

Apply `supabase/sql/multiplayer_game_lifecycle.sql` and then `supabase/sql/reaction_rush_multiplayer.sql` to provision the shared lifecycle and game-specific score storage. Deploy `supabase/functions/multiplayer/index.ts` and `supabase/functions/reaction-rush/index.ts` together.
