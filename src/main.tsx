import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./lib/admin";
import { AppProvider } from "./state/AppProvider";
import "./styles/app.css";
import "./styles/operator.css";

/**
 * A clean path for a link that leaves the app, an outreach email or a shared URL that would otherwise read
 * "#o=o-sunsetwatersportskeywest-com" and look like a tracking link. Rewritten to the real "#o=" hash the
 * rest of the app already reads (AppProvider.tsx), before that code's first render, so nothing downstream
 * (refresh, back, the share round-trip that keeps the hash in sync) needs to know a second URL shape exists.
 */
const listingPath = /^\/listing\/([a-z0-9-]+)\/?$/i.exec(window.location.pathname);
if (listingPath) {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  window.history.replaceState(null, "", base + "#o=" + listingPath[1]);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
