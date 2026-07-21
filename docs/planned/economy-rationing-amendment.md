# Economy Rationing — Current Access vs Strategic Reserve

Small functional amendment to
[Economy Band Reconciliation](./economy-band-reconciliation.md). It changes the PR1 consumption
knee without adding UI in PR1.

## Headline

Population and industry receive their full requested flow while a market has more than a small
emergency stock. Falling below the 40-cycle pricing anchor means the strategic reserve is
depleting; it does **not** mean goods are currently missing. Explicit rationing begins only within
the final two cycles of aggregate local demand and ramps toward zero delivery at empty stock.

## Functional rules

- The pricing/reserve anchor remains
  `targetStock = TARGET_COVER × demandRate × anchorMult`, with `TARGET_COVER = 40`.
- The access threshold is independent:
  `rationStock = RATION_COVER × demandRate`, initially `RATION_COVER = 2`.
- At `stock >= rationStock`, civilian consumption and industrial input draws receive their full
  requested flow, subject only to physical availability.
- Below `rationStock`, both use the shared
  `sqrt(stock / rationStock)` ration factor, capped so a draw can never make stock negative.
- At empty stock, delivery is zero. A non-positive ration threshold delivers freely when stock
  exists and delivers zero at empty.
- Satisfaction remains the economy pulse's authoritative measured flow:
  `civilian delivered / civilian demanded`. The persisted value continues to feed unrest,
  population needs, and the build planner's fed check.
- The opening-stock measurement rule is unchanged: a pulse beginning at or above the ration
  threshold records full satisfaction even if that full draw leaves closing stock below it.

## Separation of policies

`demandRate` is the stored aggregate local draw-rate denominator, including civilian and
industrial demand. It is the authority for demand-cycle cover until the next monthly rewrite.

Pricing anchor shifts change `targetStock`, price, and reserve policy; they do not change
`rationStock` or physical access at fixed stock and demand. Temporary consumption multipliers
change the requested flow but not the stored threshold within that pulse.

Initial market stock remains a separate strategic policy. New markets retain the existing
`0.75 × targetStock` minimum initial reserve; they are not seeded at two cycles. PR3's structural
exporter draw floor is also a separate reserve policy and must not be replaced with the ration
threshold.

## Player-facing meaning

This PR adds no UI. Later presentation must distinguish:

- **Supplied** — current requested flow is fully delivered.
- **Low reserve** — supplied, but below the strategic reserve target.
- **Rationing** — delivery has fallen below requested flow.
- **Shortage** — severe rationing, retaining satisfaction below 0.5 as the critical boundary.
- **Glut** — the independent producer-side excess state.

Low reserve may raise prices, attract logistics, and keep production active without causing
population dissatisfaction or unrest.

## Follow-on ownership

- PR3 preserves and tests the tick's assessment ordering: logistics arriving after economy and
  population affects satisfaction at the next economy pulse.
- PR4 separates goods pressure from tax pressure and calibrates regime-sensitive unrest:
  faster recovery while Supplied, gradual accumulation while Rationing, stronger accumulation
  during Shortage, without changing the intended tax equilibrium.
- PR5 explains current goods pressure, tax pressure, and stored-unrest direction; labels Needs as
  the latest assessment; keeps diagnostics visible after housing collapse; and aligns Strike
  language with the actual production-suppression threshold.

Detailed unrest-history charts and precise recovery forecasts are optional backlog polish, not
requirements of this five-PR pass.

## Crisis ordering

The coupled supply-chain tick remains deterministic and recipe-topological. It does not promise
pro-rata allocation among every same-tick drawer: civilian consumption of a good occurs with that
good's entry, while downstream industries draw it later in recipe order. This amendment changes
when rationing begins, not crisis allocation priority.

## Validation

- 40, 10, and 2 cycles of stock all deliver full current demand.
- Below 2 cycles, delivery follows the shared square-root ration curve; empty delivers zero.
- Anchor-shift events alter `targetStock` without altering `rationStock` or satisfaction at
  fixed stock and `demandRate`.
- Civilian and industrial draws use the same ration threshold.
- Initial stock remains at the separate initial-reserve floor.
- Persisted satisfaction, scale invariance, finite-state guards, and the true-zero stock-pin
  metric remain intact.
