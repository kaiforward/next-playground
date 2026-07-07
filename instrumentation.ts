export async function onRequestError() {
  // Required export — Next.js instrumentation hook
}

export async function register() {
  // Server only (not during build or in Edge runtime)
  if (typeof window === "undefined" && process.env.NEXT_RUNTIME === "nodejs") {
    // Dev-bootstrap: boot a default world so the app is immediately playable.
    // The start screen (new game / load save) supersedes this as the entry
    // point once it exists.
    const { hasWorld, setWorld } = await import("@/lib/world/store");
    if (!hasWorld()) {
      const { generateWorld } = await import("@/lib/world/gen");
      setWorld(generateWorld({ systemCount: 600, seed: 42 }));
    }
  }
}
