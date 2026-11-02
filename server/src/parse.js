export const CATEGORIES = [
  { slug: "coffee", name: "Coffee", color: "#8d5a32" },
  { slug: "eating-out", name: "Eating out", color: "#b84332" },
  { slug: "groceries", name: "Groceries", color: "#2f7d4a" },
  { slug: "alcohol", name: "Alcohol", color: "#7a3f68" },
  { slug: "fuel", name: "Fuel", color: "#2c5f8a" },
  { slug: "care", name: "Personal care", color: "#b56a22" },
  { slug: "pharmacy", name: "Pharmacy", color: "#1f7d78" },
  { slug: "clothes", name: "Clothes", color: "#3d4a8f" },
  { slug: "home", name: "Home", color: "#6d6240" },
  { slug: "bank", name: "Bank", color: "#4e5963" },
  { slug: "people", name: "Money to people", color: "#8a3030" },
  { slug: "other", name: "Other", color: "#8a8175" },
];

const RULES = [
  { test: /intesa/i, category: "bank" },
  { test: /benzin|naft/i, category: "fuel" },
  { test: /farmac/i, category: "pharmacy" },
  { test: /berber/i, category: "care" },
  { test: /pantallon|kemish|këpuc|kepuc/i, category: "clothes" },
  { test: /\bgaz\b/i, category: "home" },
  { test: /chivas|whisky|wine|\bbirr/i, category: "alcohol" },
  { test: /market|molto|mjalt|\bushq|\buj\b/i, category: "groceries" },
  {
    test: /sufllaq|kokore|sanduic|krepa|pilaf|pica|qofte|akullore|embelsir|tito|soda/i,
    category: "eating-out",
  },
  { test: /kafe/i, category: "coffee" },
];

export function categorize(description) {
  const text = description.trim();
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.category;
  }
  return "other";
}

function dayOfWeek(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isWeekendIso(iso) {
  const day = dayOfWeek(iso);
  return day === 0 || day === 6;
}
