import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { generateOutreachDrafts } from "../src/outreach/drafts.ts";
const n = generateOutreachDrafts();
console.log("drafted", n);
const row = db.prepare(`SELECT d.subject, d.body, d.to_email, o.name FROM outreach_drafts d JOIN operators o ON o.id = d.operator_id
  WHERE o.calendar_vendor = 'fareharbor' AND d.to_email IS NOT NULL AND EXISTS (SELECT 1 FROM facts f WHERE f.operator_id=o.id AND f.fact_key='cover')
  ORDER BY o.review_count DESC LIMIT 1`).get() as { subject: string; body: string; to_email: string; name: string };
console.log("SAMPLE for", row.name, "(would go to " + row.to_email + ")\n\nSubject: " + row.subject + "\n\n" + row.body);
process.exit(0);
