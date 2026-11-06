import { useEffect, useMemo, useRef, useState } from "react";
import { useHexclaveApp } from "@hexclave/react";
import {
  createCategory,
  createTransaction,
  createUser,
  deleteCurrentUser,
  deleteTransaction,
  getBootstrap,
  getCategoryDefaults,
  getSession,
  getStoredUserId,
  openNextMonth,
  renameCategory,
  saveIncome,
  saveSiteMoney,
  scanInvoice,
  setStoredUserId,
  suggest,
  updateTransaction,
} from "./api.js";
import { Html5Qrcode } from "html5-qrcode";
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

const DEFAULT_HERO_PREFS = {
  showNetLine: true,
  showCarry: true,
  showBar: true,
  showSpentLine: true,
  showBreakdown: true,
  showEditLinks: true,
};

const HERO_PREF_OPTIONS = [
  { key: "showNetLine", label: "Income line", hint: "of X income" },
  { key: "showCarry", label: "Carry & money in", hint: "Extra money still on hand" },
  { key: "showBar", label: "Spend bar", hint: "How much of the income is used" },
  { key: "showSpentLine", label: "Spent summary", hint: "Total spent across lines" },
  { key: "showBreakdown", label: "Breakdown", hint: "Day to day, people, fixed" },
  { key: "showEditLinks", label: "Money in", hint: "Add money in on the Home card" },
];

const DEFAULT_SITE_TITLE = "Added money";

const SAVINGS_CATEGORY = {
  slug: "__savings",
  name: "Savings",
  color: "#221e18",
};

function siteEntriesKey(userId, month) {
  return `finance-site-entries:${userId || "anon"}:${month || ""}`;
}

function normalizeSiteEntry(entry, month) {
  return {
    ...entry,
    title: entry.title || DEFAULT_SITE_TITLE,
    amount: Number(entry.amount) || 0,
    date: entry.date || defaultDateInMonth(month),
  };
}

function readSiteEntries(userId, month, fallbackAmount = 0) {
  try {
    const raw = localStorage.getItem(siteEntriesKey(userId, month));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => normalizeSiteEntry(entry, month));
      }
    }
  } catch {
    /* ignore */
  }
  if (fallbackAmount > 0) {
    const seeded = [
      normalizeSiteEntry(
        {
          id: "seed",
          title: DEFAULT_SITE_TITLE,
          amount: fallbackAmount,
          date: defaultDateInMonth(month),
        },
        month,
      ),
    ];
    writeSiteEntries(userId, month, seeded);
    return seeded;
  }
  return [];
}

function writeSiteEntries(userId, month, entries) {
  localStorage.setItem(siteEntriesKey(userId, month), JSON.stringify(entries));
}

function siteEntriesTotal(entries) {
  return entries.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

function addSiteEntry(userId, month, title, amount, date, fallbackAmount = 0) {
  const entries = readSiteEntries(userId, month, fallbackAmount);
  const next = [
    ...entries,
    normalizeSiteEntry(
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: (title || "").trim() || DEFAULT_SITE_TITLE,
        amount,
        date: date || defaultDateInMonth(month),
      },
      month,
    ),
  ];
  writeSiteEntries(userId, month, next);
  return next;
}

function updateSiteEntry(userId, month, entryId, patch, fallbackAmount = 0) {
  const entries = readSiteEntries(userId, month, fallbackAmount);
  const next = entries.map((entry) =>
    entry.id === entryId
      ? normalizeSiteEntry(
          {
            ...entry,
            ...patch,
            title:
              patch.title != null
                ? (patch.title || "").trim() || DEFAULT_SITE_TITLE
                : entry.title,
          },
          month,
        )
      : entry,
  );
  writeSiteEntries(userId, month, next);
  return next;
}

function deleteSiteEntry(userId, month, entryId, fallbackAmount = 0) {
  const entries = readSiteEntries(userId, month, fallbackAmount);
  const next = entries.filter((entry) => entry.id !== entryId);
  writeSiteEntries(userId, month, next);
  return next;
}

function savingsKey(userId) {
  return `finance-savings:${userId || "anon"}`;
}

function normalizeSavingsEntry(entry) {
  return {
    id: entry.id,
    amount: Number(entry.amount) || 0,
    date: entry.date || "",
    direction: entry.direction === "out" ? "out" : "in",
  };
}

function readSavingsEntries(userId) {
  try {
    const raw = localStorage.getItem(savingsKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeSavingsEntry);
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

function writeSavingsEntries(userId, entries) {
  localStorage.setItem(savingsKey(userId), JSON.stringify(entries));
}

function savingsBalance(entries) {
  return entries.reduce((sum, entry) => {
    const amount = Number(entry.amount) || 0;
    return sum + (entry.direction === "out" ? -amount : amount);
  }, 0);
}

function savingsMonthFlow(entries, month) {
  let monthIn = 0;
  let monthOut = 0;
  for (const entry of entries) {
    if (!month || !String(entry.date || "").startsWith(month)) continue;
    const amount = Number(entry.amount) || 0;
    if (entry.direction === "out") monthOut += amount;
    else monthIn += amount;
  }
  return { monthIn, monthOut };
}

function addSavingsTransfer(userId, amount, date, direction, accountLeft = Infinity) {
  const entries = readSavingsEntries(userId);
  const balance = savingsBalance(entries);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Enter a savings amount greater than zero.");
  }
  if (direction === "out" && amount > balance) {
    throw new Error("Not enough in savings.");
  }
  if (direction !== "out" && amount > accountLeft) {
    throw new Error(
      accountLeft <= 0
        ? "Nothing left on the account to move into savings."
        : `You only have ${lek(accountLeft)} left on the account.`,
    );
  }
  const next = [
    ...entries,
    normalizeSavingsEntry({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      amount,
      date,
      direction: direction === "out" ? "out" : "in",
    }),
  ];
  writeSavingsEntries(userId, next);
  return next;
}

function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
      />
    </svg>
  );
}

const GREET_FLAG_KEY = "finance-show-hello";

function markShowHello() {
  try {
    sessionStorage.setItem(GREET_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
}

function consumeShowHello() {
  try {
    const show = sessionStorage.getItem(GREET_FLAG_KEY) === "1";
    if (show) sessionStorage.removeItem(GREET_FLAG_KEY);
    return show;
  } catch {
    return false;
  }
}

function clearShowHello() {
  try {
    sessionStorage.removeItem(GREET_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

function heroPrefsKey(userId) {
  return `finance-hero-prefs:${userId || "anon"}`;
}

function readHeroPrefs(userId) {
  try {
    const raw = localStorage.getItem(heroPrefsKey(userId));
    if (!raw) return { ...DEFAULT_HERO_PREFS };
    return { ...DEFAULT_HERO_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_HERO_PREFS };
  }
}

function writeHeroPrefs(userId, prefs) {
  localStorage.setItem(heroPrefsKey(userId), JSON.stringify(prefs));
}

function TabTitle({ title, copy }) {
  return (
    <header className="tab-hero" key={title}>
      <h1 className="tab-title">
        {title.split(" ").map((word, index) => (
          <span
            key={`${title}-${word}`}
            className="auth-word"
            style={{ animationDelay: `${120 + index * 90}ms` }}
          >
            {word}
          </span>
        ))}
      </h1>
      {copy ? <p className="hint tab-copy">{copy}</p> : null}
    </header>
  );
}

export default function App() {
  const hexclave = useHexclaveApp();
  // Prefer getUser over useUser so auth never re-suspends the tree (that
  // remount was flashing the ledger on every API/token touch).
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
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
  const [scanOpen, setScanOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loadId, setLoadId] = useState(0);
  const [welcomeName, setWelcomeName] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [bootReady, setBootReady] = useState(false);
  const [savingsTick, setSavingsTick] = useState(0);
  const [appTab, setAppTab] = useState("home");
  const [heroPrefs, setHeroPrefs] = useState(() =>
    readHeroPrefs(getStoredUserId()),
  );

  const currentUser =
    users?.find((user) => user.id === userId) || data?.user || null;

  useEffect(() => {
    let cancelled = false;
    hexclave.getUser().then((user) => {
      if (cancelled) return;
      setAuthUser(user);
      setAuthReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hexclave]);

  useEffect(() => {
    if (screen === "app" && currentUser?.name) {
      document.title = `${currentUser.name} · Net`;
    } else {
      document.title = "Net · monthly spending";
    }
  }, [screen, currentUser?.name]);

  useEffect(() => {
    if (!authReady) return undefined;

    if (!authUser) {
      setUsers(null);
      setUserId(null);
      setStoredUserId(null);
      setData(null);
      setMonth("");
      setScreen("auth");
      markShowHello();
      return undefined;
    }

    let cancelled = false;
    getSession()
      .then((payload) => {
        if (cancelled) return;
        const ledgerUser = payload.user || null;
        setUsers(ledgerUser ? [ledgerUser] : []);
        if (ledgerUser) {
          setStoredUserId(ledgerUser.id);
          setUserId(ledgerUser.id);
          // Sign-in redirects reload the page — sessionStorage keeps the greet flag.
          if (consumeShowHello()) {
            setWelcomeName(ledgerUser.name);
            setScreen("hello");
          } else {
            setScreen("app");
          }
        } else {
          setStoredUserId(null);
          setUserId(null);
          setScreen("start");
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
  }, [authReady, authUser?.id]);

  const dataRef = useRef(data);
  dataRef.current = data;
  const fetchedLoadIdRef = useRef(-1);

  useEffect(() => {
    // Prefetch while Hello plays so the ledger is ready when it finishes.
    if ((screen !== "app" && screen !== "hello") || !userId) return undefined;

    const current = dataRef.current;
    const forceReload = loadId !== fetchedLoadIdRef.current;
    // Only skip when we already have this exact user+month loaded.
    // Month is always set after a successful fetch/applyPayload, so empty
    // month means we still need to resolve the open month from the API.
    const alreadyLoaded =
      Boolean(month)
      && current?.user?.id === userId
      && current.month === month;

    if (!forceReload && alreadyLoaded) {
      setError("");
      return undefined;
    }

    let cancelled = false;
    getBootstrap(month)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setError("");
        // Only resolve the initial empty month. Never override a user-selected month
        // (e.g. viewing a past month, then retrying a failed load).
        if (!month && payload.month) setMonth(payload.month);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        if (/sign in|create your ledger|user is gone/i.test(err.message)) {
          setStoredUserId(null);
          setUserId(null);
          setScreen(/sign in/i.test(err.message) ? "auth" : "start");
        }
      })
      .finally(() => {
        if (cancelled) return;
        // Mark this loadId handled on success or error so forceReload stays
        // accurate. Leave it unchanged on cancel so a replacement effect with
        // the same loadId can still fetch when data is missing.
        fetchedLoadIdRef.current = loadId;
      });
    return () => {
      cancelled = true;
    };
  }, [screen, userId, month, loadId]);

  function applyPayload(payload) {
    setData(payload);
    if (payload.month !== month) setMonth(payload.month);
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
    clearShowHello();
    setWelcomeName(payload.user.name);
    setScreen("hello");
  }

  function finishWelcome() {
    setWelcomeName("");
    clearShowHello();
    setScreen("app");
  }

  async function onSignIn() {
    setAuthBusy(true);
    setError("");
    markShowHello();
    try {
      await hexclave.redirectToSignIn();
    } catch (err) {
      setError(err.humanReadableMessage || err.message || "Could not open sign in.");
      setAuthBusy(false);
    }
  }

  async function onSignUp() {
    setAuthBusy(true);
    setError("");
    markShowHello();
    try {
      await hexclave.redirectToSignUp();
    } catch (err) {
      setError(err.humanReadableMessage || err.message || "Could not open sign up.");
      setAuthBusy(false);
    }
  }

  async function onSignOut() {
    setAuthBusy(true);
    setError("");
    try {
      await authUser.signOut();
      markShowHello();
      setAuthUser(null);
      setStoredUserId(null);
      setUserId(null);
      setUsers(null);
      setData(null);
      setMonth("");
      setUserMenuOpen(false);
      setScreen("auth");
    } catch (err) {
      setError(err.humanReadableMessage || err.message || "Could not sign out.");
    } finally {
      setAuthBusy(false);
    }
  }

  useEffect(() => {
    setHeroPrefs(readHeroPrefs(userId));
  }, [userId]);

  function updateHeroPref(key, value) {
    setHeroPrefs((current) => {
      const next = { ...current, [key]: value };
      writeHeroPrefs(userId, next);
      return next;
    });
  }

  async function onAccountSettings() {
    setAuthBusy(true);
    setError("");
    setUserMenuOpen(false);
    try {
      await hexclave.redirectToAccountSettings();
    } catch (err) {
      setError(
        err.humanReadableMessage || err.message || "Could not open account settings.",
      );
      setAuthBusy(false);
    }
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

  const filtersOn =
    category !== "all" || person !== "all" || query.trim() !== "";

  const siteEntries = useMemo(() => {
    if (!data) return [];
    return readSiteEntries(userId, data.month, data.site || 0);
  }, [data, userId, data?.month, data?.site]);

  const savingsEntries = useMemo(
    () => readSavingsEntries(userId),
    [userId, savingsTick],
  );

  const savingsFlow = useMemo(
    () => savingsMonthFlow(savingsEntries, data?.month),
    [savingsEntries, data?.month],
  );

  const savingsTotal = useMemo(
    () => Math.max(0, savingsBalance(savingsEntries)),
    [savingsEntries],
  );

  const savingsMonthDeposits = useMemo(() => {
    if (!data?.month) return [];
    return savingsEntries.filter(
      (entry) =>
        entry.direction !== "out" &&
        String(entry.date || "").startsWith(data.month),
    );
  }, [savingsEntries, data?.month]);

  const displayCategories = useMemo(() => {
    if (!data) return [];
    const base = data.categories.map((item) => ({ ...item }));
    if (savingsTotal > 0) {
      base.push({
        ...SAVINGS_CATEGORY,
        total: savingsTotal,
        count: savingsMonthDeposits.length || 1,
      });
    }
    return base;
  }, [data, savingsTotal, savingsMonthDeposits.length]);

  const categorySpent = (data?.spent || 0) + savingsTotal;

  const effectiveRemaining = data
    ? data.remaining - savingsFlow.monthIn + savingsFlow.monthOut
    : 0;

  const savingsOnly = category === SAVINGS_CATEGORY.slug;

  const ledgerDays = useMemo(() => {
    const byDate = new Map();
    for (const group of groups) {
      byDate.set(group.date, {
        date: group.date,
        items: group.items,
        moneyIn: [],
        savingsIn: [],
        total: group.total,
      });
    }
    const showExtras = !filtersOn || savingsOnly;
    if (showExtras) {
      if (!savingsOnly) {
        for (const entry of siteEntries) {
          const date = entry.date || defaultDateInMonth(data?.month);
          let day = byDate.get(date);
          if (!day) {
            day = { date, items: [], moneyIn: [], savingsIn: [], total: 0 };
            byDate.set(date, day);
          }
          day.moneyIn.push(entry);
        }
      }
      for (const entry of savingsEntries) {
        const date = entry.date || defaultDateInMonth(data?.month);
        if (data?.month && !String(date).startsWith(data.month)) continue;
        if (savingsOnly && entry.direction === "out") continue;
        let day = byDate.get(date);
        if (!day) {
          day = { date, items: [], moneyIn: [], savingsIn: [], total: 0 };
          byDate.set(date, day);
        }
        if (entry.direction === "out") {
          day.moneyIn.push({
            ...entry,
            title: "From savings",
            kind: "savings-out",
          });
        } else {
          day.savingsIn.push(entry);
          day.total += Number(entry.amount) || 0;
        }
      }
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [
    groups,
    siteEntries,
    savingsEntries,
    filtersOn,
    savingsOnly,
    data?.month,
  ]);

  const visibleSpent = savingsOnly
    ? savingsTotal
    : filtered.reduce((sum, tx) => sum + tx.amount, 0);

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

  const openMonthKey = data && !data.closed ? data.openMonth : "";
  const monthAdvanceRef = useRef("");

  useEffect(() => {
    if (screen !== "app" || !openMonthKey) return undefined;
    const todayMonth = todayIso().slice(0, 7);
    if (todayMonth <= openMonthKey) return undefined;
    if (monthAdvanceRef.current === openMonthKey) return undefined;
    monthAdvanceRef.current = openMonthKey;

    let cancelled = false;
    (async () => {
      try {
        const payload = await openNextMonth();
        if (cancelled) return;
        clearFilters();
        setAddTarget(null);
        applyPayload(payload);
        setError("");
      } catch (err) {
        if (!cancelled) {
          monthAdvanceRef.current = "";
          setError(err.message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [screen, openMonthKey]);

  if (
    !bootReady
    || screen === "boot"
    || (screen === "app" && !data && !error)
  ) {
    return <BootScreen onReady={() => setBootReady(true)} />;
  }

  if (screen === "auth") {
    return (
      <div className="page">
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <AuthGate
          busy={authBusy}
          onSignIn={onSignIn}
          onSignUp={onSignUp}
        />
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
          defaultName={authUser?.displayName || ""}
          onCancel={
            screen === "create"
              ? () => setScreen(userId ? "app" : "start")
              : null
          }
          onCreated={onCreateUser}
          onSignOut={onSignOut}
        />
      </div>
    );
  }

  if (!data && !error) {
    return <BootScreen onReady={() => setBootReady(true)} />;
  }

  const canAdd =
    data && (!data.closed || data.month === data.pastMonth);

  return (
    <div className="page page-app">
      <header className={data?.closed ? "top top-past" : "top"}>
        <div className="top-left">
          {currentUser && (
            <UserMenu
              user={currentUser}
              authLabel={authUser?.primaryEmail || authUser?.displayName || ""}
              open={userMenuOpen}
              busy={authBusy}
              onToggle={() => setUserMenuOpen((value) => !value)}
              onClose={() => setUserMenuOpen(false)}
              onAccountSettings={onAccountSettings}
              onSignOut={onSignOut}
            />
          )}
          <div className="brand">
            <span>Net</span>
            <small>{currentUser?.name ? currentUser.name : "monthly spending"}</small>
          </div>
        </div>

        <nav className="app-nav" aria-label="Main">
          {[
            {
              id: "home",
              label: "Home",
              icon: (
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 3.2 3.5 10.4V21h6.2v-6.2h4.6V21h6.2V10.4L12 3.2zm0 2.5 6.3 5.3V19h-2.6v-6.2H8.3V19H5.7v-8L12 5.7z"
                  />
                </svg>
              ),
            },
            {
              id: "expenses",
              label: "Expenses",
              icon: (
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h14V5H5zm3 3h8v2H8V8zm0 4h8v2H8v-2zm0 4h5v2H8v-2z"
                  />
                </svg>
              ),
            },
            {
              id: "config",
              label: "Config",
              icon: (
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.22-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.4 1.04.72 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.22 1.13-.54 1.63-.94l2.39.96c.23.1.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
                  />
                </svg>
              ),
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={appTab === tab.id ? "app-nav-item on" : "app-nav-item"}
              aria-label={tab.label}
              aria-current={appTab === tab.id ? "page" : undefined}
              onClick={() => setAppTab(tab.id)}
            >
              <span className="app-nav-icon">{tab.icon}</span>
              <span className="app-nav-label">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="top-actions">
          {canAdd && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Scan fiscal QR"
              onClick={() => setScanOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M3 3h7v2H5v5H3V3zm11 0h7v7h-2V5h-5V3zM3 14h2v5h5v2H3v-7zm16 0h2v7h-7v-2h5v-5zM7 7h4v4H7V7zm6 0h4v4h-4V7zM7 13h4v4H7v-4zm6 3h1v1h-1v-1zm2-3h1v1h-1v-1zm0 2h1v1h-1v-1zm2-2h1v4h-1v-4z"
                />
              </svg>
            </button>
          )}
          <p className="month-label month-label-inline">
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
              className="btn top-this-month"
              onClick={() => showMonth(data.openMonth)}
            >
              This month
            </button>
          ) : null}
          {canAdd && appTab !== "config" && (
            <button
              type="button"
              className="btn primary add-expense-top"
              aria-label={addTarget ? "Close" : "Add expense"}
              onClick={() => startAdd(data.closed ? "past" : "open")}
            >
              {addTarget ? "×" : "+"}
            </button>
          )}
        </div>

        {data?.closed && (
          <div className="top-month-bar">
            <p className="month-label">
              {formatMonth(data.month)} · past
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => showMonth(data.openMonth)}
            >
              This month
            </button>
          </div>
        )}
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

      {data && appTab === "home" && (
        <section className="tab-panel">
          <TabTitle title="Home" />
          <Hero
            data={data}
            userId={userId}
            prefs={heroPrefs}
            remaining={effectiveRemaining}
            spentExtra={savingsFlow.monthIn - savingsFlow.monthOut}
            onSaved={applyPayload}
            onError={setError}
          />
          <MonthPulse data={data} remaining={effectiveRemaining} />
          {data.insights.length > 0 && (
            <ul className="insights">
              {data.insights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className="home-aside">
            <div className="split-stats">
              <div>
                <span>Weekdays</span>
                <strong className="figure">{lek(data.weekday)}</strong>
              </div>
              <div>
                <span>Weekends</span>
                <strong className="figure">{lek(data.weekend)}</strong>
              </div>
            </div>
            <CategoryPie
              userId={userId}
              categories={displayCategories}
              spent={categorySpent}
              active={category}
              onSelect={(slug) =>
                setCategory((current) => (current === slug ? "all" : slug))
              }
            />
          </div>
          {canAdd && (
            <div className="home-add">
              <button
                type="button"
                className="btn primary"
                onClick={() => startAdd(data.closed ? "past" : "open")}
              >
                {addTarget ? "Close" : "Add expense"}
              </button>
            </div>
          )}
        </section>
      )}

      {data && appTab === "expenses" && (
        <section className="tab-panel">
          <TabTitle
            title="Expenses"
            copy="Every line this month. Filter, search, or open a past month."
          />
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
                  {displayCategories
                    .filter((item) => item.total > 0)
                    .sort((a, b) => b.total - a.total)
                    .map((item) => {
                      const max = Math.max(
                        ...displayCategories.map(
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
                            <span className="figure">{lek(item.total)}</span>
                            {categorySpent > 0 && (
                              <small>
                                {shareOf(item.total, categorySpent)}
                              </small>
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
                          <strong className="figure">{lek(item.total)}</strong>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </aside>

            <section className="ledger">
              <div className="ledger-head">
                <div>
                  <h2>Ledger</h2>
                  <p>
                    {savingsOnly
                      ? `${countLines(savingsMonthDeposits.length)} · ${lek(visibleSpent)}`
                      : filtersOn
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
                  {canAdd && (
                    <button
                      type="button"
                      className="btn primary add-expense-ledger"
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

              {ledgerDays.length === 0 && (
                <p className="empty">
                  {data.closed
                    ? "Nothing in this month."
                    : "Nothing in this month yet. A line you add stays here."}
                </p>
              )}

              {ledgerDays.map((day) => (
                <section key={day.date} className="day-group">
                  <header className="day">
                    <h3>
                      {formatDay(day.date)}
                      {isWeekend(day.date) && <span>weekend</span>}
                    </h3>
                    <strong className="figure">{lek(day.total)}</strong>
                  </header>
                  {day.moneyIn.map((entry) =>
                    entry.kind === "savings-out" ? (
                      <SavingsLedgerRow
                        key={`savings-out-${entry.id}`}
                        entry={entry}
                        direction="out"
                      />
                    ) : (
                      <MoneyInRow
                        key={entry.id}
                        entry={entry}
                        userId={userId}
                        month={data.month}
                        currentTotal={data.site || 0}
                        editing={editingId === `money-in:${entry.id}`}
                        onEdit={() => setEditingId(`money-in:${entry.id}`)}
                        onCancel={() => setEditingId(null)}
                        onSaved={(payload) => {
                          applyPayload(payload);
                          setEditingId(null);
                        }}
                        onError={setError}
                      />
                    ),
                  )}
                  {day.savingsIn.map((entry) => (
                    <SavingsLedgerRow
                      key={`savings-in-${entry.id}`}
                      entry={entry}
                      direction="in"
                    />
                  ))}
                  {day.items.map((tx) => (
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
        </section>
      )}

      {data && appTab === "config" && (
        <section className="tab-panel">
          <TabTitle
            title="Config"
            copy="Tune the home card, rename categories, or remove this ledger."
          />
          <ConfigPanel
            user={currentUser || data.user}
            userId={userId}
            categories={data.categories}
            month={data.month}
            income={data.income}
            remaining={effectiveRemaining}
            heroPrefs={heroPrefs}
            savingsEntries={savingsEntries}
            onSavingsChange={() => setSavingsTick((value) => value + 1)}
            onHeroPref={updateHeroPref}
            onSaved={(payload) => {
              applyPayload(payload);
              setError("");
            }}
            onDeleted={async () => {
              setUsers([]);
              setStoredUserId(null);
              setUserId(null);
              setMonth("");
              setData(null);
              setAddTarget(null);
              setEditingId(null);
              clearFilters();
              setError("");
              await onSignOut();
            }}
            onError={setError}
          />
        </section>
      )}

      {addTarget && data && (
        <AddExpenseModal
          key={`${addTarget}-${data.month}`}
          categories={data.categories}
          monthKey={addTarget === "past" ? data.month : data.openMonth}
          onClose={() => setAddTarget(null)}
          onSaved={(payload) => {
            applyPayload(payload);
            setAddTarget(null);
          }}
          onError={setError}
        />
      )}

      {scanOpen && data && (
        <ScanInvoiceModal
          categories={data.categories}
          monthKey={data.closed ? data.month : data.openMonth}
          onClose={() => setScanOpen(false)}
          onSaved={(payload) => {
            applyPayload(payload);
            setScanOpen(false);
            setError("");
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

function polar(cx, cy, radius, angleDeg) {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
}

function pieSlicePath(cx, cy, radius, startAngle, endAngle) {
  const sweep = endAngle - startAngle;
  if (sweep >= 359.999) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`;
  }
  const [x1, y1] = polar(cx, cy, radius, startAngle);
  const [x2, y2] = polar(cx, cy, radius, endAngle);
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
}

function pieOpenStorageKey(userId) {
  return `finance-pie-open:${userId || "anon"}`;
}

function readPieOpen(userId) {
  const raw = localStorage.getItem(pieOpenStorageKey(userId));
  if (raw == null) return true;
  return raw === "1";
}

function CategoryPie({ userId, categories, spent, active, onSelect }) {
  const [open, setOpen] = useState(() => readPieOpen(userId));

  useEffect(() => {
    setOpen(readPieOpen(userId));
  }, [userId]);

  const slices = (categories || [])
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
  if (!slices.length || spent <= 0) return null;

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 78;
  let angle = 0;
  const arcs = slices.map((item) => {
    const portion = item.total / spent;
    const sweep = portion * 360;
    const start = angle;
    const end = angle + sweep;
    const mid = start + sweep / 2;
    angle = end;
    const [lx, ly] = polar(cx, cy, radius * 0.62, mid);
    return { ...item, start, end, mid, portion, lx, ly, showLabel: portion >= 0.08 };
  });

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(pieOpenStorageKey(userId), next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className={open ? "rail-block category-pie" : "rail-block category-pie folded"}>
      <button
        type="button"
        className="pie-toggle"
        aria-expanded={open}
        aria-controls="category-pie-body"
        onClick={toggleOpen}
      >
        <h2>Spending by category</h2>
        <span className="pie-chevron" aria-hidden="true" />
      </button>
      <div className="pie-body" id="category-pie-body">
        <p className="hint">{"Share of this month's spending."}</p>
        <svg
          className="pie-chart"
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="Spending by category"
        >
          {arcs.map((item) => {
            const selected = active === item.slug;
            return (
              <path
                key={item.slug}
                d={pieSlicePath(cx, cy, radius, item.start, item.end)}
                fill={item.color}
                className={selected ? "pie-slice on" : "pie-slice"}
                onClick={() => onSelect(item.slug)}
              >
                <title>
                  {item.name}: {lek(item.total)} ({shareOf(item.total, spent)})
                </title>
              </path>
            );
          })}
          {arcs
            .filter((item) => item.showLabel)
            .map((item) => (
              <text
                key={`${item.slug}-label`}
                x={item.lx}
                y={item.ly}
                className="pie-label"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {shareOf(item.total, spent)}
              </text>
            ))}
        </svg>
        <ul className="pie-legend">
          {arcs.map((item) => {
            const selected = active === item.slug;
            return (
              <li key={item.slug}>
                <button
                  type="button"
                  className={selected ? "pie-legend-item on" : "pie-legend-item"}
                  onClick={() => onSelect(item.slug)}
                >
                  <span className="swatch" style={{ background: item.color }} />
                  <span className="pie-legend-name">{item.name}</span>
                  <span className="pie-legend-pct">{shareOf(item.total, spent)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function BootScreen({ onReady }) {
  const word = "Net";
  const [count, setCount] = useState(0);
  const [fading, setFading] = useState(false);
  const readySentRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  useEffect(() => {
    if (reduceMotion) {
      setCount(word.length);
      return undefined;
    }
    if (count >= word.length) return undefined;
    const id = setTimeout(() => setCount((value) => value + 1), 340);
    return () => clearTimeout(id);
  }, [count, reduceMotion, word.length]);

  useEffect(() => {
    if (count < word.length || readySentRef.current) return undefined;

    if (reduceMotion) {
      readySentRef.current = true;
      onReadyRef.current?.();
      return undefined;
    }

    const hold = setTimeout(() => setFading(true), 700);
    const done = setTimeout(() => {
      readySentRef.current = true;
      onReadyRef.current?.();
    }, 700 + 1100);
    return () => {
      clearTimeout(hold);
      clearTimeout(done);
    };
  }, [count, reduceMotion, word.length]);

  return (
    <div className="boot-screen" aria-busy="true" aria-label="Loading Net">
      <p className={fading ? "boot-type fading" : "boot-type"}>
        <span className="boot-type-text">{word.slice(0, count)}</span>
        {!fading && <span className="boot-cursor" aria-hidden="true" />}
      </p>
    </div>
  );
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

const AUTH_ROTATE_WORDS = ["ledger", "spending", "month"];

function AuthGate({ busy, onSignIn, onSignUp }) {
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setWordIndex((value) => (value + 1) % AUTH_ROTATE_WORDS.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, []);

  const rotateWord = AUTH_ROTATE_WORDS[wordIndex];

  return (
    <section className="start-flow auth-gate">
      <div className="auth-gate-inner">
        <p className="eyebrow auth-gate-eyebrow">Net</p>
        <h1 className="auth-title">
          <span className="auth-title-line">
            {"Sign in to your".split(" ").map((word, index) => (
              <span
                key={word}
                className="auth-word"
                style={{ animationDelay: `${120 + index * 90}ms` }}
              >
                {word}
              </span>
            ))}
          </span>
          <span className="auth-title-line auth-title-rotate-line">
            <span className="auth-rotate" key={rotateWord}>
              {rotateWord}
            </span>
          </span>
        </h1>
        <p className="hint auth-gate-copy">
          Create an account or sign in with email, Google, or GitHub. Your
          spending stays private to you.
        </p>
        <div className="editor-actions auth-gate-actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={onSignIn}
          >
            {busy ? "Opening…" : "Sign in"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onSignUp}
          >
            Create account
          </button>
        </div>
      </div>
    </section>
  );
}

function StartPage({ mode, defaultName = "", onCreated, onCancel, onSignOut }) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState(defaultName);
  const [net, setNet] = useState("");
  const [categories, setCategories] = useState([]);
  const [editingSlug, setEditingSlug] = useState("");
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (defaultName && !name) setName(defaultName);
  }, [defaultName]);

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
      setLocalError("Enter the income as a whole number.");
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

  const titles = ["Your name", "Your income", "Your categories"];
  const hints = [
    "This is how you’ll show up on your ledger.",
    "How much income do you start this month with?",
    "These start as the defaults. Rename any, or add your own.",
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
          {mode === "create" ? "Set up ledger" : "Welcome"}
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
              {onSignOut && (
                <button className="btn" type="button" onClick={onSignOut}>
                  Sign out
                </button>
              )}
            </div>
          </form>
        )}

        {step === 1 && (
          <form className="start-form" onSubmit={onNetNext}>
            <label>
              Income amount
              <input
                value={net}
                autoFocus
                inputMode="numeric"
                placeholder="Your income"
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
            <div className="config-cat-grid start-cat-grid">
              {categories.map((item, index) => {
                const editing = editingSlug === item.slug;
                return (
                  <div
                    className={
                      editing ? "config-cat-card editing" : "config-cat-card"
                    }
                    key={item.slug}
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    <span
                      className="swatch"
                      style={{ background: item.color }}
                    />
                    {editing ? (
                      <input
                        aria-label={`Name for ${item.name}`}
                        value={item.name}
                        autoFocus
                        onChange={(event) =>
                          renameCategoryDraft(item.slug, event.target.value)
                        }
                      />
                    ) : (
                      <strong className="config-cat-name">{item.name}</strong>
                    )}
                    <div className="config-cat-actions">
                      {editing ? (
                        <button
                          className="btn"
                          type="button"
                          disabled={!item.name.trim()}
                          onClick={() => setEditingSlug("")}
                        >
                          Save
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-btn pen-btn"
                          aria-label={`Edit ${item.name}`}
                          onClick={() => setEditingSlug(item.slug)}
                        >
                          <PenIcon />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <form
              className="settings-row add-row config-cat-add"
              onSubmit={addCategoryDraft}
            >
              <input
                aria-label="New category"
                placeholder="New category"
                value={adding}
                onChange={(event) => setAdding(event.target.value)}
              />
              <button className="btn primary" type="submit">
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

function UserMenu({
  user,
  authLabel,
  open,
  busy,
  onToggle,
  onClose,
  onAccountSettings,
  onSignOut,
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(event) {
      if (!event.target.closest(".user-menu")) onClose();
    }
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const color = avatarColor(user.id);

  return (
    <div className={open ? "user-menu open" : "user-menu"}>
      <button
        type="button"
        className="avatar-btn"
        aria-label={`${user.name} account menu`}
        aria-expanded={open}
        onClick={onToggle}
        style={{ background: color }}
      >
        {user.initial}
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-head">
            <span className="avatar" style={{ background: color }}>
              {user.initial}
            </span>
            <div className="user-menu-meta">
              <strong>{user.name}</strong>
              {authLabel ? <span>{authLabel}</span> : null}
            </div>
          </div>
          <div className="user-menu-divider" />
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            disabled={busy}
            onClick={onAccountSettings}
          >
            <span className="user-menu-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path
                  fill="currentColor"
                  d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.2 0-8 2.1-8 4.7V21h16v-2.3c0-2.6-3.8-4.7-8-4.7z"
                />
              </svg>
            </span>
            Account settings
          </button>
          <div className="user-menu-divider" />
          <button
            type="button"
            className="user-menu-item danger"
            role="menuitem"
            disabled={busy}
            onClick={onSignOut}
          >
            <span className="user-menu-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path
                  fill="currentColor"
                  d="M10 4v2h8v12h-8v2h10V4H10zm-1.3 5.3L6.4 12l2.3 2.7-1.4 1.2L3.6 12l3.7-3.9 1.4 1.2z"
                />
              </svg>
            </span>
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function MonthPulse({ data, remaining, spentExtra = 0 }) {
  const fixedSpent = data.transactions.reduce(
    (sum, tx) => sum + (tx.fixed ? tx.amount : 0),
    0,
  );
  const left = remaining ?? data.remaining;
  const pace = monthPace(
    data.month,
    data.income + (data.site || 0) + (data.carried || 0),
    data.spent - fixedSpent + spentExtra,
    left,
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
                <dd className="figure">{lek(pace.avg)}</dd>
              </div>
              <div>
                <dt>Days</dt>
                <dd className="figure">{pace.length}</dd>
              </div>
              <div>
                <dt>Left at the end</dt>
                <dd className="figure">{lek(left)}</dd>
              </div>
              <div>
                <dt>Lines</dt>
                <dd className="figure">{data.count}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Days left</dt>
                <dd className="figure">{pace.daysLeft}</dd>
              </div>
              <div>
                <dt>Safe to spend / day</dt>
                <dd className="figure">{lek(pace.safe)}</dd>
              </div>
              <div>
                <dt>Avg daily spend</dt>
                <dd className="figure">{lek(pace.avg)}</dd>
              </div>
              <div>
                <dt>Runway</dt>
                <dd className="figure">{formatRunway(pace.runway)}</dd>
              </div>
            </>
          )}
        </dl>
        <p className="hint">
          {pace.closed
            ? "Average per day this month, not counting fixed payments or savings moves."
            : "Safe to spend splits what’s left across the days still ahead. Average ignores fixed payments and savings moves."}
        </p>
        {previous && (
          <p className="hint">
            {formatMonth(previous.month)} {lek(previous.spent)} →{" "}
            {formatMonth(data.month)} {lek(data.spent)}.
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
        The line starts on the first day of the month, from the income.
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

function SiteMoneyForm({
  userId,
  month,
  currentTotal = 0,
  onSaved,
  onError,
  onCancel,
}) {
  const bounds = monthDayBounds(month);
  const [title, setTitle] = useState(DEFAULT_SITE_TITLE);
  const [siteValue, setSiteValue] = useState("");
  const [spentOn, setSpentOn] = useState(() => defaultDateInMonth(month));
  const [saving, setSaving] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    const parsed = Number(String(siteValue).replace(/\s/g, ""));
    if (!Number.isInteger(parsed) || parsed <= 0) {
      onError("Enter a money-in amount greater than zero.");
      return;
    }
    if (!title.trim()) {
      onError("Give this money-in a title.");
      return;
    }
    setSaving(true);
    try {
      const entries = addSiteEntry(
        userId,
        month,
        title,
        parsed,
        spentOn,
        currentTotal,
      );
      const total = siteEntriesTotal(entries);
      onSaved(await saveSiteMoney(month, total));
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="site-money-form" onSubmit={onSubmit}>
      <label className="site-money-title">
        <span>Title</span>
        <input
          value={title}
          placeholder={DEFAULT_SITE_TITLE}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="site-money-amount">
        <span>Amount</span>
        <input
          value={siteValue}
          inputMode="numeric"
          placeholder="5000"
          onChange={(event) => setSiteValue(event.target.value)}
        />
      </label>
      <label className="site-money-date">
        <span>Date</span>
        <input
          type="date"
          min={bounds.min}
          max={bounds.max}
          value={spentOn}
          onChange={(event) => setSpentOn(event.target.value)}
        />
      </label>
      <div className="site-money-actions">
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

function Hero({
  data,
  userId,
  prefs = DEFAULT_HERO_PREFS,
  remaining: remainingProp,
  spentExtra = 0,
  onSaved,
  onError,
}) {
  const [siteOpen, setSiteOpen] = useState(false);
  const site = data.site || 0;
  const pool = data.income + site + (data.carried || 0);
  const spent = data.spent + spentExtra;
  const ratio = pool > 0 ? Math.min(spent / pool, 1) : 0;
  const remaining = remainingProp ?? data.remaining;
  const showMoneyIn = prefs.showEditLinks || siteOpen;

  return (
    <section className={prefs.showBreakdown ? "hero" : "hero hero-solo"}>
      <div>
        <p className="eyebrow">
          {remaining >= 0 ? "Left" : "Over budget"} · {formatMonth(data.month)}
        </p>
        <p className={remaining >= 0 ? "figure huge" : "figure huge negative"}>
          {lek(Math.abs(remaining))}
        </p>
        {prefs.showNetLine && (
          <p className="sub">of {lek(data.income)} income</p>
        )}
        {prefs.showCarry && site > 0 && (
          <p className="carry">
            + {lek(site)}
            <span className="carry-sep" aria-hidden="true">
              ·
            </span>
            <span className="carry-label">{DEFAULT_SITE_TITLE}</span>
          </p>
        )}
        {prefs.showCarry && data.carried > 0 && (
          <p className="carry">
            + {lek(data.carried)}
            {data.carriedFrom && (
              <>
                <span className="carry-sep" aria-hidden="true">
                  ·
                </span>
                <span className="carry-label">
                  still on hand from {formatMonth(data.carriedFrom)}
                </span>
              </>
            )}
          </p>
        )}
        {prefs.showBar && (
          <div
            className="bar"
            role="img"
            aria-label={`${Math.round(ratio * 100)} percent of the income is spent`}
          >
            <span style={{ width: `${ratio * 100}%` }} />
          </div>
        )}
        {prefs.showSpentLine && (
          <p className="sub">
            {lek(spent)} spent across {countLines(data.count)}
          </p>
        )}
        {prefs.showEditLinks &&
          data.count === 0 &&
          data.income > 0 &&
          data.monthList?.some((item) => !item.open) && (
            <p className="sub">
              Income copied from the previous month. Change it in Config if this
              month is different.
            </p>
          )}
        {showMoneyIn && !siteOpen && prefs.showEditLinks && (
          <div className="income-actions">
            <button
              type="button"
              className="texty money-in-cta"
              onClick={() => setSiteOpen(true)}
            >
              Add money in
            </button>
          </div>
        )}
        {siteOpen && (
          <SiteMoneyForm
            userId={userId}
            month={data.month}
            currentTotal={site}
            onSaved={(payload) => {
              onSaved(payload);
              setSiteOpen(false);
            }}
            onError={onError}
            onCancel={() => setSiteOpen(false)}
          />
        )}
      </div>
      {prefs.showBreakdown && (
        <dl className="stats">
          <div>
            <dt>Day to day</dt>
            <dd className="figure">{lek(data.dayToDay)}</dd>
          </div>
          <div>
            <dt>Money to people</dt>
            <dd className="figure">{lek(data.peopleTotal)}</dd>
          </div>
          <div>
            <dt>Fixed</dt>
            <dd className="figure">
              {lek(
                data.transactions.reduce(
                  (sum, tx) => sum + (tx.fixed ? tx.amount : 0),
                  0,
                ),
              )}
            </dd>
          </div>
        </dl>
      )}
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
              <strong className="figure">{lek(item.spent)}</strong>
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
            <strong className="figure">{lek(item.spent)}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function clampDateToMonth(iso, monthKey) {
  const bounds = monthDayBounds(monthKey);
  if (!iso) return defaultDateInMonth(monthKey);
  if (iso < bounds.min) return bounds.min;
  if (iso > bounds.max) return bounds.max;
  return iso;
}

function ScanInvoiceModal({ categories, monthKey, onClose, onSaved, onError }) {
  const [phase, setPhase] = useState("scan");
  const [paste, setPaste] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [camError, setCamError] = useState("");
  const [camKey, setCamKey] = useState(0);
  const [draft, setDraft] = useState(null);
  const scannerRef = useRef(null);
  const handledRef = useRef(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event) {
      if (event.key === "Escape" && !saving && !loading) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, saving, loading]);

  useEffect(() => {
    if (phase !== "scan") return undefined;
    handledRef.current = false;
    let scanner;
    let cancelled = false;

    (async () => {
      try {
        scanner = new Html5Qrcode("fiscal-qr-reader", { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 8,
            qrbox: { width: 220, height: 220 },
            aspectRatio: 1,
          },
          async (decoded) => {
            if (handledRef.current || cancelled) return;
            handledRef.current = true;
            try {
              await scanner.stop();
            } catch {
              /* already stopped */
            }
            await lookup(decoded);
          },
        );
        if (!cancelled) {
          setCamError("");
          try {
            await scanner.applyVideoConstraints({
              advanced: [{ zoom: 2 }],
            });
          } catch {
            /* hardware zoom unsupported — CSS crop still zooms the view */
          }
        }
      } catch (err) {
        if (!cancelled) {
          setCamError(
            err?.message?.includes("Permission")
              ? "Camera permission is needed, or paste the invoice link below."
              : "Camera is unavailable here. Paste the invoice link below.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      const active = scannerRef.current;
      scannerRef.current = null;
      if (active?.isScanning) {
        active.stop().catch(() => {});
      }
    };
  }, [phase, camKey]);

  async function lookup(raw) {
    setLoading(true);
    setCamError("");
    try {
      const invoice = await scanInvoice(raw);
      setDraft({
        description: invoice.description,
        amount: String(invoice.amount),
        category: invoice.category || "other",
        spentOn: clampDateToMonth(invoice.spentOn, monthKey),
        seller: invoice.seller,
        invoiceNumber: invoice.invoiceNumber,
        items: invoice.items || [],
      });
      setPhase("review");
      onError("");
    } catch (err) {
      handledRef.current = false;
      setPhase("scan");
      setCamKey((value) => value + 1);
      setCamError(err.message);
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const parsed = parseMoney(draft.amount);
    if (!parsed || !draft.description.trim()) {
      onError("Enter an amount and what it was for.");
      return;
    }
    setSaving(true);
    try {
      onSaved(
        await createTransaction({
          amount: parsed,
          description: draft.description.trim(),
          category: draft.category,
          spentOn: draft.spentOn,
          fixed: false,
        }),
      );
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const bounds = monthDayBounds(monthKey);

  return (
    <div className="modal-back add-back" onClick={() => !loading && !saving && onClose()}>
      <div
        className="modal add-sheet scan-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-invoice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="add-sheet-head">
          <h2 id="scan-invoice-title">
            {phase === "review" ? "Confirm expense" : "Scan fiscal QR"}
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            disabled={loading || saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {phase === "scan" && (
          <div className="scan-body">
            <p className="hint scan-hint-mobile">
              Point the camera at the QR on a Tatime fiscal invoice.
            </p>
            <p className="hint scan-hint-desktop">
              Point the camera at the QR on a Tatime fiscal invoice, or paste
              the verify link.
            </p>
            <div id="fiscal-qr-reader" className="scan-camera" key={camKey} />
            {loading && <p className="hint">Reading invoice…</p>}
            {camError && (
              <p className="banner" role="alert">
                {camError}
              </p>
            )}
            <label className="scan-paste">
              Invoice link
              <textarea
                rows={3}
                value={paste}
                placeholder="https://efiskalizimi-app.tatime.gov.al/invoice-check/#/verify?iic=…"
                onChange={(event) => setPaste(event.target.value)}
              />
            </label>
            <div className="editor-actions">
              <button
                className="btn primary scan-paste-action"
                type="button"
                disabled={loading || !paste.trim()}
                onClick={() => lookup(paste)}
              >
                {loading ? "Reading…" : "Read link"}
              </button>
              <button className="btn" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase === "review" && draft && (
          <form className="editor add-form" onSubmit={onSubmit}>
            {draft.seller && (
              <p className="hint month-form-note">From {draft.seller}</p>
            )}
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
              Category
              <select
                value={draft.category}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value })
                }
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
                value={draft.spentOn}
                onChange={(event) =>
                  setDraft({ ...draft, spentOn: event.target.value })
                }
              />
            </label>
            {draft.items?.length > 1 && (
              <ul className="scan-items">
                {draft.items.map((item, index) => (
                  <li key={`${item.name}-${index}`}>
                    <span>{item.name}</span>
                    <strong>{lek(item.amount)}</strong>
                  </li>
                ))}
              </ul>
            )}
            <div className="editor-actions">
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Add to ledger"}
              </button>
              <button
                className="btn"
                type="button"
                disabled={saving}
                onClick={() => {
                  setDraft(null);
                  setCamKey((value) => value + 1);
                  setPhase("scan");
                }}
              >
                Scan again
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function AddExpenseModal({ categories, monthKey, onClose, onSaved, onError }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="modal-back add-back" onClick={onClose}>
      <div
        className="modal add-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-expense-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="add-sheet-head">
          <h2 id="add-expense-title">Add expense</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <AddForm
          categories={categories}
          monthKey={monthKey}
          onCancel={onClose}
          onSaved={onSaved}
          onError={onError}
        />
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
    <form className="editor add-form" onSubmit={onSubmit}>
      <p className="hint month-form-note">
        This line is saved in {formatMonth(monthKey)}.
      </p>
      <label>
        Amount
        <input
          value={amount}
          inputMode="numeric"
          placeholder="1500"
          autoFocus
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
      <div className="editor-actions">
        <label className="fixed-check fixed-check-inline">
          <input
            type="checkbox"
            checked={fixed}
            onChange={(event) => setFixed(event.target.checked)}
          />
          Fixed
        </label>
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

function SavingsLedgerRow({ entry, direction }) {
  const isOut = direction === "out";
  return (
    <article className={isOut ? "row money-in savings-row" : "row savings-row"}>
      <div className="row-main">
        <span
          className={
            isOut ? "row-mark money-in-mark" : "row-mark savings-in-mark"
          }
        />
        <div>
          <h4>{isOut ? "From savings" : "To savings"}</h4>
          <p className="meta">
            <span className="tag">{isOut ? "savings out" : "savings in"}</span>
            <span className="savings-arrow" aria-hidden="true">
              {isOut ? "←" : "→"}
            </span>
          </p>
        </div>
        <div className="row-side">
          <strong className={isOut ? "figure money-in-amt" : "figure"}>
            {isOut ? `+ ${lek(entry.amount)}` : lek(entry.amount)}
          </strong>
        </div>
      </div>
    </article>
  );
}

function MoneyInRow({
  entry,
  userId,
  month,
  currentTotal,
  editing,
  onEdit,
  onCancel,
  onSaved,
  onError,
}) {
  const bounds = monthDayBounds(month);
  const [draft, setDraft] = useState({
    title: entry.title,
    amount: String(entry.amount),
    date: entry.date,
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDraft({
      title: entry.title,
      amount: String(entry.amount),
      date: entry.date,
    });
  }, [entry.title, entry.amount, entry.date]);

  async function onSubmit(event) {
    event.preventDefault();
    const amount = Number(String(draft.amount).replace(/\s/g, ""));
    if (!Number.isInteger(amount) || amount <= 0) {
      onError("Enter a money-in amount greater than zero.");
      return;
    }
    if (!draft.title.trim()) {
      onError("Give this money-in a title.");
      return;
    }
    setSaving(true);
    try {
      const entries = updateSiteEntry(
        userId,
        month,
        entry.id,
        {
          title: draft.title,
          amount,
          date: draft.date,
        },
        currentTotal,
      );
      onSaved(await saveSiteMoney(month, siteEntriesTotal(entries)));
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteEntry() {
    setDeleting(true);
    try {
      const entries = deleteSiteEntry(
        userId,
        month,
        entry.id,
        currentTotal,
      );
      onSaved(await saveSiteMoney(month, siteEntriesTotal(entries)));
      onError("");
      setConfirmDelete(false);
    } catch (err) {
      onError(err.message);
      setDeleting(false);
    }
  }

  return (
    <article className="row money-in">
      <div className="row-main">
        <span className="row-mark money-in-mark" />
        <div>
          <h4>{entry.title}</h4>
          <p className="meta">
            <span className="tag">money in</span>
          </p>
        </div>
        <div className="row-side">
          <strong className="figure money-in-amt">+ {lek(entry.amount)}</strong>
          <button
            type="button"
            className="icon-btn pen-btn"
            aria-label={editing ? "Close editor" : "Edit money in"}
            onClick={editing ? onCancel : onEdit}
          >
            {editing ? "×" : <PenIcon />}
          </button>
        </div>
      </div>
      {editing && (
        <form className="editor inner" onSubmit={onSubmit}>
          <label className="grow">
            Title
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
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
          <label>
            Date
            <input
              type="date"
              min={bounds.min}
              max={bounds.max}
              value={draft.date}
              onChange={(event) =>
                setDraft({ ...draft, date: event.target.value })
              }
            />
          </label>
          <div className="editor-actions">
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              className="btn danger"
              type="button"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          </div>
        </form>
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete money in"
          message={`Delete ${entry.title}? This cannot be undone.`}
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          busy={deleting}
          onConfirm={confirmDeleteEntry}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </article>
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

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmDeleteTx() {
    setDeleting(true);
    try {
      onSaved(await deleteTransaction(tx.id));
      onError("");
      setConfirmDelete(false);
    } catch (err) {
      onError(err.message);
      setDeleting(false);
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
            className="icon-btn pen-btn"
            aria-label={editing ? "Close editor" : "Edit line"}
            onClick={editing ? onCancel : onEdit}
          >
            {editing ? "×" : <PenIcon />}
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
          <div className="editor-actions">
            <label className="fixed-check fixed-check-inline">
              <input
                type="checkbox"
                checked={Boolean(tx.fixed)}
                onChange={(event) => onFixed(event.target.checked)}
              />
              Fixed
            </label>
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              className="btn danger"
              type="button"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          </div>
        </form>
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete line"
          message={`Delete ${tx.description}? This cannot be undone.`}
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          busy={deleting}
          onConfirm={confirmDeleteTx}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </article>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onCancel]);

  return (
    <div className="modal-back confirm-back" onClick={() => !busy && onCancel()}>
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="editor-actions confirm-actions">
          <button
            className="btn danger"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigPanel({
  user,
  userId,
  categories,
  month,
  income,
  remaining = 0,
  heroPrefs,
  savingsEntries = [],
  onSavingsChange,
  onHeroPref,
  onSaved,
  onDeleted,
  onError,
}) {
  const bounds = monthDayBounds(month);
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(categories.map((item) => [item.slug, item.name])),
  );
  const [editingSlug, setEditingSlug] = useState("");
  const [adding, setAdding] = useState("");
  const [savingSlug, setSavingSlug] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [incomeValue, setIncomeValue] = useState(String(income ?? 0));
  const [incomeSaving, setIncomeSaving] = useState(false);
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [savingsAmount, setSavingsAmount] = useState("");
  const [savingsDate, setSavingsDate] = useState(() =>
    defaultDateInMonth(month),
  );
  const [savingsSource, setSavingsSource] = useState("account");
  const [savingsSaving, setSavingsSaving] = useState(false);
  const [savingsHistoryOpen, setSavingsHistoryOpen] = useState(false);

  const savingsTotal = savingsBalance(savingsEntries);
  const accountLeft = Math.max(0, Number(remaining) || 0);
  const savingsHistory = [...savingsEntries].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    String(b.id).localeCompare(String(a.id)),
  );
  const savingsHistoryLimit = 5;
  const savingsHistoryVisible = savingsHistoryOpen
    ? savingsHistory
    : savingsHistory.slice(0, savingsHistoryLimit);

  useEffect(() => {
    setIncomeValue(String(income ?? 0));
  }, [income]);

  useEffect(() => {
    setSavingsDate(defaultDateInMonth(month));
  }, [month]);

  useEffect(() => {
    setDrafts(
      Object.fromEntries(categories.map((item) => [item.slug, item.name])),
    );
  }, [categories]);

  function onSavingsSubmit(event) {
    event.preventDefault();
    const amount = Number(String(savingsAmount).replace(/\s/g, ""));
    const direction = savingsSource === "savings" ? "out" : "in";
    setSavingsSaving(true);
    try {
      addSavingsTransfer(userId, amount, savingsDate, direction, accountLeft);
      setSavingsAmount("");
      setSavingsOpen(false);
      setSavingsSource("account");
      onSavingsChange?.();
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setSavingsSaving(false);
    }
  }

  async function saveName(slug) {
    const name = (drafts[slug] || "").trim();
    if (!name) {
      onError("Give the category a name.");
      return;
    }
    setSavingSlug(slug);
    try {
      onSaved(await renameCategory(slug, name, month));
      setEditingSlug("");
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

  async function confirmDeleteUser() {
    setDeleting(true);
    try {
      const payload = await deleteCurrentUser();
      onError("");
      onDeleted(payload.users || []);
    } catch (err) {
      onError(err.message);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function onIncomeSubmit(event) {
    event.preventDefault();
    const amount = Number(String(incomeValue).replace(/\s/g, ""));
    if (!Number.isInteger(amount) || amount < 0) {
      onError("Enter the income as a whole number.");
      return;
    }
    setIncomeSaving(true);
    try {
      onSaved(await saveIncome(month, amount));
      setIncomeOpen(false);
      onError("");
    } catch (err) {
      onError(err.message);
    } finally {
      setIncomeSaving(false);
    }
  }

  const label = user?.name || "this user";

  return (
    <>
      <section className="config-block config-enter">
        <h2>Income</h2>
        <p className="hint">
          Monthly income for {formatMonth(month)}. This is the base of your
          Left card.
        </p>
        {incomeOpen ? (
          <form className="income-form income-form-inline" onSubmit={onIncomeSubmit}>
            <label>
              Income amount
              <input
                value={incomeValue}
                inputMode="numeric"
                autoFocus
                onChange={(event) => setIncomeValue(event.target.value)}
              />
            </label>
            <button className="btn primary" type="submit" disabled={incomeSaving}>
              {incomeSaving ? "Saving…" : "Save"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setIncomeOpen(false);
                setIncomeValue(String(income ?? 0));
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="config-income-row">
            <strong className="figure config-income-amt">{lek(income || 0)}</strong>
            <button
              type="button"
              className="icon-btn pen-btn"
              aria-label="Edit income"
              onClick={() => setIncomeOpen(true)}
            >
              <PenIcon />
            </button>
          </div>
        )}
      </section>

      <section
        className="config-block config-enter"
        style={{ animationDelay: "40ms" }}
      >
        <h2>Savings</h2>
        <p className="hint">
          Record a move: take from the account into savings, or transfer savings
          back. Deposits leave Left; transfers back show up as money in.
        </p>
        {savingsOpen ? (
          <form className="savings-form" onSubmit={onSavingsSubmit}>
            <label>
              Amount
              <input
                value={savingsAmount}
                inputMode="numeric"
                placeholder="5000"
                autoFocus
                onChange={(event) => setSavingsAmount(event.target.value)}
              />
            </label>
            <label>
              From
              <select
                className={
                  savingsSource === "savings"
                    ? "savings-source out"
                    : "savings-source in"
                }
                value={savingsSource}
                onChange={(event) => setSavingsSource(event.target.value)}
                aria-label="Move from account or savings"
              >
                <option value="account">Account → savings</option>
                <option value="savings">Savings → account</option>
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                min={bounds.min}
                max={bounds.max}
                value={savingsDate}
                onChange={(event) => setSavingsDate(event.target.value)}
              />
            </label>
            <button
              className="btn primary"
              type="submit"
              disabled={savingsSaving}
            >
              {savingsSaving ? "Saving…" : "Save"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setSavingsOpen(false);
                setSavingsAmount("");
                setSavingsSource("account");
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="config-income-row">
            <strong className="figure config-income-amt">
              {lek(savingsTotal)}
            </strong>
            <button
              type="button"
              className="icon-btn pen-btn"
              aria-label="Add savings move"
              onClick={() => setSavingsOpen(true)}
            >
              <PenIcon />
            </button>
          </div>
        )}
        {savingsHistory.length === 0 ? (
          <p className="hint savings-empty">No savings moves yet.</p>
        ) : (
          <>
            <ul className="savings-list">
              {savingsHistoryVisible.map((entry) => (
                <li key={entry.id} className="savings-list-item">
                  <span className="savings-list-date">
                    {formatDay(entry.date)}
                  </span>
                  <span className="savings-list-flow">
                    {entry.direction === "out"
                      ? "Savings → account"
                      : "Account → savings"}
                  </span>
                  <span
                    className={
                      entry.direction === "out"
                        ? "savings-list-amt out"
                        : "savings-list-amt in"
                    }
                  >
                    {lek(entry.amount)}
                  </span>
                </li>
              ))}
            </ul>
            {savingsHistory.length > savingsHistoryLimit && (
              <button
                type="button"
                className="texty savings-more"
                onClick={() => setSavingsHistoryOpen((value) => !value)}
              >
                {savingsHistoryOpen
                  ? "Show less"
                  : `Read more (${savingsHistory.length - savingsHistoryLimit})`}
              </button>
            )}
          </>
        )}
      </section>

      <section className="config-block config-enter" style={{ animationDelay: "80ms" }}>
        <h2>Home card</h2>
        <p className="hint">
          Choose what stays on the Left card. The big remaining amount always
          stays.
        </p>
        <div className="config-widgets">
          {HERO_PREF_OPTIONS.map((option, index) => {
            const on = Boolean(heroPrefs[option.key]);
            return (
              <button
                key={option.key}
                type="button"
                className={on ? "config-widget on" : "config-widget"}
                style={{ animationDelay: `${80 + index * 60}ms` }}
                aria-pressed={on}
                onClick={() => onHeroPref(option.key, !on)}
              >
                <span className="config-widget-check" aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
                <span className="config-widget-copy">
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <form
        className="config-block config-enter"
        style={{ animationDelay: "200ms" }}
        onSubmit={addCategory}
      >
        <h2>Categories</h2>
        <p className="hint">
          Rename a category, or add one. Fixed payments are marked on the line
          itself, and they stay out of the average per day.
        </p>
        <div className="config-cat-grid">
          {categories.map((item, index) => {
            const dirty = (drafts[item.slug] || "").trim() !== item.name;
            const editing = editingSlug === item.slug;
            return (
              <div
                className={editing ? "config-cat-card editing" : "config-cat-card"}
                key={item.slug}
                style={{ animationDelay: `${240 + index * 40}ms` }}
              >
                <span className="swatch" style={{ background: item.color }} />
                {editing ? (
                  <input
                    aria-label={`Name for ${item.name}`}
                    value={drafts[item.slug] || ""}
                    autoFocus
                    onChange={(event) =>
                      setDrafts({ ...drafts, [item.slug]: event.target.value })
                    }
                  />
                ) : (
                  <strong className="config-cat-name">{item.name}</strong>
                )}
                <div className="config-cat-actions">
                  {editing ? (
                    <button
                      className="btn"
                      type="button"
                      disabled={!dirty || savingSlug === item.slug}
                      onClick={() => saveName(item.slug)}
                    >
                      {savingSlug === item.slug ? "…" : "Save"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn pen-btn"
                      aria-label={`Edit ${item.name}`}
                      onClick={() => setEditingSlug(item.slug)}
                    >
                      <PenIcon />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="settings-row add-row config-cat-add">
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
      </form>

      <div
        className="settings-danger config-enter"
        style={{ animationDelay: "320ms" }}
      >
        <div className="settings-danger-copy">
          <h3>Remove this ledger</h3>
          <p>
            Wipe{user?.name ? ` ${user.name}'s` : " this"} income, categories,
            and every line for good. You’ll land back at sign-in after.
          </p>
        </div>
        <button
          className="btn danger"
          type="button"
          disabled={deleting}
          onClick={() => setConfirmDelete(true)}
        >
          {deleting ? "Deleting…" : "Delete user"}
        </button>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete user"
          message={`Delete ${label}? Their income, categories, and lines are removed and cannot be undone.`}
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          busy={deleting}
          onConfirm={confirmDeleteUser}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
