# Koma companion portrait

[`public/koma-ponytail-portrait.webp`](../public/koma-ponytail-portrait.webp) is the current character for the public workspace, welcome, loading, progress, help, and empty states. The separate [avatar logo](logo-assets.md) is used in the public page header, administration console, GitHub README, and favicon. The page illustration continues to show the clapperboard; the logo uses a new face-focused composition without hands or props.

The user requested a cuter, younger-looking single-ponytail character and explicitly referenced Kiri. The adopted Kiri website portrait supplied the round face, large open eyes, soft linework, and close framing. Koma retains milky-white hair tied in one high ponytail with one black ribbon, gray-brown eyes, an ivory sweater, black pinafore straps, and a blank film clapperboard held in both hands. This is a fully clothed head-and-shoulders illustration.

## Adopted asset

| Property | Verified value |
| --- | --- |
| File | `public/koma-ponytail-portrait.webp` |
| Dimensions | 1254 × 1254 pixels |
| Format | Lossless WebP, RGB, no alpha |
| Background | Generated very pale neutral background, intentionally opaque |
| Size | 1,129,232 bytes |
| SHA-256 | `e123b8e82b71f933878158837269959304771045b2ce3df0d7704440a7f8a26e` |
| Original PNG size | 1,680,407 bytes |
| Original PNG SHA-256 | `48b7ad7bfe431cd70edba4825c04784a6827b6be10de399f101719256540ae3f` |
| Encoding check | Every decoded pixel matches the generated PNG |

The built-in `image_gen.imagegen` tool generated this new portrait on 2026-09-07 with Kiri's current `kiri-portrait.webp` as a style reference. The reference SHA-256 is `86229f96176ac61cd094e4e03c3a99735a24b533f81ff24ad194517ff01328f2`. The original generated PNG, the fixed reference copy, and detailed checks are retained locally under `work/qa/`; the application uses the repository-owned WebP above.

The artwork is already a close portrait. Public placements fit it within small rounded frames, retaining the face, bow, hands, and ponytail instead of enlarging a full-body drawing. The separate header logo uses a round frame. The opaque background is close to the neutral page background; no filters, recoloring, or alpha extraction are applied. Hover and progress entrance motion respect reduced-motion preferences.

Earlier character files, including `koma-companion-girl.png`, remain historical assets and are no longer active UI references. Current layout rules are documented in the [companion refresh plan](plans/2026-09-07-companion-ui-refresh.md) and [design system](../DESIGN.md). Asset metadata does not establish browser, interaction, or deployment acceptance; those checks are recorded separately.

## Generation prompt

The exact submitted prompt was:

```text
Use case: illustration-story.
Asset type: a new Koma website mascot portrait.
Reference image: the attached Kiri portrait is a STYLE and FACE reference only. Match its very soft round cheeks, short rounded chin, large luminous open eyes, tiny nose and mouth, delicate pale linework, silky hair shading, and intimate cute face-and-shoulders composition. Create a distinct Koma character, not a copy of Kiri's bob, lavender clothing, K clip or pose.
Subject: one very cute young anime girl with the same youthful appearance and gentle expression as the reference. Milky-white hair with ONE single high ponytail tied with ONE black ribbon bow; the fluffy ponytail falls behind one shoulder. Soft bangs frame her round face. Large bright gray-brown eyes, both open, a tiny happy smile and a little natural cheek blush. She tilts her head slightly and hugs a small black-and-white film clapperboard beneath her chin, with two relaxed hands visible around its edges. The clapperboard has a striped top and a plain blank face. No wave or hand signs.
Clothing: a modest loose ivory long-sleeved sweater with a fully covered neckline and simple black pinafore straps. Wholesome everyday styling.
Composition: square close portrait, head and shoulders only, face dominates the image as in Kiri. Include the complete black bow and ponytail curve with comfortable margins. The lower edge ends naturally at forearms and the clapperboard. No legs, hips, full body or toy-like chibi body.
Palette and background: milky white, ivory, charcoal and neutral gray plus natural skin and blush. Plain uniform very pale neutral gray background (#fafafa), no purple or colored tint, no checkerboard, no decoration, gradients, scenery, frame or shadow.
Finish: refined hand-drawn Japanese anime illustration closely matching the reference's tender round-faced character appeal, clean fine outlines and soft luminous eyes. No text, lettering, logos, watermark, extra characters or objects. Fully clothed and nonsexual.
```
