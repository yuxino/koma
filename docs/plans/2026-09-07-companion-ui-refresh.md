# Koma companion UI refresh

The user requested a cuter, newly drawn anime companion and a full UI refresh after the first account-workspace release.

## Direction

Use soft black, white, and neutral gray, with a fresh expressive twin-tail companion illustration. Replace condensed oversized display text and rigid workbench lines with normal-proportion typography, rounded controls, generous spacing, and clearly separated working areas. The new illustration is `public/koma-companion-girl.png`; earlier character assets are historical.

The welcome page introduces the companion and three concrete capabilities. The signed-in composer uses a compact greeting above a two-column source/request sheet on desktop and a single reading order on mobile. Library entries remain readable rows. Results retain the full title, a balanced video/transcript layout, clear downloads, and quiet summaries.

## Preserved behavior

GitHub account sessions and private ownership, old-record recovery, per-account draft/default storage, generated output-field explanations and explicit confirmation, source validation, analysis providers, subtitle searching/seeking, retries, and file downloads keep their existing implementations. No new backend capability or provider configuration is introduced.

## Verification

Run source-layout checks, existing tests, type checks and builds. Inspect actual browser pages at desktop, tablet, 390px and 320px widths in Chinese and English, including anonymous welcome, composer, library, results, settings/schema dialogs and reduced motion. Verify existing interactions after the visual changes. Commit and push main, deploy the existing site, and verify the final source/artifact parity.
