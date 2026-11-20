# Public Release Packaging

A filtered snapshot of `main` is published to the public GitHub repository. The
public tree omits internal working notes, Bosch component photographs, and
unreferenced build artifacts while keeping the application and both automated
test suites passing without modification.

## Exclusion Manifest (`tools/public-exclude.txt`)

`tools/public-exclude.txt` is the single manifest of repo-relative paths omitted
from the public tree:

- `docs/internal/` — internal batch plans, progress logs, summaries, and code
  review working notes.
- `web/parts/` — Bosch component `.webp` photographs.
- `web/workshop/part-images-pdf.js` — embedded base64 JPEG thumbnails used by
  the PDF report in the private tree.
- `web/data/part-images.json` — the source map for the bundled Bosch Flow app
  photographs; it is not loaded at runtime and its provenance is not established
  for redistribution.
- Any additional unreferenced or unattributed files listed in
  `tools/public-exclude.txt`.

## Building and Verifying the Public Tree

Run `tools/public-tree.mjs` with a new output directory outside the repository:

```bash
work=$(mktemp -d)
node tools/public-tree.mjs --out "$work/public"
```

`tools/public-tree.mjs` uses only Node.js built-in modules and never modifies
the working repository:

1. Requires a new leaf directory whose parent already exists. It never clears,
   reuses or deletes an existing output directory.
2. Resolves the parent directory and the repository root before the containment
   check, so a symlink alias cannot put the output inside the checkout. It
   rejects any `--out` path inside or above the repository root.
3. Reads `git ls-files -z` and copies every tracked file that does not match
   `tools/public-exclude.txt` into `--out`. A missing, redirected (symlink) or
   nonregular tracked input is refused rather than skipped or dereferenced.
4. Verifies that none of the excluded paths exist in `--out`.
5. Runs `node tools/check-all.mjs` and `node tools/check-workshop-light.mjs`
   inside `--out`.
6. Runs a privacy scan over all text files in `--out` (checking for private IPv4
   ranges, local filesystem mount paths, internal hostnames, and non-noreply
   personal email addresses outside `web/vendor/`).
7. Exits non-zero on any check or privacy finding.

## Static hosting: cache revalidation

The LAN deployment is served by nginx with `ETag` / `Last-Modified` and no
`Cache-Control` header. Without explicit freshness information a browser may
reuse a cached `.js` file while the HTML is fresh. The visible symptom is an
older `POLICY.VERSION` in the UI even though the deployed build is current.

Configure revalidation for static assets on the host:

```nginx
location ~* \.(html|js|css)$ {
    add_header Cache-Control "no-cache";
}
```

The application also stamps the version into `index.html` (header, footer and
`data-version`). `tools/check-all.mjs` keeps that stamp in step with
`POLICY.VERSION`, and the footer reports when the loaded scripts and the
deployed `deploy-info.txt` disagree. A stale bundle is therefore visible rather
than silent; a hard reload (Ctrl+Shift+R) clears it immediately.

## Component Photos in Both Trees

`web/workshop/part-images.js` owns component photo resolution:

1. **Local first:** When local photographs are bundled (`web/parts/*.webp` and
   `web/workshop/part-images-pdf.js`), the UI and PDF report use them directly
   without network access.
2. **Public tree default (OFF):** When local photographs are absent, the UI
   renders generic SVG component icons and the PDF report omits component
   thumbnails cleanly. Zero external requests are made.
3. **Explicit session opt-in:** If the user ticks *Load component photos from
   cdn.jsdelivr.net (external request; session only)*, the UI loads component
   images from the pinned upstream commit
   (`cd9a5510ae1091c467d8d5a586a23723c17a9249` of
   `rweijnen/bosch-bes3-reader`), and the PDF report converts loaded images via
   an offscreen `<canvas>` when available, omitting photos without errors on any
   failure.
