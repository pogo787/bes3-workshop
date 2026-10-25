# Proposal: a Content Security Policy for the Workshop

Status: **draft only; no policy is active in Batch 4.** This note responds to
finding M15 of `code-review.md` (`docs/internal/review/review-1/code-review.md`).

## Why the page has no CSP today

`index.html` is a static page with no response headers of its own. The current
page has four practical blockers to a strict policy:

1. **Inline theme script.** `index.html:12-19` reads `localStorage` and sets
   `data-theme` before first paint. A `script-src 'self'` policy blocks it.
2. **Inline event handler.** `web/workshop/ui.js:451` uses an `onerror`
   attribute on the component image. A strict `script-src` blocks inline
   handlers even when the surrounding script is external.
3. **Third-party stylesheet and fonts.** `index.html:9-10` load General Sans
   and JetBrains Mono from `api.fontshare.com`; the CSS then loads font files
   from Fontshare's CDN.
4. **Inline style attributes.** The UI and the page use inline `style="..."`
   attributes (86 occurrences at the time of this draft). A strict
   `style-src` needs either a refactor to classes or an explicit
   `'unsafe-inline'` allowance.

The external links in the footer are navigation, not subresources, and do not
need a CSP allowance.

## Draft policy

This is the target after blockers 1 and 2 are removed. It is deliberately
conservative; `default-src 'none'` makes every directive explicit.

```text
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline' https://api.fontshare.com;
font-src 'self' https://cdn.fontshare.com;
img-src 'self' data:;
connect-src 'self';
base-uri 'none';
form-action 'none';
object-src 'none';
frame-ancestors 'none';
worker-src 'none';
manifest-src 'none';
```

Notes:

- `style-src 'unsafe-inline'` is the remaining weakness. It exists only for
  the current inline `style` attributes. Removing those attributes is a
  separate, mechanical change; after that the token can be dropped.
- If the two fonts are self-hosted, remove `https://api.fontshare.com` from
  `style-src` and `https://cdn.fontshare.com` from `font-src`, leaving `'self'`.
- `connect-src 'self'` is needed only if the M20 proposal is implemented with
  `fetch()` of a same-origin JSON map. Without that change the app makes no
  fetch/XHR requests and `connect-src 'none'` would be stronger.
- `frame-ancestors` is ignored in a `<meta http-equiv="Content-Security-Policy">`
  element. It must be sent as an HTTP response header. If the deployment cannot
  set headers, the meta policy still covers the other directives, but
  clickjacking protection must be documented as missing.
- `data:` in `img-src` keeps the current inline SVG/data-image fallbacks working.
- Do not add `'unsafe-eval'`. jsPDF does not need it in the bundled version.

## Phased implementation (not part of Batch 4)

1. **Inventory and report-only.** Serve a
   `Content-Security-Policy-Report-Only` header in a local/staging server and
   collect violations while exercising read, demo, Report and Log. A meta tag
   cannot be report-only, so this phase needs a header-capable server.
2. **Remove inline script blockers.** Move the theme bootstrap to
   `web/workshop/theme.js` and load it with `<script src=...>` before the
   stylesheet. Replace the image `onerror` attribute with a delegated
   `error` listener registered from `ui.js`.
3. **Decide on fonts.** Either keep the explicit Fontshare allowlist or
   self-host the two families. Self-hosting is preferable for privacy and for
   offline use, but it adds font files to the repository.
4. **Reduce inline styles.** Move the 86 `style` attributes to utility classes
   or CSS variables. Until then keep `'unsafe-inline'` in `style-src`; do not
   pretend the policy is strict.
5. **Activate.** Add the meta policy for the directives that work in a meta
   element and, where headers are available, the full policy including
   `frame-ancestors`. Start with a short canary period and a clear rollback.

## Verification plan

- Load the page from a local HTTP server and confirm no CSP violations for the
  read view, demo, Write Lab picker, Report preview/download and debug-log
  export.
- Confirm the external font request is either allowed by the final policy or
  gone after self-hosting.
- Confirm the PDF still embeds images (the base64 map is data, not a network
  subresource).
- Confirm opening a saved readout and generating a report do not require
  `'unsafe-eval'`.
- No hardware and no real device is needed for this verification.

## Out of scope

- Changing the hosting provider or adding response-header configuration.
- Adding a service worker.
- Refactoring the UI solely for CSP in this batch.
