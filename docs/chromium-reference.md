# `chromium/chromium` Reference

## Repository

- GitHub: `chromium/chromium`
- URL: `https://github.com/chromium/chromium`

## Intended Use Here

- Query Chromium implementation details related to Chrome DevTools behavior.
- In particular, use this repo as the preferred DeepWiki target when researching Local Overrides directory conventions and any override-related on-disk behavior.

## DeepWiki Status

- On April 3, 2026, a DeepWiki MCP lookup was attempted for `chromium/chromium`.
- `read_wiki_structure` returned a generic indexed structure.
- `ask_question` for Local Overrides directory behavior failed with: `Repository not found. Visit https://deepwiki.com to index it. Requested repos: chromium/chromium`.
- Treat `chromium/chromium` as the canonical repo reference for future DeepWiki queries, but assume DeepWiki support is currently unavailable until that repository is properly indexed in the session.

## Fallback Sources

- Chrome DevTools Local Overrides docs:
  - `https://developer.chrome.com/docs/devtools/overrides`
- If implementation-level repo context is needed before `chromium/chromium` is indexed, use:
  - `ChromeDevTools/devtools-frontend`

## Current Guidance

- Prefer a Chromium-overrides-compatible filesystem layout for static GET resources.
- Keep extension-specific metadata in JSON sidecars/manifests rather than Markdown-only descriptions.
- Use Markdown only as optional human-oriented guidance generated from the canonical machine-readable data.
