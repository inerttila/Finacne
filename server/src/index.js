import cors from "cors";
import express from "express";
import pg from "pg";
import { CATEGORIES, categorize, isWeekendIso } from "./parse.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgres://finance:finance@127.0.0.1:5433/finance",
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function lek(amount) {
  return `${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} L`;
}

function monthBounds(month) {
  const [yearText, monthText] = String(month).split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  if (!year || monthNumber < 1 || monthNumber > 12) return null;
  const key = `${year}-${String(monthNumber).padStart(2, "0")}`;
  const start = `${key}-01`;
  const next = monthNumber === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
  return { key, start, next };
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key, delta) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function resolveNextMonth(latest, force) {
  const today = todayKey();
  if (!latest) return today;
  if (today > latest.month) return today;
  if (force && latest.count > 0) return shiftMonth(latest.month, 1);
  return latest.month;
}

function parseAmountInput(value) {
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  if (amount <= 0 || amount > 100_000_000) return null;
  return amount;
}

function mapTx(row) {
  return {
    id: row.id,
    amount: row.amount,
    description: row.description,
    category: row.category_slug,
    people: row.people || [],
    spentOn: row.spent_on,
    weekend: row.weekend,
    fixed: row.fixed,
  };
}

async function categoryExists(slug) {
  const { rowCount } = await pool.query("select 1 from categories where slug = $1", [slug]);
  return rowCount > 0;
}

function cleanCategoryName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 40) return null;
  return name;
}

function slugify(name) {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "category";
}

const NEW_COLORS = ["#9a4d6b", "#3f6b4a", "#6a5428", "#355c7d", "#7d4e2d", "#4a5d48", "#6b3f55", "#3d5a62"];

async function uniqueSlug(base) {
  let slug = base;
  let n = 2;
  for (;;) {
    const found = await pool.query("select 1 from categories where slug = $1", [slug]);
    if (!found.rowCount) return slug;
    slug = `${base.slice(0, 28)}-${n}`;
    n += 1;
  }
}

async function migrate() {
  await pool.query(`
    create table if not exists categories (
      slug text primary key,
      name text not null,
      color text not null,
      sort_order int not null
    );

    create table if not exists income (
      month date primary key,
      amount int not null check (amount >= 0)
    );

    create table if not exists transactions (
      id serial primary key,
      amount int not null check (amount > 0),
      description text not null,
      category_slug text not null references categories(slug),
      people text[] not null default '{}',
      spent_on date not null,
      weekend boolean not null default false,
      sort_order int not null default 0,
      fixed boolean not null default false,
      created_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    alter table transactions drop column if exists date_estimated;
    alter table transactions drop column if exists imported;
    alter table transactions drop column if exists raw_line;
    drop table if exists checkpoints;
    alter table categories drop column if exists hint;
  `);
  await pool.query("alter table transactions add column if not exists fixed boolean not null default false");

  for (const [index, category] of CATEGORIES.entries()) {
    await pool.query(
      `insert into categories (slug, name, color, sort_order)
       values ($1, $2, $3, $4)
       on conflict (slug) do update
       set color = excluded.color,
           sort_order = excluded.sort_order`,
      [category.slug, category.name, category.color, index],
    );
  }
}

async function monthSummaries() {
  const { rows } = await pool.query(`
    with months as (
      select month from income
      union
      select date_trunc('month', spent_on)::date as month from transactions
    )
    select to_char(m.month, 'YYYY-MM') as month,
           coalesce(i.amount, 0)::int as income,
           coalesce(t.spent, 0)::int as spent,
           coalesce(t.line_count, 0)::int as line_count
    from months m
    left join income i on i.month = m.month
    left join (
      select date_trunc('month', spent_on)::date as month,
             sum(amount)::int as spent,
             count(*)::int as line_count
      from transactions
      group by 1
    ) t on t.month = m.month
    order by m.month desc
  `);
  const plain = rows.map((row) => ({
    month: row.month,
    income: row.income,
    spent: row.spent,
    count: row.line_count,
  }));
  return applyCarry(plain);
}

function applyCarry(summaries) {
  const ordered = [...summaries].sort((a, b) => a.month.localeCompare(b.month));
  let onHand = 0;
  let from = null;
  const enriched = new Map();
  for (const item of ordered) {
    const carried = onHand;
    const remaining = item.income + carried - item.spent;
    enriched.set(item.month, {
      ...item,
      carried,
      carriedFrom: carried > 0 ? from : null,
      remaining,
    });
    onHand = Math.max(remaining, 0);
    from = item.month;
  }
  return summaries.map((item) => enriched.get(item.month));
}

async function ensureIncome(monthKey) {
  const bounds = monthBounds(monthKey);
  if (!bounds) return;
  const existing = await pool.query("select amount from income where month = $1", [bounds.start]);
  if (existing.rowCount) return;
  const previous = await pool.query(
    "select amount from income where month < $1 order by month desc limit 1",
    [bounds.start],
  );
  if (!previous.rowCount) return;
  await pool.query(
    `insert into income (month, amount) values ($1, $2)
     on conflict (month) do nothing`,
    [bounds.start, previous.rows[0].amount],
  );
}

async function loadMonth(month) {
  const summaries = await monthSummaries();
  const openMonth = summaries[0]?.month || month || todayKey();
  const key = month || openMonth;
  const bounds = monthBounds(key);
  if (!bounds) {
    const error = new Error("That month is not valid.");
    error.status = 400;
    throw error;
  }

  const [incomeResult, txResult, categoryResult] = await Promise.all([
    pool.query("select amount from income where month = $1", [bounds.start]),
    pool.query(
      `select id, amount, description, category_slug, people,
              to_char(spent_on, 'YYYY-MM-DD') as spent_on,
              weekend, fixed
       from transactions
       where spent_on >= $1 and spent_on < $2
       order by spent_on, sort_order, id`,
      [bounds.start, bounds.next],
    ),
    pool.query("select slug, name, color from categories order by sort_order, slug"),
  ]);

  const transactions = txResult.rows.map(mapTx);
  const income = incomeResult.rows[0]?.amount ?? 0;
  const spent = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const byCategory = categoryResult.rows.map((category) => {
    const rows = transactions.filter((tx) => tx.category === category.slug);
    return {
      slug: category.slug,
      name: category.name,
      color: category.color,
      total: rows.reduce((sum, tx) => sum + tx.amount, 0),
      count: rows.length,
    };
  });

  const personMap = new Map();
  for (const tx of transactions) {
    for (const person of tx.people) {
      const current = personMap.get(person) || { name: person, total: 0, count: 0 };
      current.total += tx.amount;
      current.count += 1;
      personMap.set(person, current);
    }
  }

  const peopleTotal = byCategory.find((category) => category.slug === "people")?.total ?? 0;
  const bankTotal = byCategory.find((category) => category.slug === "bank")?.total ?? 0;
  const weekend = transactions.filter((tx) => tx.weekend).reduce((sum, tx) => sum + tx.amount, 0);
  const largest = transactions.reduce((best, tx) => (tx.amount > (best?.amount ?? -1) ? tx : best), null);
  const busiest = [...byCategory].filter((category) => category.count > 0).sort((a, b) => b.count - a.count)[0];
  const fuel = byCategory.find((category) => category.slug === "fuel");

  const insights = [];
  if (largest) insights.push(`${lek(largest.amount)} on “${largest.description}” is the biggest line.`);
  if (busiest) {
    const noun = busiest.count === 1 ? "line" : "lines";
    insights.push(`${busiest.name} is on ${busiest.count} ${noun}.`);
  }
  if (fuel?.total) insights.push(`Fuel for the car and motorcycle comes to ${lek(fuel.total)}.`);

  const viewed = summaries.find((item) => item.month === bounds.key);
  const carried = viewed?.carried ?? 0;
  const monthList = summaries.map((item) => ({ ...item, open: item.month === openMonth }));

  return {
    month: bounds.key,
    months: summaries.map((item) => item.month).sort(),
    monthList,
    openMonth,
    pastMonth: summaries.find((item) => item.month !== openMonth)?.month ?? null,
    closed: bounds.key !== openMonth,
    income,
    carried,
    carriedFrom: viewed?.carriedFrom ?? null,
    spent,
    remaining: income + carried - spent,
    dayToDay: spent - peopleTotal - bankTotal,
    peopleTotal,
    bankTotal,
    weekend,
    weekday: spent - weekend,
    count: transactions.length,
    categories: byCategory,
    people: [...personMap.values()].sort((a, b) => b.total - a.total),
    insights,
    transactions,
  };
}

app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/bootstrap", async (req, res, next) => {
  try {
    res.json(await loadMonth(req.query.month));
  } catch (error) {
    next(error);
  }
});

app.get("/api/suggest", (req, res) => {
  const description = String(req.query.description || "");
  res.json({ category: categorize(description) });
});

app.post("/api/categories", async (req, res, next) => {
  try {
    const name = cleanCategoryName(req.body?.name);
    if (!name) return res.status(400).json({ error: "Give the category a name." });
    const taken = await pool.query("select 1 from categories where lower(name) = lower($1)", [name]);
    if (taken.rowCount) return res.status(400).json({ error: "That category already exists." });
    const slug = await uniqueSlug(slugify(name));
    const count = await pool.query("select count(*)::int as n from categories");
    const sort = await pool.query("select coalesce(max(sort_order), 0) + 1 as next from categories");
    await pool.query(
      `insert into categories (slug, name, color, sort_order) values ($1, $2, $3, $4)`,
      [slug, name, NEW_COLORS[count.rows[0].n % NEW_COLORS.length], sort.rows[0].next],
    );
    res.status(201).json(await loadMonth(req.body?.month));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/categories/:slug", async (req, res, next) => {
  try {
    const slug = String(req.params.slug);
    if (!await categoryExists(slug)) return res.status(404).json({ error: "That category is gone." });
    const name = cleanCategoryName(req.body?.name);
    if (!name) return res.status(400).json({ error: "Give the category a name." });
    const taken = await pool.query(
      "select 1 from categories where lower(name) = lower($1) and slug <> $2",
      [name, slug],
    );
    if (taken.rowCount) return res.status(400).json({ error: "That category already exists." });
    await pool.query("update categories set name = $1 where slug = $2", [name, slug]);
    res.json(await loadMonth(req.body?.month));
  } catch (error) {
    next(error);
  }
});

app.post("/api/months", async (req, res, next) => {
  try {
    const summaries = await monthSummaries();
    const latest = summaries[0] || null;
    const key = resolveNextMonth(latest, Boolean(req.body?.force));
    if (!latest || key !== latest.month) await ensureIncome(key);
    res.status(201).json(await loadMonth(key));
  } catch (error) {
    next(error);
  }
});

app.put("/api/income", async (req, res, next) => {
  try {
    const bounds = monthBounds(req.body?.month);
    const amount = Number(String(req.body?.amount ?? "").trim().replace(/\s/g, ""));
    if (!bounds || !Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
      return res.status(400).json({ error: "Enter the net as a whole number." });
    }
    await pool.query(
      `insert into income (month, amount) values ($1, $2)
       on conflict (month) do update set amount = excluded.amount`,
      [bounds.start, amount],
    );
    res.json(await loadMonth(bounds.key));
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions", async (req, res, next) => {
  try {
    const amount = parseAmountInput(req.body?.amount);
    const description = String(req.body?.description || "").trim().replace(/\s+/g, " ");
    const category = String(req.body?.category || "");
    const spentOn = String(req.body?.spentOn || "");
    if (!amount || !description || description.length > 180 || !await categoryExists(category) || !/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) {
      return res.status(400).json({ error: "Amount, note, category, and date are required." });
    }
    const summaries = await monthSummaries();
    const openMonth = summaries[0]?.month || null;
    const pastMonth = summaries.find((item) => item.month !== openMonth)?.month || null;
    const targetMonth = spentOn.slice(0, 7);
    if (openMonth && targetMonth < openMonth && targetMonth !== pastMonth) {
      return res.status(400).json({ error: "You can add a line to this month or the past month." });
    }
    const { rows } = await pool.query("select coalesce(max(sort_order), 0) + 1 as next from transactions");
    await ensureIncome(spentOn.slice(0, 7));
    await pool.query(
      `insert into transactions
        (amount, description, category_slug, people, spent_on, weekend, sort_order, fixed)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [amount, description, category, [], spentOn, isWeekendIso(spentOn), rows[0].next, Boolean(req.body?.fixed)],
    );
    res.status(201).json(await loadMonth(spentOn.slice(0, 7)));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/transactions/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await pool.query(
      "select to_char(spent_on, 'YYYY-MM-DD') as spent_on from transactions where id = $1",
      [id],
    );
    if (!current.rows[0]) return res.status(404).json({ error: "That line is gone." });

    const fields = [];
    const values = [];
    const set = (column, value) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };

    if (req.body?.amount != null) {
      const amount = parseAmountInput(req.body.amount);
      if (!amount) return res.status(400).json({ error: "Enter the amount as a whole number." });
      set("amount", amount);
    }
    if (req.body?.description != null) {
      const description = String(req.body.description).trim().replace(/\s+/g, " ");
      if (!description || description.length > 180) {
        return res.status(400).json({ error: "Write what the money was for." });
      }
      set("description", description);
    }
    if (req.body?.category != null) {
      const category = String(req.body.category);
      if (!await categoryExists(category)) return res.status(400).json({ error: "That category does not exist." });
      set("category_slug", category);
    }
    if (req.body?.fixed != null) {
      set("fixed", Boolean(req.body.fixed));
    }
    if (req.body?.spentOn != null) {
      const spentOn = String(req.body.spentOn);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) return res.status(400).json({ error: "That date is not valid." });
      set("spent_on", spentOn);
      set("weekend", isWeekendIso(spentOn));
    }

    if (fields.length) {
      values.push(id);
      await pool.query(`update transactions set ${fields.join(", ")} where id = $${values.length}`, values);
    }

    const monthSource = req.body?.spentOn || current.rows[0].spent_on;
    res.json(await loadMonth(String(monthSource).slice(0, 7)));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/transactions/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await pool.query("select to_char(spent_on, 'YYYY-MM') as month from transactions where id = $1", [id]);
    if (!current.rows[0]) return res.status(404).json({ error: "That line is gone." });
    await pool.query("delete from transactions where id = $1", [id]);
    res.json(await loadMonth(current.rows[0].month));
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? "The ledger could not be updated." : error.message });
});

async function waitForDb() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      if (attempt === 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main() {
  await waitForDb();
  await migrate();
  app.listen(3001, "127.0.0.1", () => {
    console.log("API on http://127.0.0.1:3001");
  });
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
