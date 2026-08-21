"use client";

import { sendCommand } from "@/lib/runtime/command-client";
import { narrowCommandResult } from "@/lib/types/guards";
import { useCommandMutation, type CommandMutation } from "@/lib/hooks/use-command-mutation";
import type { OrderBuildInput, AutomationInput } from "@/lib/schemas/construction-orders";
import type {
  OrderBuildResult, OrderColonyResult, CancelOrderResult, SetAutomationResult,
} from "@/lib/services/construction-orders";

/**
 * Every order verb used to invalidate a fixed list of query keys on success (queues, faction
 * summary, feasibility, Tracker, alerts, ownership, treasury) so a player action landed on every
 * surface immediately instead of at the next tick broadcast. That list is gone: the worker pushes a
 * fresh full state frame right after every command commits (`client/worker/game-worker.ts`'s
 * `handleCommand`), which already refreshes every one of those surfaces through the ordinary store
 * apply — there is nothing left for this file to invalidate.
 */

type OrderBuildData = Extract<OrderBuildResult, { ok: true }>["data"];
type OrderColonyData = Extract<OrderColonyResult, { ok: true }>["data"];
type CancelOrderData = Extract<CancelOrderResult, { ok: true }>["data"];
type SetAutomationData = Extract<SetAutomationResult, { ok: true }>["data"];

/** Queue a build/upgrade order for one building type at a system (`orderBuild` command). */
export function useOrderBuild(systemId: string): CommandMutation<{ buildingType: string; levels: number }, OrderBuildData> {
  return useCommandMutation((input: OrderBuildInput) => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "orderBuild", payload: { systemId, ...input } }).then((message) =>
      narrowCommandResult<OrderBuildData>(message.result),
    );
  });
}

/** Queue a colony-founding order for a system (`orderColony` command). */
export function useOrderColony(systemId: string): CommandMutation<void, OrderColonyData> {
  return useCommandMutation(() => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "orderColony", payload: { systemId } }).then((message) =>
      narrowCommandResult<OrderColonyData>(message.result),
    );
  });
}

/** Cancel a queued construction project (`cancelOrder` command). */
export function useCancelOrder(): CommandMutation<{ projectId: string }, CancelOrderData> {
  return useCommandMutation((input: { projectId: string }) => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "cancelOrder", payload: input }).then((message) =>
      narrowCommandResult<CancelOrderData>(message.result),
    );
  });
}

/** Toggle player automation for build/colonisation orders (`setAutomation` command). */
export function useSetAutomation(): CommandMutation<AutomationInput, SetAutomationData> {
  return useCommandMutation((input: AutomationInput) => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "setAutomation", payload: input }).then((message) =>
      narrowCommandResult<SetAutomationData>(message.result),
    );
  });
}
