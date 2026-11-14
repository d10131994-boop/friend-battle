# Democracy Merge V3 — asset integration status

V3 changes the solo presentation. Gameplay, persistence, and multiplayer must remain unchanged.

## Installed assets

All paths below are relative to `public/democracy-merge/picture/v3/`.

- Board: `grass-01.webp` through `grass-06.webp`, `wooden-frame.webp`
- UI: `info-panel.webp`, `next-character-frame.webp`, `tools-panel.webp`
- Tools: `tool-saw.webp`, `tool-storage.webp`, `tool-swap.webp`, `tool-replace.webp`
- Icons: `icon-random.webp`, `icon-dice.webp`, `icon-hourglass.webp`, `icon-trophy.webp`, `icon-tasks.webp`, `icon-coins.webp`, `icon-gift.webp`, `icon-gift-reward.webp`, `icon-gift-open.webp`, `icon-gift-celebration.webp`, `icon-party.webp`, `icon-party-hat.webp`, `icon-festive-hat.webp`
- Scenery: `foreground-decor.webp`, `village.webp`, `sky-clouds.png`, `castle.png`, `houses-alternative.png`, `houses-village-alternative.png`, `landscape-foreground.png`, `windmill.png`, `decorative-object.png`

The background currently uses `sky-clouds.png`, `castle.png`, `houses-village-alternative.png`, and `landscape-foreground.png`. At widths up to 700px, castle and houses are hidden to preserve gameplay readability. Other scenery files are available but not currently placed.

## Verification status

- All listed assets are present in the issue branch according to the GitHub comparison against `friend-battle-05-release`.
- Draft PR: https://github.com/d10131994-boop/friend-battle/pull/107
- CI run #835: **passed**. Production build and lint, Supabase Edge Function checks, and SQL syntax checks all completed successfully. Run: https://github.com/d10131994-boop/friend-battle/actions/runs/42512673239
- Static asset path audit: **passed** for 14 literal CSS asset URLs. The four tool WebP assets are also listed in the GitHub branch comparison and referenced through dynamic paths in TSX.
- Browser visual review and interactive gameplay: **not yet confirmed**. CI does not replace browser testing.
- Check desktop and mobile solo screens, image scaling, background contrast, interactive controls, and missing asset requests.
- Run `npm ci`, `npm run build`, and `npm run lint` in a network-enabled checkout or GitHub Actions before merging.
- Resources #35 and #36 remain deferred to V4 per the original V3 handoff notes.
