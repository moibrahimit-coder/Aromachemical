---
name: Limited-offer reservations
description: Safety rationale for limited ebook promotion capacity
---
Do not free a promotional reservation solely because a checkout request timed out or a manual transfer has been awaiting review.

**Why:** A timed-out Stripe request may still have created a payable session; a pending receipt may represent money already transferred. Releasing these slots blindly can oversell the limited offer or mishandle paid buyers.

**How to apply:** Require confirmed terminal provider state before releasing card reservations, preserve order pricing when retrying, and keep manual receipts reserved until administrator review. Registration alone is not a purchase.