/**
 * Browser IndexedDB `SaveBackend` (client-runtime spec §5, build plan Task 12) — the web
 * packaging's implementation of `SaveBackend` (`lib/world/save-backend.ts`). Registered once, at
 * real-Worker boot (`client/worker/entry.ts` — real-Worker-only, never imported by a test), before
 * any save/load/list/export/import command can possibly run, so `getSaveBackend()`'s Node-fallback
 * branch is never reached at runtime in the browser.
 *
 * **Atomic-or-recoverable writes — write-then-swap-key (the interface's own words):** every write
 * commits its blob under a FRESH, never-reused key first, in its own IndexedDB transaction
 * (`writeBlob`, exported as a deliberate test seam — see its docstring). Only once THAT
 * has committed does a second, separate transaction (`swapIndexRecord`) point the save's index
 * record at the new key. If the process dies between those two transactions — tab killed, browser
 * crash — the index record (and therefore every `read()`/`list()`) still names the OLD blob key:
 * nothing was ever observed half-written, the new blob is just orphaned garbage a later successful
 * write's cleanup step removes. This is not a hand-rolled two-phase commit: IndexedDB's own
 * transactions are what make each HALF atomic; the swap between two separate transactions is what
 * makes the WHOLE operation recoverable rather than merely atomic-per-write.
 *
 * **Index-only listing:** `list()` opens only the `index` object store — it never touches `blobs`,
 * so listing costs nothing proportional to save size (saves run 5.8–13 MB, spec §5, Proves 2).
 */
import type { SaveBackend, SaveInfo } from "@/lib/world/save-backend";

const DB_NAME = "stellar-trader-saves";
const DB_VERSION = 1;
const BLOB_STORE = "blobs";
const INDEX_STORE = "index";

interface IndexRecord extends SaveInfo {
  blobKey: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
        if (!db.objectStoreNames.contains(INDEX_STORE)) {
          db.createObjectStore(INDEX_STORE, { keyPath: "name" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open the saves database"));
    });
  }
  return dbPromise;
}

/** Test-only: forces the next `openDatabase()` call to reopen — used when a test swaps
 *  `globalThis.indexedDB` for a fresh fake-indexeddb factory between cases. */
export function resetDatabaseConnectionForTesting(): void {
  dbPromise = null;
}

/**
 * The one seam every `IDBRequest` in this file resolves through. `lib.dom.d.ts` types
 * `IDBObjectStore.get`/`getAll` as `IDBRequest<any>`/`IDBRequest<any[]>` (the store itself carries
 * no value type — IndexedDB isn't typed that way), so every call site below passes the raw request
 * straight in with an explicit `promisifyRequest<T>(...)` type argument and needs no `as` cast:
 * `IDBRequest<any>` is structurally assignable to `IDBRequest<T>` for whatever `T` the caller names.
 */
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Step 1 of write-then-swap-key (module docstring): commits `json` under a fresh blob key, in its
 * own transaction, and returns that key — WITHOUT touching the index. Exported as a deliberate test
 * seam (mirrors `save-files.ts`'s `setSavesDirForTesting`): a test calls this alone, never following
 * it with `swapIndexRecord`, to simulate the exact interrupted-write window Proves 1 names ("value
 * committed, index not") and then asserts `read()`/`list()` still recover the previous good save.
 */
export async function writeBlob(name: string, json: string): Promise<string> {
  const db = await openDatabase();
  const blobKey = `${name}::${crypto.randomUUID()}`;
  const tx = db.transaction(BLOB_STORE, "readwrite");
  tx.objectStore(BLOB_STORE).put(json, blobKey);
  await promisifyTransaction(tx);
  return blobKey;
}

/** Step 2: points `name`'s index record at `blobKey`, in its own transaction, and returns the
 *  PREVIOUS blob key (if any and if different) for the caller to clean up once this has committed. */
async function swapIndexRecord(record: IndexRecord): Promise<string | null> {
  const db = await openDatabase();
  const tx = db.transaction(INDEX_STORE, "readwrite");
  const store = tx.objectStore(INDEX_STORE);
  const existing = await promisifyRequest<IndexRecord | undefined>(store.get(record.name));
  store.put(record);
  await promisifyTransaction(tx);
  return existing && existing.blobKey !== record.blobKey ? existing.blobKey : null;
}

async function deleteBlob(blobKey: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(BLOB_STORE, "readwrite");
  tx.objectStore(BLOB_STORE).delete(blobKey);
  await promisifyTransaction(tx);
}

/** Pulls `tick` out of a save's raw JSON for the index record, tolerantly — an unparseable blob
 *  still gets indexed (mirrors the Node backend's tolerance of a corrupt save file) rather than
 *  failing the whole write. */
function tickFromSaveJson(json: string): number {
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === "object" && parsed !== null && "world" in parsed &&
      typeof parsed.world === "object" && parsed.world !== null && "meta" in parsed.world &&
      typeof parsed.world.meta === "object" && parsed.world.meta !== null &&
      "currentTick" in parsed.world.meta && typeof parsed.world.meta.currentTick === "number"
    ) {
      return parsed.world.meta.currentTick;
    }
  } catch {
    // Falls through to 0 below.
  }
  return 0;
}

async function write(name: string, json: string): Promise<void> {
  const blobKey = await writeBlob(name, json);
  const record: IndexRecord = {
    name,
    tick: tickFromSaveJson(json),
    savedAt: new Date().toISOString(),
    bytes: new Blob([json]).size,
    blobKey,
  };
  const previousBlobKey = await swapIndexRecord(record);
  if (previousBlobKey) {
    // Best-effort cleanup of the now-orphaned old blob — losing this costs storage, not
    // correctness: nothing reads a blob key the index no longer points at.
    await deleteBlob(previousBlobKey).catch(() => {});
  }
}

async function read(name: string): Promise<string> {
  const db = await openDatabase();
  const indexTx = db.transaction(INDEX_STORE, "readonly");
  const index = await promisifyRequest<IndexRecord | undefined>(
    indexTx.objectStore(INDEX_STORE).get(name),
  );
  if (!index) throw new Error(`Save "${name}" not found`);

  const blobTx = db.transaction(BLOB_STORE, "readonly");
  const blob = await promisifyRequest<string | undefined>(
    blobTx.objectStore(BLOB_STORE).get(index.blobKey),
  );
  if (blob === undefined) throw new Error(`Save "${name}" not found`);
  return blob;
}

async function list(): Promise<SaveInfo[]> {
  const db = await openDatabase();
  const tx = db.transaction(INDEX_STORE, "readonly");
  const records = await promisifyRequest<IndexRecord[]>(tx.objectStore(INDEX_STORE).getAll());
  return records.map(({ name, tick, savedAt, bytes }) => ({ name, tick, savedAt, bytes }));
}

async function remove(name: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction([INDEX_STORE, BLOB_STORE], "readwrite");
  const indexStore = tx.objectStore(INDEX_STORE);
  const blobStore = tx.objectStore(BLOB_STORE);
  const existing = await promisifyRequest<IndexRecord | undefined>(indexStore.get(name));
  indexStore.delete(name);
  if (existing) blobStore.delete(existing.blobKey);
  await promisifyTransaction(tx);
}

export const indexedDbSaveBackend: SaveBackend = { write, read, list, remove };

/** Requested once at boot (spec §5) — never blocks boot: fire-and-log only. The browser may grant,
 *  deny, or silently ignore the request; nothing here awaits it before the worker proceeds. */
export function requestPersistentStorage(): void {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
  navigator.storage
    .persist()
    .then((granted) => {
      console.info(`[storage] persistent storage ${granted ? "granted" : "not granted"}`);
    })
    .catch((error) => {
      console.warn("[storage] persistent storage request failed:", error);
    });
}
