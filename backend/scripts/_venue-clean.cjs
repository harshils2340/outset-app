const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data/outset.db"); db.exec("PRAGMA busy_timeout=60000");
const rows = db.prepare("SELECT operator_id, lat, lon FROM locations WHERE source='site'").all();
const by = new Map(); for (const r of rows) { if (!by.has(r.operator_id)) by.set(r.operator_id, []); by.get(r.operator_id).push(r); }
const km = (a,b) => { const R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLon=(b.lon-a.lon)*Math.PI/180; const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(x)); };
let dropped = 0; const del = db.prepare("DELETE FROM locations WHERE operator_id = ? AND source = 'site'");
for (const [id, pts] of by) { if (pts.length < 6) continue; let spread = 0; for (const x of pts) for (const y of pts) spread = Math.max(spread, km(x,y)); if (spread < 40) { del.run(id); dropped++; } }
console.log("dropped clustered sets:", dropped, "remaining site venues:", db.prepare("SELECT count(*) n FROM locations WHERE source='site'").get().n);
