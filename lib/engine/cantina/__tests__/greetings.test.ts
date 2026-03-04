import { describe, it, expect } from "vitest";
import { getGreeting } from "../greetings";
import {
  BARTENDER_GREETINGS,
  PATRON_GREETINGS,
} from "@/lib/constants/cantina-npcs";

describe("getGreeting", () => {
  it("returns a first-visit bartender greeting when visitCount is 0", () => {
    const greeting = getGreeting("bartender", 0);
    expect(BARTENDER_GREETINGS.first).toContain(greeting);
  });

  it("returns a returning bartender greeting for 1-4 visits", () => {
    const greeting = getGreeting("bartender", 3);
    expect(BARTENDER_GREETINGS.returning).toContain(greeting);
  });

  it("returns a regular bartender greeting for 5+ visits", () => {
    const greeting = getGreeting("bartender", 10);
    expect(BARTENDER_GREETINGS.regular).toContain(greeting);
  });

  it("returns a first-visit patron greeting for cautious_trader at 0 visits", () => {
    const greeting = getGreeting("cautious_trader", 0);
    expect(PATRON_GREETINGS.cautious_trader.first).toContain(greeting);
  });

  it("returns a returning patron greeting for frontier_gambler at 2 visits", () => {
    const greeting = getGreeting("frontier_gambler", 2);
    expect(PATRON_GREETINGS.frontier_gambler.returning).toContain(greeting);
  });

  it("returns a regular patron greeting for sharp_smuggler at 8 visits", () => {
    const greeting = getGreeting("sharp_smuggler", 8);
    expect(PATRON_GREETINGS.sharp_smuggler.regular).toContain(greeting);
  });

  it("boundary: returns returning greeting at exactly 1 visit", () => {
    const greeting = getGreeting("bartender", 1);
    expect(BARTENDER_GREETINGS.returning).toContain(greeting);
  });

  it("boundary: returns returning greeting at exactly 4 visits", () => {
    const greeting = getGreeting("bartender", 4);
    expect(BARTENDER_GREETINGS.returning).toContain(greeting);
  });

  it("boundary: returns regular greeting at exactly 5 visits", () => {
    const greeting = getGreeting("bartender", 5);
    expect(BARTENDER_GREETINGS.regular).toContain(greeting);
  });
});
