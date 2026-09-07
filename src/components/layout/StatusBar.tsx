import { useEffect, useState } from "react";

export function StatusBar() {
  const [clock, setClock] = useState(() => tick());

  useEffect(() => {
    const id = window.setInterval(() => setClock(tick()), 20000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="statusbar">
      <span>{clock}</span>
      <span className="sigs">
        <i style={{ height: 5 }} />
        <i style={{ height: 7 }} />
        <i style={{ height: 9 }} />
        <i style={{ height: 11 }} />
        <svg width="22" height="11" viewBox="0 0 22 11" fill="none" aria-hidden="true" style={{ marginLeft: 3 }}>
          <rect x=".6" y=".6" width="17" height="9.8" rx="3" stroke="currentColor" strokeOpacity=".45" />
          <rect x="2.4" y="2.4" width="12" height="6.2" rx="1.6" fill="currentColor" />
          <path d="M19.6 4v3c.9-.3 1.4-.8 1.4-1.5S20.5 4.3 19.6 4z" fill="currentColor" fillOpacity=".5" />
        </svg>
      </span>
    </div>
  );
}

function tick(): string {
  return new Date()
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(/\s?[AP]M/, "");
}
