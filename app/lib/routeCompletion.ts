export function routeStopKey(siteId: string, address: string) {
  return `${siteId.trim().toLowerCase()}|${address.trim().toLowerCase()}`;
}

export function routeCompletionStorageKey(crewId: string, date: string) {
  return `fieldops-route-completed-v1:${crewId.trim().toLowerCase()}:${date}`;
}

export function markRouteStopComplete(crewId: string, date: string, stopKey: string) {
  const storageKey = routeCompletionStorageKey(crewId, date);
  let existing: unknown = [];
  try {
    existing = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as unknown;
  } catch {
    existing = [];
  }
  const completed = Array.isArray(existing) ? existing.map(String) : [];
  if (!completed.includes(stopKey)) completed.push(stopKey);
  window.localStorage.setItem(storageKey, JSON.stringify(completed));
}
