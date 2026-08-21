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
    expect(posts[0]).toEqual({ systems: ["sys-a"], factions: [], goods: [] });

    release();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ systems: [], factions: [], goods: [] });
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
    expect(posts[0]).toEqual({ systems: ["sys-a"], factions: [], goods: [] });

    releaseB();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ systems: [], factions: [], goods: [] });
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
    expect(last).toEqual({ systems: ["sys-a"], factions: [], goods: ["ore"] });
  });
});
