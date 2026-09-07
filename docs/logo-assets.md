# Koma avatar logo

Koma uses two distinct illustrations of the same single-ponytail character. The [page portrait](visual-assets.md) keeps the hands and clapperboard. The avatar logo was drawn separately with a larger round face, clearer eyes, one black bow, and an ivory collar for small placements.

- `public/koma-ponytail-logo.png`: public page header, administration header and login, and both GitHub README headers.
- `public/koma-ponytail-favicon.png`: the browser tab icon, declared as 64 × 64 PNG in `index.html`.
- The welcome, composer, loading, empty, help and progress illustrations continue to use `public/koma-ponytail-portrait.webp`.

## Verified assets

| File | Dimensions | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `public/koma-ponytail-logo.png` | 512 × 512 | 347,545 | `c43b49a1cbb35f36142dd96e371b529a3781bdfbee89e5a2ca489ad84248676c` |
| `public/koma-ponytail-favicon.png` | 64 × 64 | 6,941 | `2f9c802f8f741e840e0ca5f26bf5202b571c2efc6139e1fba80523f6fe1405a2` |

Both delivery files are RGB PNG with an intentionally opaque very pale neutral background. They were resized from the newly generated 1254 × 1254 logo; no manual repainting, recoloring, or background removal was applied. They are different sizes of the same logo, not additional character designs.

The built-in `image_gen.imagegen` tool created the new logo on 2026-09-07 using the adopted Koma page portrait as the character reference (SHA-256 `e123b8e82b71f933878158837269959304771045b2ce3df0d7704440a7f8a26e`). The source PNG is 1,546,855 bytes with SHA-256 `f6e4b6256f705701303c3cab96f0a1d28c1efc636a349d8ec5dd14610a840295`; the source, metadata, and exact prompt are retained under local `work/qa/`. Active assets are stored in the repository's `public/` directory. Historical character files remain inactive.

## Generation prompt

```text
Use case: logo-brand.
Asset type: a separate character avatar logo for Koma, used as a small website header icon, favicon, and GitHub README logo.
Reference: the supplied current Koma portrait establishes the exact character identity and delicate cute drawing style. Preserve her round young face, huge open gray-brown eyes, tiny smiling mouth, milky-white hair, one single high ponytail and one black ribbon bow. Create a NEW companion logo composition, distinct from the large page illustration.
Composition: square icon canvas with an extreme close-up of the face and hair, centered and looking directly at the viewer. Show head, a little neck and ivory sweater collar only. Her full rounded face must remain readable when the image is displayed at 32 pixels. Make her face occupy most of the inner icon, simplify fine hair texture into clear smooth soft shapes while retaining a few elegant strands. Keep one black bow and the single ponytail attachment visibly inside the frame with comfortable padding; the ponytail curls around behind her cheek. No body, no hands, no clapperboard.
Style: refined cute anime mascot emblem, very soft round cheeks and short rounded chin, bright clear eyes, tiny warm smile, clean slightly clearer outlines than the full illustration, restrained neutral shading. Maintain the reference's youthful wholesome appeal.
Background and colors: clean uniform very pale neutral gray (#fafafa). White, ivory, charcoal and gray only with natural skin color and a tiny blush. Use a simple circular character composition comfortably within the square canvas so it also works in round UI avatar masks. No thick border, decorative shapes, gradients, scenery, colored accents, shadow, text, wordmark, letters, watermark or additional objects. Fully clothed at the neckline, nonsexual.
```
