# NoCountIt preview backgrounds

Place local background images in this folder. The development scene preview discovers these files automatically when Vite starts.

Supported extensions: `.png`, `.jpg`, `.jpeg`, `.webp`.

Use portrait artwork with a 3:4 aspect ratio (recommended source size: 1200 × 1600 px). The preview uses `object-fit: cover`, so small edge crops are possible.

The preview selects one image deterministically from the scene seed. It also selects one solid wall color that is absent from the generated candy colors. This color is painted behind the image as layer 1. Transparent cut-out areas in the image (layer 2) reveal that same color. The jar SVG is drawn above the image without an opaque interior fill, so transparent parts of the jar also reveal the layers beneath it.

This folder is currently used only by the development preview. Production multiplayer rounds still use the server-generated SVG and do not yet include these background images.
