# src

Read `/AGENTS.md` first. This folder is the React app.

- `main.tsx` mounts the tree.
- `App.tsx` is the device chrome and screen switch.
- Do not put listing data or pricing math in components. Use `data/` and `lib/`.
- The guest app keeps the phone-frame layout. Do not turn the guest side into a desktop dashboard. The operator side (`components/operator/`) is the one desktop dashboard, and it also renders inside the phone frame in `compact` mode.
