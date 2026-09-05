import { describe, expect, it } from "vitest";
import { createInterestRegistry } from "../interest";
import type { InterestSet } from "@/lib/runtime/channel";

function recorder() {
  const posts: InterestSet[] = [];
  return { posts, post: (interest: InterestSet) => posts.push(interest) };
}

describe("createInterestRegistry", () => {
  it("mounting the system panel posts a set containing its id; unmounting posts one without it", () => {
    // Stands in for the system panel's mount/unmount: `register` is what a panel's mount effect
    // calls, and the returned release function is what its cleanup calls.
    const { posts, post } = recorder();
    const registry = createInterestRegistry(post);

    const release = registry.register("system", "sys-a");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ systems: ["sys-a"], factions: [], goods: [], lanes: [] });

    release();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ systems: [], factions: [], goods: [], lanes: [] });
  });

  it("mounting the lane card posts a set containing its key; unmounting posts one without it", () => {
    const { posts, post } = recorder();
    const registry = createInterestRegistry(post);

    const release = registry.register("lane", "sys-a|sys-b");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ systems: [], factions: [], goods: [], lanes: ["sys-a|sys-b"] });

    release();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ systems: [], factions: [], goods: [], lanes: [] });
  });

  it("two registrants of one id collapse to one entry, present until both release", () => {
    const { posts, post } = recorder();
    const registry = createInterestRegistry(post);

    const releaseA = registry.register("system", "sys-a");
    const releaseB = registry.register("system", "sys-a");
    // The second registration is a no-op on the posted set — still just one entry — so it must not
    // post again.
    expect(posts).toHaveLength(1);

    releaseA();
    // One registrant remains, so the id is still held — releasing the first must not post either.
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ systems: ["sys-a"], factions: [], goods: [], lanes: [] });

    releaseB();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ systems: [], factions: [], goods: [], lanes: [] });
  });

  it("an id change on a mounted panel posts a set with the new id and without the old", () => {
    // Route navigation between systems: the panel's effect releases the old id and registers the
    // new one. The FINAL posted set is what has to hold the new id and lack the old one.
    const { posts, post } = recorder();
    const registry = createInterestRegistry(post);

    const releaseOld = registry.register("system", "sys-a");
    releaseOld();
    registry.register("system", "sys-b");

    const last = posts[posts.length - 1];
    expect(last.systems).toContain("sys-b");
    expect(last.systems).not.toContain("sys-a");
  });

  it("an identical resulting set is never re-posted (no post storm on re-render)", () => {
    const { posts, post } = recorder();
    const registry = createInterestRegistry(post);

    const releaseA = registry.register("system", "sys-a");
    const countAfterFirst = posts.length;
    // A second register/release pair for a DIFFERENT id that nets back to the same held set must
    // not post a duplicate of a set already posted.
    const releaseB = registry.register("good", "ore");
    releaseB();
    expect(posts.length).toBe(countAfterFirst + 2); // grew, then shrank back — both are net changes

    // Re-registering the exact same (kind, id) pair while it's already held is the true no-op case.
    const releaseA2 = registry.register("system", "sys-a");
    expect(posts.length).toBe(countAfterFirst + 2);
    releaseA2();
    expect(posts.length).toBe(countAfterFirst + 2);
    releaseA();
  });

  it("calling a release function twice is a no-op the second time (review finding 4)", () => {
    // A broken guard would double-decrement the ref count, starving a still-open second registrant.
    const { posts, post } = recorder();
    const registry = createInterestRegistry(post);

    registry.register("system", "sys-a"); // two registrants of the same id
    const release = registry.register("system", "sys-a");
    const postsAfterRegister = posts.length;

    release();
    const postsAfterFirstRelease = posts.length;
    // First release: two registrants -> one remains, id still held, no net change, no post.
    expect(postsAfterFirstRelease).toBe(postsAfterRegister);

    release(); // calling it again must not double-decrement past the remaining registrant
    expect(posts.length).toBe(postsAfterFirstRelease); // still no post — count is unchanged, not gone
    const last = posts[posts.length - 1];
    expect(last.systems).toContain("sys-a"); // the id is still held, proving the count wasn't zeroed
  });

  it("a goods-only session posts exactly the grow/shrink pair, no spurious extras (review finding 5)", () => {
    // Exercises sameSet's systems comparison with `systems` empty on BOTH sides throughout, including
    // a re-registration that leaves goods unchanged too — the only shape that reaches
    // `a.systems.every(...)` with a real vacuous-truth decision to make (a goods-length mismatch
    // short-circuits sameSet before `systems.every` runs on every other step here). If that `every`
    // ever flipped to `some`, `[].some(...)` on the empty systems arrays would read as "different"
    // and this no-op re-registration would wrongly post again.
    const { posts, post } = recorder();
    const registry = createInterestRegistry(post);

    const releaseFirst = registry.register("good", "ore");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ systems: [], factions: [], goods: ["ore"], lanes: [] });

    const releaseSecond = registry.register("good", "ore"); // no-op: same good, already held
    expect(posts).toHaveLength(1); // must NOT post again — goods unchanged, systems still equal-empty

    releaseSecond();
    expect(posts).toHaveLength(1); // one registrant remains — still no post

    releaseFirst();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ systems: [], factions: [], goods: [], lanes: [] });
  });

  it("keeps the posted systems list sorted and stable when one of two concurrent ids is released and re-registered", () => {
    // Registered out of alphabetical order (sys-b before sys-a) — a posted list that merely reflects
    // Map insertion order (no explicit sort) would read ["sys-b", "sys-a"] here, not sorted.
    const { posts, post } = recorder();
    const registry = createInterestRegistry(post);

    const releaseB = registry.register("system", "sys-b");
    registry.register("system", "sys-a");
    expect(posts[posts.length - 1].systems).toEqual(["sys-a", "sys-b"]);

    // Releasing and re-registering sys-b moves it to the END of the Map's insertion order (delete +
    // re-set) without touching sys-a — the posted list must stay sorted regardless.
    releaseB();
    registry.register("system", "sys-b");

    const last = posts[posts.length - 1];
    expect(last.systems).toEqual(["sys-a", "sys-b"]);
  });

  it("resend() after a simulated replacement posts the currently-held set verbatim", () => {
    // Simulates the worker having forgotten its interest across a world swap (spec: "the shell
    // re-posts interest after the replacement's first frame lands") — the UI-side held set hasn't
    // changed, so `resend()` must post again anyway, not rely on the change-gated path `register`
    // uses. Asserting `posts` actually GREW (not merely that the last entry still matches) is what
    // makes this catch a `resend()` that silently no-ops.
    const { posts, post } = recorder();
    const registry = createInterestRegistry(post);

    registry.register("system", "sys-a");
    registry.register("good", "ore");
    const held = posts[posts.length - 1];
    const countBeforeResend = posts.length;

    registry.resend();

    expect(posts.length).toBe(countBeforeResend + 1);
    const last = posts[posts.length - 1];
    expect(last).toEqual(held);
    expect(last).toEqual({ systems: ["sys-a"], factions: [], goods: ["ore"], lanes: [] });
  });
});
