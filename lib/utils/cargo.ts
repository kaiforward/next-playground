import type { CargoItemState } from "@/lib/types/game";

/** Total quantity of goods across all cargo slots. */
export function getCargoUsed(cargo: CargoItemState[]): number {
  return cargo.reduce((sum, item) => sum + item.quantity, 0);
}
