---
name: Stripe connector approach
description: Why this store uses connector-proxied Stripe calls and keeps launch configuration explicit.
---
Use the current connection's injected connector-proxy setup rather than legacy templates that extract raw credentials. Payment fulfillment requires server-side provider verification; a browser return URL alone is never payment evidence.

**Why:** The accepted connection supplies authenticated proxy access, whereas older Stripe setup guidance assumes a different credential/sync integration. Mixing them would introduce unnecessary credential handling.

**How to apply:** For future payment changes, preserve connector-managed authentication and verify completed sessions, order association, currency and amount before granting a download. Do not claim live payments are ready merely because the connector is attached.