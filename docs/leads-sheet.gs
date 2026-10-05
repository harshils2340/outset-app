/**
 * Outset Leads: the brain behind the Google Sheet.
 *
 * Paste this into the Sheet (Extensions > Apps Script), save, then run `setup` once and accept the
 * permissions. From then on:
 *   - every morning at 8, an email lists everyone whose Follow up date has arrived, with phone, email and
 *     your notes, so the day starts with who to call;
 *   - when you set or change a Follow up date in the sheet, an all-day event lands on your Google Calendar
 *     that day, so the phone reminds you too;
 *   - POST /exec on the deployed web app appends a row, so Outset's backend can drop in people who reply
 *     to outreach or send a booking request, without you typing them.
 *
 * Columns, in order: Business, Person, Phone, Email, City, Status, Last contact, Follow up, Notes.
 * Rows with Status Customer, No or Not now are left alone.
 */

const SHEET_NAME = "Leads";
const DONE = ["Customer", "No", "Not now"];
const FOLLOW_UP_COL = 8; // H

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("dailyDigest").timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger("onLeadEdit").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
}

function sheet() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function leads() {
  const values = sheet().getDataRange().getValues();
  return values
    .slice(1)
    .map((r, i) => ({ row: i + 2, business: r[0], person: r[1], phone: r[2], email: r[3], city: r[4], status: String(r[5] || ""), last: r[6], next: r[7], notes: r[8] }))
    .filter((l) => l.business || l.person);
}

function dailyDigest() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = leads().filter((l) => l.next instanceof Date && l.next <= today && DONE.indexOf(l.status) < 0);
  if (!due.length) return;
  const tz = Session.getScriptTimeZone();
  const name = (l) => l.business || l.person;
  const block = (l) =>
    [
      name(l) + (l.business && l.person ? " (" + l.person + ")" : ""),
      [l.phone, l.email].filter(String).join("  "),
      l.notes || "",
      "Due " + Utilities.formatDate(l.next, tz, "EEE d MMM") + (l.last instanceof Date ? ", last contact " + Utilities.formatDate(l.last, tz, "d MMM") : ""),
    ]
      .filter(String)
      .join("\n");
  MailApp.sendEmail(
    Session.getActiveUser().getEmail(),
    due.length + (due.length === 1 ? " follow-up due: " : " follow-ups due: ") + due.map(name).join(", "),
    due.map(block).join("\n\n") + "\n\nSheet: " + SpreadsheetApp.getActive().getUrl(),
  );
}

function onLeadEdit(e) {
  const range = e.range;
  if (range.getSheet().getName() !== sheet().getName()) return;
  if (range.getColumn() !== FOLLOW_UP_COL || range.getRow() < 2) return;
  const day = range.getValue();
  if (!(day instanceof Date)) return;
  const row = range.getSheet().getRange(range.getRow(), 1, 1, 9).getValues()[0];
  const title = "Follow up: " + (row[0] || row[1]);
  const cal = CalendarApp.getDefaultCalendar();
  cal.getEventsForDay(day).filter((ev) => ev.getTitle() === title).forEach((ev) => ev.deleteEvent());
  cal.createAllDayEvent(title, day, { description: [row[1], row[2], row[3], row[8]].filter(String).join("\n") });
}

/**
 * The door for Outset's backend. Deploy > New deployment > Web app, execute as you, access "Anyone", and
 * put the /exec URL in Render as LEADS_SHEET_WEBHOOK together with a shared secret. Body:
 *   { "secret": "...", "business": "...", "person": "", "phone": "", "email": "", "city": "",
 *     "status": "Replied", "notes": "Replied to the Otto email asking about RingCentral",
 *     "followUp": "2027-01-05" }            (or "followUpDays": 2)
 * GET /exec?secret=... answers every row as JSON, so a Claude session can read the sheet too.
 * A row whose phone or email already exists gets the note appended instead of a duplicate.
 */
function doPost(e) {
  const body = JSON.parse(e.postData.contents || "{}");
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || body.secret !== secret) return ContentService.createTextOutput("no").setMimeType(ContentService.MimeType.TEXT);
  const sh = sheet();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = body.followUp ? new Date(body.followUp + "T00:00:00") : body.followUpDays ? new Date(today.getTime() + Number(body.followUpDays) * 86400000) : "";
  const key = (v) => String(v || "").replace(/\D/g, "");
  const existing = leads().find((l) => (body.phone && key(l.phone) && key(l.phone) === key(body.phone)) || (body.email && String(l.email).toLowerCase() === String(body.email).toLowerCase()));
  if (existing) {
    const cell = sh.getRange(existing.row, 9);
    cell.setValue([cell.getValue(), Utilities.formatDate(today, Session.getScriptTimeZone(), "d MMM") + ": " + (body.notes || "")].filter(String).join(" | "));
    sh.getRange(existing.row, 7).setValue(today);
    if (body.status) sh.getRange(existing.row, 6).setValue(body.status);
    if (next) sh.getRange(existing.row, 8).setValue(next);
  } else {
    sh.appendRow([body.business || "", body.person || "", body.phone || "", body.email || "", body.city || "", body.status || "New", today, next, body.notes || ""]);
  }
  return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
}

function doGet(e) {
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || !e.parameter || e.parameter.secret !== secret) return ContentService.createTextOutput("no").setMimeType(ContentService.MimeType.TEXT);
  const tz = Session.getScriptTimeZone();
  const day = (v) => (v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : String(v || ""));
  const out = leads().map((l) => ({ row: l.row, business: l.business, person: l.person, phone: l.phone, email: l.email, city: l.city, status: l.status, lastContact: day(l.last), followUp: day(l.next), notes: l.notes }));
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
