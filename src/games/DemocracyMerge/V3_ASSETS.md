# Democracy Merge V3 — asset integration status

V3 updates the **solo** presentation only. Gameplay, persistence, and multiplayer remain unchanged until separately verified.

## Approved assets available in the handoff ZIP

The ZIP `democracy-merge-v3-assets-available.zip` contains these files under `public/democracy-merge/v3/`:

- `foreground-decor.webp`
- `village.webp`
- `wooden-frame.webp`
- `info-panel.webp`
- `next-character-frame.webp`
- `tools-panel.webp`
- `tool-saw.webp`, `tool-storage.webp`, `tool-swap.webp`, `tool-replace.webp`
- `icon-random.webp`, `icon-dice.webp`, `icon-hourglass.webp`, `icon-trophy.webp`, `icon-tasks.webp`, `icon-coins.webp`
- `icon-gift.webp`, `icon-gift-reward.webp`, `icon-gift-open.webp`, `icon-gift-celebration.webp`
- `icon-party.webp`, `icon-party-hat.webp`, `icon-festive-hat.webp`

**Important:** These binary files have not been committed to GitHub. A CSS reference is not proof that the corresponding file exists.

## Missing from the handoff

- `grass-light.webp`, `grass-dark.webp`, `grass-medium.webp`, `grass-flowers.webp`, `grass-leaves.webp`, `grass-striped.webp` (check final approved names against the original asset register)
- Remaining previously approved scenery and other assets not in the ZIP
- Resources #35 and #36: intentionally deferred to V4

## Installation and verification

Extract the ZIP at the repository root, preserving the `public/democracy-merge/v3/` directory structure. Do not replace approved graphics with AI-generated approximations without approval. Commit the binary files on this issue branch. Run `npm ci`, `npm run build`, and `npm run lint` after staging; visually verify a solo match at mobile and desktop widths.

The solo toolbar uses existing SVG files as a fallback when V3 WebP icons are absent. CSS colors remain as a fallback for board cells. Multiplayer must not be restyled until the solo experience is verified.
