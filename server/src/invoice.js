const VERIFY_URL =
  "https://efiskalizimi-app.tatime.gov.al/invoice-check/api/verifyInvoice";

export function parseFiscalQr(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  let params;
  try {
    if (text.includes("://") || text.startsWith("#")) {
      const url = text.includes("://")
        ? new URL(text)
        : new URL(text, "https://efiskalizimi-app.tatime.gov.al/invoice-check/");
      const query = url.hash.includes("?")
        ? url.hash.slice(url.hash.indexOf("?") + 1)
        : url.search.startsWith("?")
          ? url.search.slice(1)
          : url.search;
      params = new URLSearchParams(query);
    } else if (text.includes("iic=") || text.includes("&")) {
      params = new URLSearchParams(text.replace(/^\?/, ""));
    } else {
      return null;
    }
  } catch {
    return null;
  }

  const iic = String(params.get("iic") || "").trim().toUpperCase();
  const tin = String(params.get("tin") || "").trim().toUpperCase();
  const crtd = String(params.get("crtd") || "").trim().replace(" ", "+");
  const prc = String(params.get("prc") || "").trim();
  if (!/^[A-F0-9]{32}$/.test(iic) || !tin || !crtd) return null;

  return { iic, tin, crtd, prc };
}

function toIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function roundLek(value) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function buildDescription(payload, fallbackPrc) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const named = items
    .map((item) => String(item?.name || "").trim())
    .filter(Boolean);
  if (named.length === 1) return named[0].slice(0, 180);
  if (named.length > 1) {
    const extra = named.length - 1;
    return `${named[0]} +${extra} more`.slice(0, 180);
  }
  const seller = String(payload?.seller?.name || "").trim();
  if (seller) return seller.slice(0, 180);
  if (fallbackPrc) return "Fiscal invoice";
  return null;
}

export async function resolveFiscalInvoice(raw) {
  const parsed = parseFiscalQr(raw);
  if (!parsed) {
    const error = new Error(
      "That QR is not a fiscal invoice link from Tatime.",
    );
    error.status = 400;
    throw error;
  }

  const body = new URLSearchParams({
    iic: parsed.iic,
    dateTimeCreated: parsed.crtd,
    tin: parsed.tin,
  });

  let payload = null;
  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    if (response.ok) {
      payload = await response.json();
    }
  } catch {
    payload = null;
  }

  const amount =
    roundLek(payload?.totalPrice)
    ?? roundLek(payload?.totalPriceWithoutVAT)
    ?? roundLek(parsed.prc);

  const description = buildDescription(payload, parsed.prc);
  const spentOn =
    toIsoDate(payload?.dateTimeCreated)
    || toIsoDate(parsed.crtd);

  if (!amount || !description || !spentOn) {
    const error = new Error(
      "Could not read the amount or product from that invoice.",
    );
    error.status = 502;
    throw error;
  }

  const items = (payload?.items || [])
    .map((item) => ({
      name: String(item?.name || "").trim(),
      amount: roundLek(item?.priceAfterVat ?? item?.priceBeforeVat),
      quantity: Number(item?.quantity) || 1,
    }))
    .filter((item) => item.name && item.amount);

  return {
    description,
    amount,
    spentOn,
    seller: payload?.seller?.name || null,
    tin: parsed.tin,
    iic: parsed.iic,
    invoiceNumber: payload?.invoiceNumber || null,
    currency: payload?.currency?.code || "ALL",
    items,
    totalPrice: amount,
    source: payload ? "tatime" : "qr",
  };
}
