# Koma avatar logo

Koma uses two distinct illustrations of the same single-ponytail character. The [page portrait](visual-assets.md) keeps the hands and clapperboard. The avatar uses the exact round portrait selected by the user on 2026-09-07, with the original face, hair, bow and ivory collar preserved.

- `public/koma-logo-round.png`: public header, administration header and login, and both GitHub README headers.
- `public/koma-favicon-round.png`: browser tab icon, declared as 64 × 64 PNG in `index.html`.
- Welcome, composer, loading, empty, help and progress illustrations keep `public/koma-ponytail-portrait.webp` unchanged.

## Verified assets

| File | Dimensions | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `public/koma-logo-round.png` | 512 × 512 | 363,038 | `e4042c29ecde86b680ca01e15ddf0f3639031a036e09c0d7c6b355d6a36d97b9` |
| `public/koma-favicon-round.png` | 64 × 64 | 8,429 | `bcba6b84880cd336b22b186a04e3a96d8c1938eea1923ca7f8f2819456d6f5fe` |

Both delivery files are RGBA PNGs with real transparency outside the circular portrait. The supplied 1254 × 1254 image contained a baked checkerboard outside the circle. A centered circular alpha mask (center 626.5, 626.5; radius 610 pixels; one-pixel antialias edge) removes that area without repainting or changing RGB pixels before resizing. The circular interior keeps its original pale backdrop. This is a crop of the selected image, not a newly generated character.

The selected source SHA-256 is `d32d1934b1156c670078da19dae4f64a9de1a78261bb473b90d39e1019997595`. Local source and alpha inspection records remain under `work/qa/`. Both exports passed transparent-corner, circular-boundary and opaque-interior checks. Previous opaque logo assets remain historical and inactive.

## Historical generation

The previous separate avatar was created with the built-in `image_gen.imagegen` tool on 2026-09-07 using the page portrait as its character reference. Its original source SHA-256 was `f6e4b6256f705701303c3cab96f0a1d28c1efc636a349d8ec5dd14610a840295`. That opaque avatar is superseded by the user-selected image above; its prompt is retained here as history only.

### Historical generation prompt

```text
Use case: logo-brand.
Asset type: a separate character avatar logo for Koma, used as a small website header icon, favicon, and GitHub README logo.
Reference: the supplied current Koma portrait establishes the exact character identity and delicate cute drawing style. Preserve her round young face, huge open gray-brown eyes, tiny smiling mouth, milky-white hair, one single high ponytail and one black ribbon bow. Create a NEW companion logo composition, distinct from the large page illustration.
Composition: square icon canvas with an extreme close-up of the face and hair, centered and looking directly at the viewer. Show head, a little neck and ivory sweater collar only. Her full rounded face must remain readable when the image is displayed at 32 pixels. Make her face occupy most of the inner icon, simplify fine hair texture into clear smooth soft shapes while retaining a few elegant strands. Keep one black bow and the single ponytail attachment visibly inside the frame with comfortable padding; the ponytail curls around behind her cheek. No body, no hands, no clapperboard.
Style: refined cute anime mascot emblem, very soft round cheeks and short rounded chin, bright clear eyes, tiny warm smile, clean slightly clearer outlines than the full illustration, restrained neutral shading. Maintain the reference's youthful wholesome appeal.
Background and colors: clean uniform very pale neutral gray (#fafafa). White, ivory, charcoal and gray only with natural skin color and a tiny blush. Use a simple circular character composition comfortably within the square canvas so it also works in round UI avatar masks. No thick border, decorative shapes, gradients, scenery, colored accents, shadow, text, wordmark, letters, watermark or additional objects. Fully clothed at the neckline, nonsexual.
```
