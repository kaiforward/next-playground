/**
 * Deep-equal structural sharing over JSON-shaped values — the technique the query layer's
 * structural sharing relied on (`lib/hooks/use-ownership.ts` docstring: "TanStack's structural
 * sharing keeps `data` referentially stable across refetches that return the same [value]"),
 * hand-rolled here because the store (`game-store.ts`) owns this merge itself rather than
 * importing TanStack for it.
 *
 * Where a subtree of `next` is deep-equal to the corresponding subtree of `prev`, the `prev`
 * reference is reused; only genuinely changed subtrees (and their ancestors, since a changed
 * child forces a new parent object) get new identity. This is what lets an unchanged view keep
 * object identity across two applied frames with no worker-side dirty-knowledge (client-runtime
 * spec §2 "Identity stability").
 *
 * Handles plain objects and arrays only — frame payloads are JSON-shaped (no `Map`/`Set`/`Date`).
 * Never throws on `null`/`undefined`/primitives; they compare by `Object.is` and fall through to
 * `next` unchanged.
 *
 * The public signature is generic (`<T>(prev: T, next: T): T`) so every call site keeps its own
 * concrete type; the recursive implementation below is typed over a local JSON-shaped union
 * instead — an overload's implementation signature is independent of its declared call
 * signatures, so this stays free of `any`/`unknown`/`as` while still doing genuinely
 * shape-driven dynamic dispatch, which a deep merge over arbitrary JSON cannot avoid.
 */

type Json = string | number | boolean | null | undefined | Json[] | { [key: string]: Json };

/**
 * `typeof value === "object"` alone is true for a `Date`, `Map`, class instance etc. — walking
 * those as plain objects (iterating enumerable string keys) could compare two structurally
 * similar-but-distinct instances as deep-equal and silently keep a stale reference. The prototype
 * check makes anything that isn't a literal object (`{}`/`Object.create(null)`) fall through as
 * atomic instead: `replaceEqualDeepValue` then only reaches `Object.is`, so on distinct references
 * it takes the safe direction — a fresh identity — never a false "unchanged".
 */
function isPlainObject(value: Json): value is { [key: string]: Json } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function replaceEqualDeepArray(prev: Json[], next: Json[]): Json[] {
  if (prev.length !== next.length) {
    return next.map((item, i) => (i < prev.length ? replaceEqualDeepValue(prev[i], item) : item));
  }
  let changed = false;
  const merged = next.map((item, i) => {
    const mergedItem = replaceEqualDeepValue(prev[i], item);
    if (mergedItem !== prev[i]) changed = true;
    return mergedItem;
  });
  return changed ? merged : prev;
}

function replaceEqualDeepObject(
  prev: { [key: string]: Json },
  next: { [key: string]: Json },
): { [key: string]: Json } {
  const nextKeys = Object.keys(next);
  const prevKeys = Object.keys(prev);
  let changed = nextKeys.length !== prevKeys.length;
  const merged: { [key: string]: Json } = {};
  for (const key of nextKeys) {
    if (!(key in prev)) {
      changed = true;
      merged[key] = next[key];
      continue;
    }
    const mergedValue = replaceEqualDeepValue(prev[key], next[key]);
    if (mergedValue !== prev[key]) changed = true;
    merged[key] = mergedValue;
  }
  return changed ? merged : prev;
}

function replaceEqualDeepValue(prev: Json, next: Json): Json {
  if (Object.is(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) return replaceEqualDeepArray(prev, next);
  if (isPlainObject(prev) && isPlainObject(next)) return replaceEqualDeepObject(prev, next);
  return next;
}

export function replaceEqualDeep<T>(prev: T, next: T): T;
export function replaceEqualDeep(prev: Json, next: Json): Json {
  return replaceEqualDeepValue(prev, next);
}
