async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    let message = "The ledger could not be updated.";
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {
      message = "The ledger could not be reached.";
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function getBootstrap(month) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return request(`/api/bootstrap${query}`);
}

export function suggest(description) {
  return request(`/api/suggest?description=${encodeURIComponent(description)}`);
}

export function saveIncome(month, amount) {
  return request("/api/income", {
    method: "PUT",
    body: JSON.stringify({ month, amount }),
  });
}

export function createTransaction(payload) {
  return request("/api/transactions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTransaction(id, payload) {
  return request(`/api/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTransaction(id) {
  return request(`/api/transactions/${id}`, { method: "DELETE" });
}

export function createCategory(name, month) {
  return request("/api/categories", {
    method: "POST",
    body: JSON.stringify({ name, month }),
  });
}

export function renameCategory(slug, name, month) {
  return request(`/api/categories/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify({ name, month }),
  });
}

export function openNextMonth(force = false) {
  return request("/api/months", {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}
