# RPS scene assets

Place generated images in these directories:

- `background/`: one round-scene background image (PNG or WebP). The first file in alphabetical order is used.
- `objects/`: transparent PNG/WebP/JPG images for environment props. Up to six are selected per scene.
- `objectsCamps/`: transparent PNG/WebP/JPG campfire variants. One is selected per session seed and rendered above ordinary props.
- `hands/`: reserved for hand artwork; current hand-choice UI remains unchanged.

## Naming and sizing

Use descriptive, stable filenames, for example:

- `objects/backpack.png`
- `objects/lantern.png`
- `objects/kettle.png`
- `objectsCamps/campfire-01.png`

Square 1024x1024 transparent PNGs are a good source format for individual props. Keep the subject centered with transparent padding. The renderer preserves image proportions and applies per-slot scale and rotation.

The scene uses six fixed layout templates. The selected layout, prop subset, prop positions, rotations, and campfire variant are deterministic for a given session seed. Add or remove files to change the available random pool; no code changes are required.

The `hands/` folder is intentionally prepared but not wired to new assets yet, so existing hand selection artwork and gameplay remain untouched.
