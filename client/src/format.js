const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function lek(amount) {
  const value = Math.round(Number(amount) || 0);
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} L`;
}

export function formatDay(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${DAYS[date.getUTCDay()]} ${day} ${MONTHS[month - 1]}`;
}

export function formatMonth(key) {
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

export function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function shiftMonth(key, delta) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthDayBounds(key) {
  const [year, month] = key.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    min: `${key}-01`,
    max: `${key}-${String(last).padStart(2, "0")}`,
  };
}

export function defaultDateInMonth(key) {
  const today = todayIso();
  if (today.slice(0, 7) === key) return today;
  return `${key}-01`;
}

export function daysInMonth(key) {
  return Number(monthDayBounds(key).max.slice(-2));
}

export function monthPace(monthKey, income, spent, remaining, transactions, today = todayIso()) {
  const length = daysInMonth(monthKey);
  const todayMonth = today.slice(0, 7);
  let elapsed = 0;
  let daysLeft = length;
  if (todayMonth > monthKey) {
    elapsed = length;
    daysLeft = 0;
  } else if (todayMonth === monthKey) {
    elapsed = Math.min(Number(today.slice(-2)), length);
    daysLeft = length - elapsed + 1;
  }

  const byDay = new Map();
  for (const tx of transactions) {
    byDay.set(tx.spentOn, (byDay.get(tx.spentOn) || 0) + tx.amount);
  }

  const plotUntil = elapsed === 0 ? 0 : elapsed;
  let left = income;
  const points = [];
  for (let day = 1; day <= plotUntil; day += 1) {
    const iso = `${monthKey}-${String(day).padStart(2, "0")}`;
    const daySpent = byDay.get(iso) || 0;
    left -= daySpent;
    points.push({ day, spent: daySpent, left });
  }

  const avg = elapsed > 0 ? spent / elapsed : 0;
  const safe = daysLeft > 0 ? Math.max(remaining, 0) / daysLeft : 0;
  const runway = avg > 0 ? remaining / avg : null;
  return { length, elapsed, daysLeft, avg, safe, runway, points, closed: daysLeft === 0 };
}

export function formatRunway(days) {
  if (days == null) return "No rate yet";
  if (days < 0) return "Over the net";
  if (days >= 100) return `${Math.round(days)} days`;
  const rounded = Math.round(days * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} days`;
}

export function isWeekend(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

export function countLines(count) {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

export function parseMoney(value) {
  const text = String(value).trim().replace(/\s/g, "");
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  if (amount <= 0) return null;
  return amount;
}
