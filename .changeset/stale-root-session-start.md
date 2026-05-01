---
"@wraithwalker/extension": patch
---

Handle stale File System Access root handles during session startup.

Start Session now normalizes browser file-reference read failures into reconnect guidance instead of surfacing the raw browser error, and the extension test suite covers the offscreen, session controller, popup, and background runtime paths.
