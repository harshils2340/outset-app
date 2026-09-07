import type { Listing } from "../data/types";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function money(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

export function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return hh + ":" + String(m).padStart(2, "0") + " " + ap;
}

export function fmtDate(d: Date): string {
  return DAYS[d.getDay()] + ", " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function nowStamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function unitLine(l: Listing, qty: number): string {
  if (l.unit === "hr") {
    return money(l.price) + "/hr x " + l.minHours + " hr x " + qty + " " + l.qtyUnit + (qty > 1 ? "s" : "");
  }
  if (l.unit === "person") {
    return money(l.price) + " x " + qty + " " + l.qtyUnit + (qty > 1 ? "s" : "");
  }
  return "Flat rate · " + l.minHours + " hour trip";
}

export function plural(n: number, unit: string): string {
  return n + " " + unit + (n === 1 ? "" : "s");
}
