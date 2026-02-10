export async function onRequestError() {
  // Required export — Next.js instrumentation hook
}

export async function register() {
  // Only start the tick engine on the server (not during build or in Edge runtime)
  if (typeof window === "undefined" && process.env.NEXT_RUNTIME === "nodejs") {
    const { tickEngine } = await import("@/lib/tick/engine");
    tickEngine.start();
  }
}
