import { HELP_EMAIL, LEGAL_LINKS, POSTAL_ADDRESS } from "../../lib/site";

/**
 * The legal line every desktop page ends on: the static About, Terms and Privacy pages, the support address and
 * the postal address. A first-time guest and a partner reviewing the site both look for these before trusting
 * a checkout, and until now only the home page had a footer and it linked none of them.
 */
export function LegalRow() {
  return (
    <div className="ah-legal">
      <span className="ah-legal-links">
        {LEGAL_LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        <a href={"mailto:" + HELP_EMAIL}>{HELP_EMAIL}</a>
      </span>
      <address className="ah-legal-addr">{POSTAL_ADDRESS}</address>
    </div>
  );
}

export function SiteFooterCompact() {
  return (
    <footer className="ah-footer compact">
      <div className="ah-gutter">
        <div className="ah-footbar">
          <span>© {new Date().getFullYear()} Outset<span aria-hidden="true"> · </span>Book the jump. Skip the call.</span>
        </div>
        <LegalRow />
      </div>
    </footer>
  );
}
