# Koma companion character

[`public/koma-companion-girl.png`](../public/koma-companion-girl.png) is the current character for Koma's public workspace, welcome, progress, and empty states. The administration console uses the same new image while keeping its existing layout and theme. The character has long milky-white twin ponytails, black ribbon bows, gray-brown eyes, an ivory sweater, and a black pinafore; she waves while holding a blank film clapperboard.

The image was generated from text with the built-in `image_gen.imagegen` tool on 2026-09-07 and copied into the repository without modifying its pixels. No reference images were supplied. Earlier character assets and the Frame Atelier plan are historical and do not define the current character. The current UI direction is documented in the [companion refresh plan](plans/2026-09-07-companion-ui-refresh.md) and [design system](../DESIGN.md).

## Adopted asset

| Property | Verified value |
| --- | --- |
| File | `public/koma-companion-girl.png` |
| Dimensions | 1254 × 1254 pixels |
| Format | PNG, RGBA |
| Size | 1,137,442 bytes |
| Alpha range | 0–255 |
| Fully transparent pixels | 1,055,490 |
| Visible-content bounds at alpha ≥ 8 | Left 218, top 27, right 1044, bottom 1240; right/bottom exclusive |
| SHA-256 | `fcc897dcaa41ae55902ceb676c52a723bf8bae8dfe7823e2c41082708d11aa20` |

The full character, both ponytails, waving hand, clapperboard, and shoes are visible without apparent cropping. At alpha ≥ 8, the visible top and bottom margins are 27 and 14 pixels. A few almost-transparent pixels with alpha 1 touch the outer canvas border; the original file is preserved. Layouts should use `object-fit: contain` and provide surrounding space rather than crop the illustration.

The dimensions and alpha values were checked from the adopted PNG, not inferred from the requested composition. These checks describe the image asset; they do not establish browser layout, interaction, accessibility, deployment, or analysis acceptance.

## Generation prompt

The exact submitted prompt was:

```text
Use case: illustration-story.
Asset type: a brand-new original anime companion character for Koma, a black-white-neutral-gray video notes web workspace, delivered as a transparent PNG cutout.
Primary request: Draw an irresistibly cute moe anime young adult woman in a tasteful approximately 2.8-head-tall chibi illustration style. She has fluffy long milky-white twin ponytails with soft black ribbon bows, very large luminous gray-brown eyes with delicate clear highlights, round soft cheeks with a little natural pink blush, and a warm cheerful open smile. Cute stylized young adult character, not a toddler or baby. Modest loose ivory knit sweater with long sleeves under a simple small black pinafore dress, opaque knee-high white socks, and soft simple black shoes. She stands with a slight lively lean, one hand gently waving with an open palm while her other arm hugs a small black-and-white film clapperboard. The clapperboard is a simple striped visual prop with a blank face and no writing.
Style/medium: polished Japanese moe anime illustration, clean delicate soft linework and restrained smooth cel shading, adorable expressive face, fluffy silky hair, clear readable silhouette, fine but uncluttered finish, 2D illustration and never 3D.
Composition/framing: one complete full-body character centered on a square canvas, both long ponytails, waving hand, shoes, and clapperboard fully visible; preserve generous clear transparent padding on every side. Aim for a readable website character, not a cropped portrait.
Color palette: milky white, ivory, charcoal black, neutral grays; naturally warm pale skin and tiny blush only. No bright accent colors.
Scene/backdrop: genuinely transparent background with a real alpha channel. The character alone floats as a clean PNG cutout with no environment.
Constraints: create a completely new design from this description alone. Do not use earlier conversation images or a silver-gray bob-haired seated notebook girl as reference. No sexualization, no cleavage, no exposed underwear, no baby/toddler styling. No background, no floor, no cast-shadow block, no checkerboard pattern, no text, no logo, no lettering, no watermark, no border, no decorative sparkles, no extra characters, no added props. Keep all edges and extremities comfortably inside the canvas.
```

The local generation record, including the original output path and inspection details, is `work/qa/companion-image-generation.json`; this working evidence is ignored by Git. The source image remains in the image tool's generated-images directory, and the project copy has the matching hash above.
