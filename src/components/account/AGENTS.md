# src/components/account

Read `/AGENTS.md` first.

Guest Profile. The card on this tab is a real Stripe saved payment method: the guest adds it once, sets a per-booking cap, and can let Otto hold it. Otto never sees a PAN. Human Stripe Checkout stays the path when Otto is off, the total is over the cap, or no card is saved. Do not add fake payment settings.
