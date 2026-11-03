import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCategory,
  createTransaction,
  createUser,
  deleteCurrentUser,
  deleteTransaction,
  getBootstrap,
  getCategoryDefaults,
  getStoredUserId,
  listUsers,
  openNextMonth,
  renameCategory,
  saveIncome,
  saveSiteMoney,
  setStoredUserId,
  suggest,
  updateTransaction,
} from "./api.js";
import {
  countLines,
  defaultDateInMonth,
  formatDay,
  formatMonth,
  formatRunway,
  isWeekend,
  lek,
  monthDayBounds,
  monthPace,
  parseMoney,
  shiftMonth,
  todayIso,
} from "./format.js";

const AVATAR_COLORS = [
  "#9c3b2e",
  "#1e6b45",
  "#355c7d",
  "#6a5428",
  "#9a4d6b",
  "#3d5a62",
];

function avatarColor(id) {
  return AVATAR_COLORS[(Number(id) || 0) % AVATAR_COLORS.length];
}

export default function App() {
  const [users, setUsers] = useState(null);
  const [userId, setUserId] = useState(() => getStoredUserId());
  const [screen, setScreen] = useState("boot");
  const [month, setMonth] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("all");
  const [person, setPerson] = useState("all");
  const [query, setQuery] = useState("");
  const [addTarget, setAddTarget] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loadId, setLoadId] = useState(0);
  const [welcomeName, setWelcomeName] = useState("");

  const currentUser =
    users?.find((user) => user.id === userId) || data?.user || null;

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((payload) => {
        if (cancelled) return;
        const nextUsers = payload.users || [];
        setUsers(nextUsers);
        const stored = getStoredUserId();
        const storedOk = stored && nextUsers.some((user) => user.id === stored);
        if (storedOk) {
          setUserId(stored);
          setScreen("app");
        } else if (nextUsers.length === 1) {
          setStoredUserId(nextUsers[0].id);
          setUserId(nextUsers[0].id);
          setScreen("app");
        } else if (nextUsers.length === 0) {
          setStoredUserId(null);
          setUserId(null);
          setScreen("start");
        } else {
          setStoredUserId(null);
          setUserId(null);
          setScreen("pick");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setScreen("start");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (screen !== "app" || !userId) return undefined;
    let cancelled = false;
    getBootstrap(month)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setError("");
          if (!month && payload.month) setMonth(payload.month);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          if (/pick a user|user is gone/i.test(err.message)) {
            setStoredUserId(null);
            setUserId(null);
            setScreen(users?.length ? "pick" : "start");
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [screen, userId, month, loadId, users]);

  function applyPayload(payload) {
    setData(payload);
    if (payload.month !== month) setMonth(payload.month);
  }

  function selectUser(id) {
    setStoredUserId(id);
    setUserId(id);
    setMonth("");
    setData(null);
    setAddTarget(null);
    setEditingId(null);
    clearFilters();
    setUserMenuOpen(false);
    setSettingsOpen(false);
    setError("");
    setScreen("app");
    setLoadId((value) => value + 1);
  }

  async function onCreateUser(name, net, categories) {
    const payload = await createUser(name, net, categories);
    setUsers(payload.users);
    setStoredUserId(payload.user.id);
    setUserId(payload.user.id);
    setMonth(payload.ledger?.month || "");
    setData(payload.ledger);
    setUserMenuOpen(false);
    setError("");
    setWelcomeName(payload.user.name);
    setScreen("hello");
  }

  function finishWelcome() {
    setWelcomeName("");
    setScreen("app");
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.transactions
      .filter((tx) => {
        if (category !== "all" && tx.category !== category) return false;
        if (person !== "all" && !tx.people.includes(person)) return false;
        if (!needle) return true;
        const haystack =
          `${tx.description} ${tx.people.join(" ")}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice()
      .sort((a, b) => {
        if (a.spentOn !== b.spentOn) return b.spentOn.localeCompare(a.spentOn);
        return b.id - a.id;
      });
  }, [data, category, person, query]);

  const groups = useMemo(() => {
    const next = [];
    for (const tx of filtered) {
      const last = next[next.length - 1];
      if (!last || last.date !== tx.spentOn) {
        next.push({ date: tx.spentOn, items: [tx], total: tx.amount });
      } else {
        last.items.push(tx);
        last.total += tx.amount;
      }
    }
    return next;
  }, [filtered]);

  const visibleSpent = filtered.reduce((sum, tx) => sum + tx.amount, 0);
  const filtersOn =
    category !== "all" || person !== "all" || query.trim() !== "";

  async function onFixedChange(tx, fixed) {
    try {
      applyPayload(await updateTransaction(tx.id, { fixed }));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function onCategoryChange(tx, slug) {
    if (slug === tx.category) return;
    try {
      applyPayload(await updateTransaction(tx.id, { category: slug }));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  function clearFilters() {
    setCategory("all");
    setPerson("all");
    setQuery("");
  }

  function showMonth(key) {
    if (key === month) return;
    setAddTarget(null);
    setEditingId(null);
    clearFilters();
    setData(null);
    setMonth(key);
  }

  async function startAdd(target) {
    if (addTarget === target) {
      setAddTarget(null);
      return;
    }
    if (target === "past") {
      setAddTarget(target);
      return;
    }
    if (target === "open" && data) {
      const todayMonth = todayIso().slice(0, 7);
      if (todayMonth > data.openMonth) {
        const ok = window.confirm(
          `This line starts ${formatMonth(todayMonth)}. ${formatMonth(data.openMonth)} moves to past months, and you can open it from the list.`,
        );
        if (!ok) return;
        try {
          const payload = await openNextMonth();
          clearFilters();
          applyPayload(payload);
          setError("");
        } catch (err) {
          setError(err.message);
          return;
        }
      } else if (data.closed) {
        setData(null);
        setMonth(data.openMonth);
        clearFilters();
      }
    }
    setAddTarget(target);
  }

  async function onNewMonth() {
    if (!data) return;
    const todayMonth = todayIso().slice(0, 7);
    const advancing =
      todayMonth <= data.openMonth && data.count > 0 && !data.closed;
    const target = advancing
      ? shiftMonth(data.openMonth, 1)
      : todayMonth > data.openMonth
        ? todayMonth
        : data.openMonth;
    if (advancing || todayMonth > data.openMonth) {
      const ok = window.confirm(
        `${formatMonth(data.openMonth)} moves to past months. ${formatMonth(target)} starts empty, with the same net until you change it.`,
      );
      if (!ok) return;
    }
    try {
      const payload = await openNextMonth(advancing);
      clearFilters();
      setAddTarget(null);
      applyPayload(payload);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  if (screen === "boot") {
    return (
      <div className="page">
        <p className="loading">Opening…</p>
      </div>
    );
  }

  if (screen === "hello") {
    return (
      <div className="page">
        <HelloScreen name={welcomeName} onDone={finishWelcome} />
      </div>
    );
  }

  if (screen === "start" || screen === "create") {
    return (
      <div className="page">
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <StartPage
          mode={screen === "create" ? "create" : "start"}
          onCancel={
            screen === "create" && users?.length
              ? () => setScreen(userId ? "app" : "pick")
              : null
          }
          onCreated={onCreateUser}
        />
      </div>
    );
  }

  if (screen === "pick") {
    return (
      <div className="page">
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <PickUser
          users={users || []}
          onPick={selectUser}
          onCreate={() => {
            setError("");
            setScreen("create");
          }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="top">
        <div className="top-left">
          {currentUser && (
            <UserMenu
              user={currentUser}
              users={users || []}
              open={userMenuOpen}
              onToggle={() => setUserMenuOpen((value) => !value)}
              onClose={() => setUserMenuOpen(false)}
              onPick={selectUser}
              onCreate={() => {
                setUserMenuOpen(false);
                setError("");
                setScreen("create");
              }}
            />
          )}
          <div className="brand">
            <span>Net</span>
            <small>monthly spending</small>
          </div>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.22-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.4 1.04.72 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.22 1.13-.54 1.63-.94l2.39.96c.23.1.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
              />
            </svg>
          </button>
          <p className="month-label">
            {data
              ? formatMonth(data.month)
              : month
                ? formatMonth(month)
                : "Loading"}
            {data?.closed ? " · past" : ""}
          </p>
          {data?.closed ? (
            <button
              type="button"
              className="btn"
              onClick={() => showMonth(data.openMonth)}
            >
              This month
            </button>
          ) : data && data.count > 0 ? (
            <button type="button" className="btn" onClick={onNewMonth}>
              New month
            </button>
          ) : null}
        </div>
      </header>

      {error && (
        <p className="banner" role="alert">
          {error}{" "}
          {!data && (
            <button
              type="button"
              className="texty"
              onClick={() => setLoadId((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </p>
      )}

      {!data && !error && <p className="loading">Reading the ledger…</p>}

      {data && (
        <>
          <Hero data={data} onSaved={applyPayload} onError={setError} />

          <MonthPulse data={data} />

          {data.insights.length > 0 && (
            <ul className="insights">
              {data.insights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          <div className="layout">
            <aside className="rail">
              <MonthList data={data} onOpen={showMonth} />
              <div className="rail-block">
                <h2>Categories</h2>
                <p className="hint">
                  Grouped from the words on each line. Change a row if a guess
                  is wrong.
                </p>
                <div className="cat-list">
                  {data.categories
                    .filter((item) => item.total > 0)
                    .sort((a, b) => b.total - a.total)
                    .map((item) => {
                      const max = Math.max(
                        ...data.categories.map(
                          (categoryItem) => categoryItem.total,
                        ),
                        1,
                      );
                      const active = category === item.slug;
                      return (
                        <button
                          key={item.slug}
                          type="button"
                          className={active ? "cat on" : "cat"}
                          aria-pressed={active}
                          onClick={() =>
                            setCategory(active ? "all" : item.slug)
                          }
                        >
                          <span
                            className="swatch"
                            style={{ background: item.color }}
                          />
                          <span className="cat-name">
                            {item.name}
                            <small>{item.count}</small>
                          </span>
                          <span className="cat-amt">
                            {lek(item.total)}
                            {data.spent > 0 && (
                              <small>{shareOf(item.total, data.spent)}</small>
                            )}
                          </span>
                          <span className="cat-bar" aria-hidden="true">
                            <i
                              style={{
                                width: `${(item.total / max) * 100}%`,
                                background: item.color,
                              }}
                            />
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>

              {data.people.length > 0 && (
                <div className="rail-block">
                  <h2>Names in the notes</h2>
                  <div className="person-list">
                    {data.people.map((item) => {
                      const active = person === item.name;
                      return (
                        <button
                          key={item.name}
                          type="button"
                          className={active ? "person on" : "person"}
                          aria-pressed={active}
                          onClick={() => setPerson(active ? "all" : item.name)}
                        >
                          <span>{item.name}</span>
                          <strong>{lek(item.total)}</strong>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="split-stats">
                <div>
                  <span>Weekdays</span>
                  <strong>{lek(data.weekday)}</strong>
                </div>
                <div>
                  <span>Weekends</span>
                  <strong>{lek(data.weekend)}</strong>
                </div>
              </div>
            </aside>

            <section className="ledger">
              <div className="ledger-head">
                <div>
                  <h2>Ledger</h2>
                  <p>
                    {filtersOn
                      ? `${countLines(filtered.length)} · ${lek(visibleSpent)}`
                      : `${countLines(data.count)} · ${lek(data.spent)}`}
                  </p>
                </div>
                <div className="ledger-tools">
                  <input
                    type="search"
                    value={query}
                    placeholder="Search kafe, naft…"
                    aria-label="Search expenses"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {filtersOn && (
                    <button
                      type="button"
                      className="btn"
                      onClick={clearFilters}
                    >
                      Clear
                    </button>
                  )}
                  {(!data.closed || data.month === data.pastMonth) && (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => startAdd(data.closed ? "past" : "open")}
                    >
                      {addTarget ? "Close" : "Add expense"}
                    </button>
                  )}
                </div>
              </div>

              {data.closed && data.month === data.pastMonth && (
                <p className="closed-note">
                  {formatMonth(data.month)} is the past month. A line you add
                  here stays in {formatMonth(data.month)}.
                </p>
              )}
              {data.closed && data.month !== data.pastMonth && (
                <p className="closed-note">
                  {formatMonth(data.month)} is only in the list.
                  {data.pastMonth
                    ? ` You can still add a line to ${formatMonth(data.pastMonth)}.`
                    : ""}
                </p>
              )}

              {addTarget && (
                <AddForm
                  key={`${addTarget}-${data.month}`}
                  categories={data.categories}
                  monthKey={addTarget === "past" ? data.month : data.openMonth}
                  onCancel={() => setAddTarget(null)}
                  onSaved={(payload) => {
                    applyPayload(payload);
                    setAddTarget(null);
                  }}
                  onError={setError}
                />
              )}

              {groups.length === 0 && (
                <p className="empty">
                  {data.closed
                    ? "Nothing in this month."
                    : "Nothing in this month yet. A line you add stays here."}
                </p>
              )}

              {groups.map((group) => (
                <section key={group.date} className="day-group">
                  <header className="day">
                    <h3>
                      {formatDay(group.date)}
                      {isWeekend(group.date) && <span>weekend</span>}
                    </h3>
                    <strong>{lek(group.total)}</strong>
                  </header>
                  {group.items.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      categories={data.categories}
                      editing={editingId === tx.id}
                      onEdit={() => setEditingId(tx.id)}
                      onCancel={() => setEditingId(null)}
                      onCategory={(slug) => onCategoryChange(tx, slug)}
                      onFixed={(fixed) => onFixedChange(tx, fixed)}
                      onSaved={(payload) => {
                        applyPayload(payload);
                        setEditingId(null);
                      }}
                      onError={setError}
                    />
                  ))}
                </section>
              ))}
            </section>
          </div>

          <p className="footnote">
            You can correct a date, an amount, or a category on any line.
            Starting a new month clears this page and keeps the old one in Past
            months.
          </p>
        </>
      )}

      {settingsOpen && data && (
        <SettingsModal
          user={currentUser || data.user}
          categories={data.categories}
          month={data.month}
          onClose={() => setSettingsOpen(false)}
          onSaved={(payload) => {
            applyPayload(payload);
            setError("");
          }}
          onDeleted={(nextUsers) => {
            setSettingsOpen(false);
            setUsers(nextUsers);
            setStoredUserId(null);
            setUserId(null);
            setMonth("");
            setData(null);
            setAddTarget(null);
            setEditingId(null);
            clearFilters();
            setError("");
            setScreen(nextUsers.length ? "pick" : "start");
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function shareOf(part, total) {
  const pct = (part / total) * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

function HelloScreen({ name, onDone }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const done = setTimeout(() => onDoneRef.current(), 3000);
    return () => clearTimeout(done);
  }, []);

  return (
    <section className="hello-screen" aria-live="polite">
      <p className="hello-line">
        <span className="hello-word">Hello</span>
        <span className="hello-name">{name}</span>
      </p>
    </section>
  );
}

function StartPage({ mode, onCreated, onCancel }) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState("");
  const [net, setNet] = useState("");
  const [categories, setCategories] = useState([]);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    getCategoryDefaults()
      .then((payload) => {
        setCategories((payload.categories || []).map((item) => ({ ...item })));
      })
      .catch(() => {
        setCategories([]);
      });
  }, []);

  function go(next) {
    setLocalError("");
    setDir(next > step ? 1 : -1);
    setStep(next);
  }

  function onNameNext(event) {
    event.preventDefault();
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (!cleanName) {
      setLocalError("Enter a name.");
      return;
    }
    setName(cleanName);
    go(1);
  }

  function onNetNext(event) {
    event.preventDefault();
    const amount = Number(String(net).replace(/\s/g, ""));
    if (!Number.isInteger(amount) || amount < 0) {
      setLocalError("Enter the net as a whole number.");
      return;
    }
    go(2);
  }

  function renameCategoryDraft(slug, value) {
    setCategories((list) =>
      list.map((item) =>
        item.slug === slug ? { ...item, name: value } : item,
      ),
    );
  }

  function addCategoryDraft(event) {
    event.preventDefault();
    const clean = adding.trim().replace(/\s+/g, " ");
    if (!clean) return;
    if (
      categories.some((item) => item.name.toLowerCase() === clean.toLowerCase())
    ) {
      setLocalError("That category already exists.");
      return;
    }
    const base =
      clean
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "category";
    let slug = base;
    let n = 2;
    while (categories.some((item) => item.slug === slug)) {
      slug = `${base.slice(0, 28)}-${n}`;
      n += 1;
    }
    setCategories((list) => [
      ...list,
      {
        slug,
        name: clean,
        color: AVATAR_COLORS[list.length % AVATAR_COLORS.length],
      },
    ]);
    setAdding("");
    setLocalError("");
  }

  async function onStart(event) {
    event.preventDefault();
    const cleanName = name.trim().replace(/\s+/g, " ");
    const amount = Number(String(net).replace(/\s/g, ""));
    const cleaned = categories
      .map((item) => ({ ...item, name: item.name.trim().replace(/\s+/g, " ") }))
      .filter((item) => item.name);
    if (!cleaned.length) {
      setLocalError("Keep at least one category.");
      return;
    }
    setSaving(true);
    setLocalError("");
    try {
      await onCreated(cleanName, amount, cleaned);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const titles = ["Your name", "Your net", "Your categories"];
  const hints = [
    mode === "create"
      ? "Add another person to the ledger."
      : "This is how you’ll show up on the account.",
    "How much net do you start this month with?",
    "These start as the defaults. Rename any, or add your own. They’re only for this user.",
  ];

  return (
    <section className="start-flow">
      <div className="start-progress" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span key={index} className={index <= step ? "on" : ""} />
        ))}
      </div>
      <div
        key={step}
        className={dir >= 0 ? "start-step in-right" : "start-step in-left"}
      >
        <p className="eyebrow">
          {mode === "create" ? "New user" : "Add your account"}
        </p>
        <h1>{titles[step]}</h1>
        <p className="hint">{hints[step]}</p>

        {step === 0 && (
          <form className="start-form" onSubmit={onNameNext}>
            <label>
              Name
              <input
                value={name}
                autoFocus
                placeholder="Your name"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {localError && (
              <p className="banner" role="alert">
                {localError}
              </p>
            )}
            <div className="editor-actions">
              <button className="btn primary" type="submit">
                Next
              </button>
              {onCancel && (
                <button className="btn" type="button" onClick={onCancel}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}

        {step === 1 && (
          <form className="start-form" onSubmit={onNetNext}>
            <label>
              Net amount
              <input
                value={net}
                autoFocus
                inputMode="numeric"
                placeholder="Your net"
                onChange={(event) => setNet(event.target.value)}
              />
            </label>
            {localError && (
              <p className="banner" role="alert">
                {localError}
              </p>
            )}
            <div className="editor-actions">
              <button className="btn" type="button" onClick={() => go(0)}>
                Back
              </button>
              <button className="btn primary" type="submit">
                Next
              </button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="start-form">
            <div className="start-cat-list">
              {categories.map((item) => (
                <label key={item.slug} className="start-cat">
                  <input
                    aria-label={`Name for ${item.slug}`}
                    value={item.name}
                    onChange={(event) =>
                      renameCategoryDraft(item.slug, event.target.value)
                    }
                  />
                </label>
              ))}
            </div>
            <form className="start-cat-add" onSubmit={addCategoryDraft}>
              <input
                aria-label="New category"
                placeholder="New category"
                value={adding}
                onChange={(event) => setAdding(event.target.value)}
              />
              <button className="btn" type="submit">
                Add
              </button>
            </form>
            {localError && (
              <p className="banner" role="alert">
                {localError}
              </p>
            )}
            <div className="editor-actions">
              <button className="btn" type="button" onClick={() => go(1)}>
                Back
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={saving}
                onClick={onStart}
              >
                {saving ? "Starting…" : "Start"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PickUser({ users, onPick, onCreate }) {
  return (
    <section className="start-flow">
      <div className="start-step in-right">
        <p className="eyebrow">Who is this</p>
        <h1>Pick a user</h1>
        <p className="hint">Each person keeps their own net and lines.</p>
        <div className="user-pick-list">
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              className="user-pick"
              onClick={() => onPick(user.id)}
            >
              <span
                className="avatar"
                style={{ background: avatarColor(user.id) }}
              >
                {user.initial}
              </span>
              <span>{user.name}</span>
            </button>
          ))}
        </div>
        <div className="pick-create">
          <p className="hint">Someone new?</p>
          <button type="button" className="btn primary" onClick={onCreate}>
            Create user
          </button>
        </div>
      </div>
    </section>
  );
}

function UserMenu({ user, users, open, onToggle, onClose, onPick, onCreate }) {
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(event) {
      if (!event.target.closest(".user-menu")) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  return (
    <div className="user-menu">
      <button
        type="button"
        className="avatar-btn"
        aria-label={`${user.name} account menu`}
        aria-expanded={open}
        onClick={onToggle}
        style={{ background: avatarColor(user.id) }}
      >
        {user.initial}
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <p className="user-menu-label">{user.name}</p>
          {users
            .filter((item) => item.id !== user.id)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className="user-menu-item"
                role="menuitem"
                onClick={() => onPick(item.id)}
              >
                <span
                  className="avatar sm"
                  style={{ background: avatarColor(item.id) }}
                >
                  {item.initial}
                </span>
                {item.name}
              </button>
            ))}
          <button
            type="button"
            className="user-menu-item create"
            role="menuitem"
            onClick={onCreate}
          >
            Create user
          </button>
        </div>
      )}
    </div>
  );
}

function MonthPulse({ data }) {
  const fixedSpent = data.transactions.reduce(
    (sum, tx) => sum + (tx.fixed ? tx.amount : 0),
    0,
  );
  const pace = monthPace(
    data.month,
    data.income + (data.site || 0) + (data.carried || 0),
    data.spent - fixedSpent,
    data.remaining,
    data.transactions,
  );
  const previous = [...(data.monthList || [])]
    .filter((item) => item.month < data.month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  return (
    <section className="pulse">
      <div>
        <h2>{pace.closed ? "That month" : "Right now"}</h2>
        <dl className="pulse-metrics">
          {pace.closed ? (
            <>
              <div>
                <dt>Average per day</dt>
                <dd>{lek(pace.avg)}</dd>
              </div>
              <div>
                <dt>Days</dt>
                <dd>{pace.length}</dd>
              </div>
              <div>
                <dt>Left at the end</dt>
                <dd>{lek(data.remaining)}</dd>
              </div>
              <div>
                <dt>Lines</dt>
                <dd>{data.count}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Days left</dt>
                <dd>{pace.daysLeft}</dd>
              </div>
              <div>
                <dt>Safe to spend / day</dt>
                <dd>{lek(pace.safe)}</dd>
              </div>
              <div>
                <dt>Avg daily spend</dt>
                <dd>{lek(pace.avg)}</dd>
              </div>
              <div>
                <dt>Runway</dt>
                <dd>{formatRunway(pace.runway)}</dd>
              </div>
            </>
          )}
        </dl>
        <p className="hint">
          {pace.closed
            ? "The average spreads this month’s spending across every day in it. Fixed payments are left out."
            : "Safe to spend is what’s left, split across the days still in the month, including today. The average uses only the days that have passed, and leaves out fixed payments."}
        </p>
        {previous && (
          <p className="hint">
            {formatMonth(previous.month)} spent {lek(previous.spent)}.{" "}
            {formatMonth(data.month)} is at {lek(data.spent)}.
          </p>
        )}
      </div>
      <div>
        <h2>Left through the month</h2>
        <BalanceChart
          points={pace.points}
          income={data.income + (data.site || 0) + (data.carried || 0)}
        />
      </div>
    </section>
  );
}

function BalanceChart({ points, income }) {
  if (points.length === 0) {
    return (
      <p className="empty">
        The line starts on the first day of the month, from the net.
      </p>
    );
  }
  const width = 640;
  const height = 188;
  const pad = { l: 4, r: 4, t: 16, b: 24 };
  const values = points.map((point) => point.left);
  const max = Math.max(income, ...values, 1);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const xAt = (index) =>
    pad.l + (index / Math.max(points.length - 1, 1)) * (width - pad.l - pad.r);
  const yAt = (value) =>
    pad.t + (1 - (value - min) / span) * (height - pad.t - pad.b);
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)} ${yAt(point.left).toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${xAt(points.length - 1).toFixed(1)} ${yAt(min).toFixed(1)} L${xAt(0).toFixed(1)} ${yAt(min).toFixed(1)} Z`;
  const last = points[points.length - 1];
  const stroke = last.left < 0 ? "#9c3b2e" : "#1e6b45";
  const labels = points.filter(
    (point, index) =>
      index === 0 ||
      index === points.length - 1 ||
      (points.length > 10 && point.day % 7 === 1),
  );
  const summary = `Left started at ${lek(income)} and is ${lek(last.left)} after day ${last.day}.`;

  return (
    <svg
      className="balance-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={summary}
    >
      <path
        d={area}
        fill={last.left < 0 ? "rgba(156,59,46,0.12)" : "rgba(30,107,69,0.14)"}
      />
      {min < 0 && (
        <line
          x1={pad.l}
          x2={width - pad.r}
          y1={yAt(0)}
          y2={yAt(0)}
          stroke="rgba(34,30,24,0.18)"
        />
      )}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {labels.map((point) => {
        const index = point.day - 1;
        return (
          <text
            key={point.day}
            x={xAt(index)}
            y={height - 6}
            textAnchor={
              index === 0
                ? "start"
                : index === points.length - 1
                  ? "end"
                  : "middle"
            }
          >
            {point.day}
          </text>
        );
      })}
    </svg>
  );
}

function Hero({ data, onSaved, onError }) {
  const [open, setOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [value, setValue] = useState(String(data.income));
  const [siteValue, setSiteValue] = useState(String(data.site || 0));
  const [saving, setSaving] = useState(false);
  const site = data.site || 0;
  const pool = data.income + site + (data.carried || 0);
  const ratio = pool > 0 ? Math.min(data.spent / pool, 1) : 0;
  const remaining = data.remaining;

  useEffect(() => {
    setValue(String(data.income));
  }, [data.income]);

  useEffect(() => {
    setSiteValue(String(data.site || 0));
  }, [data.site]);

  async function onSubmit(event) {
    event.preventDefault();
    const amount = Number(String(value).replace(/\s/g, ""));
    if (!Number.isInteger(amount) || amount < 0) {
      onError("Enter the net as a whole number.");
      return;
    }
    setSaving(true);
    try {
      onSaved(await saveIncome(data.month, amount));
      setOpen(false);
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function onSiteSubmit(event) {
    event.preventDefault();
    const amount = Number(String(siteValue).replace(/\s/g, ""));
    if (!Number.isInteger(amount) || amount < 0) {
      onError("Enter the site money as a whole number.");
      return;
    }
    setSaving(true);
    try {
      onSaved(await saveSiteMoney(data.month, amount));
      setSiteOpen(false);
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hero">
      <div>
        <p className="eyebrow">
          {remaining >= 0 ? "Left" : "Over the net"} · {formatMonth(data.month)}
        </p>
        <p className={remaining >= 0 ? "figure huge" : "figure huge negative"}>
          {lek(Math.abs(remaining))}
        </p>
        <p className="sub">of {lek(data.income)} net · amounts in lek</p>
        {site > 0 && (
          <p className="carry">
            + {lek(site)} <span>site money</span>
          </p>
        )}
        {data.carried > 0 && (
          <p className="carry">
            + {lek(data.carried)}
            {data.carriedFrom && (
              <span>still on hand from {formatMonth(data.carriedFrom)}</span>
            )}
          </p>
        )}
        <div
          className="bar"
          role="img"
          aria-label={`${Math.round(ratio * 100)} percent of the net is spent`}
        >
          <span style={{ width: `${ratio * 100}%` }} />
        </div>
        <p className="sub">
          {lek(data.spent)} spent across {countLines(data.count)}
        </p>
        {data.count === 0 &&
          data.income > 0 &&
          data.monthList?.some((item) => !item.open) && (
            <p className="sub">
              Net copied from the previous month. Change it if this month is
              different.
            </p>
          )}
        <div className="income-actions">
          {open ? (
            <form className="income-form" onSubmit={onSubmit}>
              <label>
                Net for {formatMonth(data.month)}
                <input
                  value={value}
                  inputMode="numeric"
                  onChange={(event) => setValue(event.target.value)}
                />
              </label>
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="texty"
              onClick={() => {
                setOpen(true);
                setSiteOpen(false);
              }}
            >
              Edit net
            </button>
          )}
          {siteOpen ? (
            <form className="income-form" onSubmit={onSiteSubmit}>
              <label>
                Site money for {formatMonth(data.month)}
                <input
                  value={siteValue}
                  inputMode="numeric"
                  onChange={(event) => setSiteValue(event.target.value)}
                />
              </label>
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setSiteOpen(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="texty"
              onClick={() => {
                setSiteOpen(true);
                setOpen(false);
              }}
            >
              {site > 0 ? "Edit site money" : "Got site money? Add it"}
            </button>
          )}
        </div>
      </div>
      <dl className="stats">
        <div>
          <dt>Day to day</dt>
          <dd>{lek(data.dayToDay)}</dd>
        </div>
        <div>
          <dt>Money to people</dt>
          <dd>{lek(data.peopleTotal)}</dd>
        </div>
        <div>
          <dt>Fixed</dt>
          <dd>
            {lek(
              data.transactions.reduce(
                (sum, tx) => sum + (tx.fixed ? tx.amount : 0),
                0,
              ),
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function MonthList({ data, onOpen }) {
  const monthList = data.monthList || [];
  const past = monthList.filter((item) => !item.open);
  return (
    <div className="rail-block">
      <h2>Months</h2>
      <p className="hint">
        {past.length
          ? "Past months stay in this list. Open one whenever you want the old lines."
          : "When you add a line in a new month, this month stays in the list."}
      </p>
      <div className="month-list">
        {monthList
          .filter((item) => item.open)
          .map((item) => (
            <button
              key={item.month}
              type="button"
              className={
                data.month === item.month ? "month-link on" : "month-link"
              }
              aria-pressed={data.month === item.month}
              onClick={() => onOpen(item.month)}
            >
              <span>
                {formatMonth(item.month)}
                <small>this month</small>
              </span>
              <strong>{lek(item.spent)}</strong>
            </button>
          ))}
        {past.length > 0 && <p className="past-label">Past months</p>}
        {past.map((item) => (
          <button
            key={item.month}
            type="button"
            className={
              data.month === item.month ? "month-link on" : "month-link"
            }
            aria-pressed={data.month === item.month}
            onClick={() => onOpen(item.month)}
          >
            <span>
              {formatMonth(item.month)}
              <small>{countLines(item.count)}</small>
            </span>
            <strong>{lek(item.spent)}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function AddForm({ categories, monthKey, onCancel, onSaved, onError }) {
  const bounds = monthDayBounds(monthKey);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [spentOn, setSpentOn] = useState(() => defaultDateInMonth(monthKey));
  const [fixed, setFixed] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (touched || !description.trim()) return undefined;
    const handle = setTimeout(() => {
      suggest(description)
        .then((result) => setCategory(result.category))
        .catch(() => {});
    }, 180);
    return () => clearTimeout(handle);
  }, [description, touched]);

  async function onSubmit(event) {
    event.preventDefault();
    const parsed = parseMoney(amount);
    if (!parsed || !description.trim()) {
      onError("Enter an amount and what it was for.");
      return;
    }
    setSaving(true);
    try {
      onSaved(
        await createTransaction({
          amount: parsed,
          description: description.trim(),
          category,
          spentOn,
          fixed,
        }),
      );
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="editor" onSubmit={onSubmit}>
      <p className="hint month-form-note">
        This line is saved in {formatMonth(monthKey)}.
      </p>
      <label>
        Amount
        <input
          value={amount}
          inputMode="numeric"
          placeholder="1500"
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className="grow">
        What it was
        <input
          value={description}
          placeholder="kafe, market, naft…"
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label>
        Category
        <select
          value={category}
          onChange={(event) => {
            setTouched(true);
            setCategory(event.target.value);
          }}
        >
          {categories.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input
          type="date"
          min={bounds.min}
          max={bounds.max}
          value={spentOn}
          onChange={(event) => setSpentOn(event.target.value)}
        />
      </label>
      <label className="fixed-check">
        <input
          type="checkbox"
          checked={fixed}
          onChange={(event) => setFixed(event.target.checked)}
        />
        Fixed payment
      </label>
      <div className="editor-actions">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Add"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TransactionRow({
  tx,
  categories,
  editing,
  onEdit,
  onCancel,
  onCategory,
  onFixed,
  onSaved,
  onError,
}) {
  const color =
    categories.find((item) => item.slug === tx.category)?.color || "#8a8175";
  const [draft, setDraft] = useState({
    amount: String(tx.amount),
    description: tx.description,
    spentOn: tx.spentOn,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({
      amount: String(tx.amount),
      description: tx.description,
      spentOn: tx.spentOn,
    });
  }, [tx.amount, tx.description, tx.spentOn]);

  async function onSubmit(event) {
    event.preventDefault();
    const amount = parseMoney(draft.amount);
    if (!amount || !draft.description.trim()) {
      onError("Enter an amount and what it was for.");
      return;
    }
    setSaving(true);
    try {
      onSaved(
        await updateTransaction(tx.id, {
          amount,
          description: draft.description.trim(),
          spentOn: draft.spentOn,
        }),
      );
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete ${tx.description}?`)) return;
    try {
      onSaved(await deleteTransaction(tx.id));
      onError("");
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <article className="row">
      <div className="row-main">
        <span className="row-mark" style={{ background: color }} />
        <div>
          <h4>{tx.description}</h4>
          <p className="meta">
            {tx.category === "people"
              ? tx.people.map((name) => (
                  <span className="tag" key={name}>
                    {name}
                  </span>
                ))
              : tx.people.map((name) => (
                  <span className="tag" key={name}>
                    with {name}
                  </span>
                ))}
            {tx.fixed && <span className="tag">fixed payment</span>}
          </p>
        </div>
        <div className="row-side">
          <strong className="figure">{lek(tx.amount)}</strong>
          <select
            aria-label={`Category for ${tx.description}`}
            value={tx.category}
            onChange={(event) => onCategory(event.target.value)}
          >
            {categories.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="texty"
            onClick={editing ? onCancel : onEdit}
          >
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>
      {editing && (
        <form className="editor inner" onSubmit={onSubmit}>
          <label>
            Amount
            <input
              value={draft.amount}
              inputMode="numeric"
              onChange={(event) =>
                setDraft({ ...draft, amount: event.target.value })
              }
            />
          </label>
          <label className="grow">
            What it was
            <input
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
          <label>
            Date
            <input
              type="date"
              value={draft.spentOn}
              onChange={(event) =>
                setDraft({ ...draft, spentOn: event.target.value })
              }
            />
          </label>
          <label className="fixed-check">
            <input
              type="checkbox"
              checked={Boolean(tx.fixed)}
              onChange={(event) => onFixed(event.target.checked)}
            />
            Fixed payment
          </label>
          <div className="editor-actions">
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn danger" type="button" onClick={onDelete}>
              Delete
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function SettingsModal({ user, categories, month, onClose, onSaved, onDeleted, onError }) {
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(categories.map((item) => [item.slug, item.name])),
  );
  const [adding, setAdding] = useState("");
  const [savingSlug, setSavingSlug] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDrafts(
      Object.fromEntries(categories.map((item) => [item.slug, item.name])),
    );
  }, [categories]);

  async function saveName(slug) {
    const name = (drafts[slug] || "").trim();
    if (!name) {
      onError("Give the category a name.");
      return;
    }
    setSavingSlug(slug);
    try {
      onSaved(await renameCategory(slug, name, month));
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSavingSlug("");
    }
  }

  async function addCategory(event) {
    event.preventDefault();
    const name = adding.trim();
    if (!name) {
      onError("Give the category a name.");
      return;
    }
    setSavingSlug("new");
    try {
      onSaved(await createCategory(name, month));
      setAdding("");
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSavingSlug("");
    }
  }

  async function onDeleteUser() {
    const label = user?.name || "this user";
    const ok = window.confirm(
      `Delete ${label}? Their net, categories, and lines are removed and cannot be undone.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const payload = await deleteCurrentUser();
      onError("");
      onDeleted(payload.users || []);
    } catch (err) {
      onError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form
        className="modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={addCategory}
      >
        <h2>Settings</h2>
        <p>
          Rename a category, or add one. Fixed payments are marked on the line
          itself, and they stay out of the average per day.
        </p>
        <div className="settings-list">
          {categories.map((item) => {
            const dirty = (drafts[item.slug] || "").trim() !== item.name;
            return (
              <div className="settings-row" key={item.slug}>
                <span className="swatch" style={{ background: item.color }} />
                <input
                  aria-label={`Name for ${item.name}`}
                  value={drafts[item.slug] || ""}
                  onChange={(event) =>
                    setDrafts({ ...drafts, [item.slug]: event.target.value })
                  }
                />
                <button
                  className="btn"
                  type="button"
                  disabled={!dirty || savingSlug === item.slug}
                  onClick={() => saveName(item.slug)}
                >
                  {savingSlug === item.slug ? "Saving…" : "Save"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="settings-row add-row">
          <input
            aria-label="New category"
            placeholder="New category"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
          />
          <button
            className="btn primary"
            type="submit"
            disabled={savingSlug === "new"}
          >
            {savingSlug === "new" ? "Adding…" : "Add"}
          </button>
        </div>
        <div className="settings-danger">
          <p>Delete the signed-in user{user?.name ? ` (${user.name})` : ""}. This removes their ledger.</p>
          <button
            className="btn danger"
            type="button"
            disabled={deleting}
            onClick={onDeleteUser}
          >
            {deleting ? "Deleting…" : "Delete user"}
          </button>
        </div>
        <div className="editor-actions">
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </div>
  );
}
