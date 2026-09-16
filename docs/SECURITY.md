# Security, in plain sentences

This is for Harshil. It says what protects Outset today, what the
2026-09-16 review changed, and what only he can do next. The full
technical write-up of that review is in
`docs/security/2026-09-16-keys-api.md`.

## What protects the site and the API today

**Secrets stay out of the repository.** `.env` files, the claim
secret, and every local database file are in `.gitignore`. Real
credentials (`DATABASE_URL`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`,
`ADMIN_KEY`, and the rest) live only in Render's environment settings,
never in `render.yaml` or a workflow file.

**Dependencies are checked, not just installed.** Both `package.json`
trees passed `npm audit` clean, with and without dev dependencies.
Dependabot now watches both trees and the GitHub Actions weekly, so a
new advisory shows up as a pull request instead of staying unnoticed.

**GitHub Actions run pinned code with a narrow token.** Every workflow
references the actions it uses by exact commit, not a tag someone else
can move, and every workflow's `GITHUB_TOKEN` is scoped to only what
that job needs: read-only where it just builds, write only where it
actually commits (the crawlers, the photo screen). The payout and
database-backup workflows only ever run on their schedule or a manual
click from someone with write access to the repository, never from an
outside pull request.

**The API checks who is asking, every time.** Claim links, sign-in
codes, sessions, the admin key, and both webhook signatures (Stripe and
Resend) are all checked with a timing-safe comparison, so a wrong
guess cannot be narrowed down by how fast the server answered. Claim
links now carry their own expiry, signed so it cannot be edited. The
admin-only routes (the ones that see raw operator data and outreach
drafts) answer "not found" to everyone unless the exact admin key is
set on that host and sent, so a host that forgets to set the key is
closed, not open.

**The database connection is encrypted and verified**, not just
encrypted: the API refuses to talk to a Postgres host presenting a
certificate it doesn't recognize, so a network in the middle can't
quietly swap in its own database.

**Guests only ever see what they're allowed to see.** A listing page
never reveals who owns it unless the request already proves ownership.
Every write a guest or operator can make is rate-limited per IP, so no
single caller can flood the sign-in code mailbox, the claim-request
mailbox, or the booking table.

## What this review changed

- Removed two large SQLite database dumps (113 MB) that had been
  committed by accident, and tightened `.gitignore` so a local database
  file can't be committed again.
- Took the available patch and minor dependency updates in both trees,
  and added Dependabot so this keeps happening automatically.
- Pinned every GitHub Action used in `.github/workflows` to an exact
  commit, and gave every workflow job only the repository permissions
  it actually needs.
- Stopped two log lines from writing a guest's or operator's full email
  address into the server log on a failed send; both now log a masked
  version instead.
- Added missing security response headers to the API (`X-Frame-Options`,
  `Permissions-Policy`), narrowed the CORS allowlist to only the real
  site and local dev, and stopped `/health` from announcing which exact
  commit is running.
- Verified, by actually running the app against a real local database
  with a real TLS certificate: the certificate check genuinely rejects
  an unrecognized certificate rather than only appearing to; the admin
  gate genuinely answers "not found" with no key set; the rate limiter
  genuinely cuts a caller off after its limit; and the full claim,
  booking, and payout flow works end to end against Postgres, not just
  in a mock.

What this review found but did not fix, and why, is in "Found, not
fixed" in `docs/security/2026-09-16-keys-api.md`: a gap where a
session token issued to a listing's owner keeps working for up to 30
days after that listing is released, because the fix changes how
sessions are minted and checked everywhere, and that code is also
where other bug-fix work is happening on this branch right now.

## Checklist: things only Harshil can do

- [ ] Turn on **branch protection** on `main`: require the build/test
      checks to pass before a merge, once a workflow runs them on every
      push (they currently only run locally, per review session).
- [ ] Turn on **two-factor authentication** on GitHub, Render, Neon,
      Stripe, and the mail provider (Resend), wherever it isn't already
      on.
- [ ] Turn on **Dependabot alerts** and **secret scanning /
      push protection** in the repository's Settings -> Code security
      page (different from the `dependabot.yml` file, which only
      schedules update PRs).
- [ ] Confirm the **Stripe key** in use is a restricted key, not a
      full secret key, and rotate `STRIPE_SECRET_KEY` and
      `STRIPE_WEBHOOK_SECRET` if either has ever left Render's
      dashboard.
- [ ] Rotate the **Neon database password** (`DATABASE_URL`) on a
      schedule.
- [ ] Confirm the **GitHub personal access token** used by the API
      (`GITHUB_TOKEN` on Render) is scoped to only this repository and
      has an expiry date set.
- [ ] Check the **Render environment** for `outset-api` and confirm
      `OUTSET_TEST_CLAIM_EMAILS` is not set there. This review could
      not check Render's live dashboard from its sandbox; the
      repository's own `render.yaml` correctly leaves it out, but that
      is only the template, not a live read of what Render actually
      has configured.
- [ ] Decide when to stop accepting the old, non-expiring claim links
      (see `backend/src/lib/claim.ts`); it only matters for links sent
      before the newer, expiring ones existed.
