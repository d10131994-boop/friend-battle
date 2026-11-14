# RPS scene assets

## Adding objects without code changes

Put transparent PNG/WebP/JPG images in `objects/` using the filename format
`obj_001_size_35.png`. The numeric size must be an integer from **1 to 100**.
Use a unique ID for each object. Files with invalid names are ignored by the new
scene generator; the old trial files must be renamed as the artwork is replaced.
Assets are discovered by Vite at build time, so deploy/rebuild after adding files.

All object artwork should use a consistent perspective (~60 degrees above ground),
similar tight transparent padding and consistent outline style. The numeric size
is a relative visual size, not pixels. Actual screen width is computed from that
size and the point's depthScale.

## Backgrounds

Put `background1.png` and `background2.png` (or .jpg/.webp) in `background/`.
Each has twelve independently configurable positions in `../sceneLayouts.ts`.
Until new backgrounds are supplied, the existing first background image is used
as a temporary visual fallback for both layouts.

Each point defines x/y (percent), minSize/maxSize (eligible object sizes),
depthScale, rotate and layer. The generator chooses 7–12 unique objects, with
empty points allowed; if insufficient compatible objects exist it places fewer.
The campfire is a separate mandatory element with per-background position and
a random image from `objectsCamps/`. The `hands/` folder remains reserved.

The development-only editor is at `/dev/rps-scene`. Drag points, edit numeric
fields, switch backgrounds, regenerate, and copy the JSON configuration.
Editor changes are ephemeral: copy the configuration back to `sceneLayouts.ts`
to persist them. Gameplay and Supabase contracts are unchanged.
