import { useEffect, useMemo, useRef, useState } from "react";
import { claimedIds, loadProfile, setupChecks, type OperatorProfile } from "../../lib/operator";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";
import { OD_ICONS, PAGES, PAGE_GROUPS, type OpPage } from "./opContext";

/**
 * A menu that hangs off a trigger button. Radix is not in this project, so the popup is a button plus an
 * absolutely positioned list that closes on an outside click or Escape.
 */
function OdMenu({
  trigger,
  label,
  children,
  align = "start",
}: {
  trigger: React.ReactNode;
  label: string;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="odmenu" ref={wrap}>
      <button type="button" className="odmenutrigger" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        {trigger}
        <Markup html={OD_ICONS.chevUpDown} className="odmenuchev" />
      </button>
      {open ? (
        <div className={"odmenupop" + (align === "end" ? " end" : "")} role="menu">
          <p className="odmenulabel">{label}</p>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** What the business is doing right now, in the words the dashboard uses everywhere else. */
function statusLine(p: OperatorProfile, isDemo: boolean): string {
  if (isDemo) return "Demo dashboard";
  if (!p.published) return "Not on the site";
  if (!p.services.some((x) => x.live)) return "Live · no menu yet";
  return p.accepting ? "Live · accepting" : "Live · paused";
}

/**
 * The operator sidebar. Structure follows 21st.dev's SidebarShowcase: a business switcher on top, the nav
 * split into labelled collapsible groups with a status badge per item, and an account menu in the footer.
 * The badges are read off real profile state, never invented: new bookings come from the feed, and the
 * "needs setup" counts come from setupChecks, the same list Home shows.
 */
export function OpSidebar({
  p,
  page,
  fresh,
  isDemo,
  go,
  onBrand,
  onClaim,
  onSwitch,
  onPreview,
  onLogout,
}: {
  p: OperatorProfile;
  page: OpPage;
  fresh: number;
  isDemo: boolean;
  go: (page: OpPage) => void;
  onBrand: () => void;
  onClaim: () => void;
  onSwitch: (profile: OperatorProfile) => void;
  onPreview: () => void;
  onLogout: () => void;
}) {
  // Groups start open. Collapsing is remembered for the session so an owner who only works the day pages
  // can fold Setup and Business away.
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  // Every other business claimed in this browser. One-business owners never see the list.
  const others = useMemo(() => {
    return claimedIds()
      .filter((id) => id !== p.id)
      .map((id) => loadProfile(id))
      .filter((x): x is OperatorProfile => !!x);
  }, [p.id]);

  // setupChecks names the page each gap belongs to, so a page's badge is just its unfinished count.
  const gaps = useMemo(() => {
    const out: Partial<Record<OpPage, number>> = {};
    for (const c of setupChecks(p)) {
      if (c.done) continue;
      const pg = c.page as OpPage;
      out[pg] = (out[pg] || 0) + 1;
    }
    return out;
  }, [p]);

  const badgeFor = (id: OpPage) => {
    if (id === "bookings" && fresh) return { kind: "new" as const, text: String(fresh) };
    if (id === "listing" && !p.published) return { kind: "off" as const, text: "Hidden" };
    const n = gaps[id];
    if (n) return { kind: "todo" as const, text: String(n) };
    return null;
  };

  return (
    <aside className="odside">
      <button type="button" className="odbrand" onClick={onBrand}>
        <Mark size={28} />
        <b>Outset</b>
        <span>for operators</span>
      </button>

      <OdMenu
        label="Your businesses"
        trigger={
          <>
            <span className="odbizmark">{p.title.slice(0, 1)}</span>
            <span className="meta">
              <b>{p.title}</b>
              <small>{statusLine(p, isDemo)}</small>
            </span>
          </>
        }
      >
        {(close) => (
          <>
            <button type="button" className="odmenuitem on" role="menuitem" onClick={close}>
              <span className="odbizmark small">{p.title.slice(0, 1)}</span>
              <span className="odmenumeta">
                <b>{p.title}</b>
                <small>{statusLine(p, isDemo)}</small>
              </span>
              <Markup html={OD_ICONS.check} className="odmenucheck" />
            </button>
            {others.map((o) => (
              <button
                type="button"
                className="odmenuitem"
                role="menuitem"
                key={o.id}
                onClick={() => {
                  close();
                  onSwitch(o);
                }}
              >
                <span className="odbizmark small">{o.title.slice(0, 1)}</span>
                <span className="odmenumeta">
                  <b>{o.title}</b>
                  <small>{statusLine(o, false)}</small>
                </span>
              </button>
            ))}
            <div className="odmenusep" />
            <button
              type="button"
              className="odmenuitem plain"
              role="menuitem"
              onClick={() => {
                close();
                onClaim();
              }}
            >
              <Markup html={OD_ICONS.plus} />
              <span>{isDemo ? "Claim your business" : "Claim another business"}</span>
            </button>
          </>
        )}
      </OdMenu>

      {isDemo ? (
        <button type="button" className="cta small odclaimcta" onClick={onClaim}>
          Claim your business
        </button>
      ) : null}

      <nav className="odnav">
        {PAGE_GROUPS.map((group) => {
          const shut = !!folded[group.label];
          return (
            <div className="odgroup" key={group.label}>
              <button
                type="button"
                className="odgrouphead"
                onClick={() => setFolded((cur) => ({ ...cur, [group.label]: !cur[group.label] }))}
                aria-expanded={!shut}
              >
                <span>{group.label}</span>
                <Markup html={OD_ICONS.chevDown} className={"odgroupchev" + (shut ? " shut" : "")} />
              </button>
              <div className={"odgroupitems" + (shut ? " shut" : "")}>
                {group.ids.map((id) => {
                  const pg = PAGES.find((x) => x.id === id);
                  if (!pg) return null;
                  const badge = badgeFor(id);
                  return (
                    <button
                      type="button"
                      key={id}
                      aria-current={page === id ? "page" : undefined}
                      onClick={() => go(id)}
                    >
                      <Markup html={OD_ICONS[pg.icon]} />
                      <span>{pg.label}</span>
                      {badge ? <em className={badge.kind}>{badge.text}</em> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="odsidefoot">
        <OdMenu
          label="Account"
          align="end"
          trigger={
            <>
              <span className="odowner">{(p.ownerName.trim() || "?").slice(0, 1).toUpperCase()}</span>
              <span className="meta">
                <b>{p.ownerName.trim() || "Owner"}</b>
                <small>{p.ownerEmail || p.ownerPhone || "No contact yet"}</small>
              </span>
            </>
          }
        >
          {(close) => (
            <>
              <button
                type="button"
                className="odmenuitem plain"
                role="menuitem"
                onClick={() => {
                  close();
                  go("settings");
                }}
              >
                <Markup html={OD_ICONS.user} />
                <span>Owner and alerts</span>
              </button>
              <button
                type="button"
                className="odmenuitem plain"
                role="menuitem"
                onClick={() => {
                  close();
                  go("payouts");
                }}
              >
                <Markup html={OD_ICONS.card} />
                <span>Payouts</span>
              </button>
              <button
                type="button"
                className="odmenuitem plain"
                role="menuitem"
                onClick={() => {
                  close();
                  onPreview();
                }}
              >
                <Markup html={OD_ICONS.external} />
                <span>View my listing</span>
              </button>
              <div className="odmenusep" />
              <button
                type="button"
                className="odmenuitem plain danger"
                role="menuitem"
                onClick={() => {
                  close();
                  onLogout();
                }}
              >
                <Markup html={OD_ICONS.logout} />
                <span>{isDemo ? "Sign in" : "Log out"}</span>
              </button>
            </>
          )}
        </OdMenu>
      </div>
    </aside>
  );
}
