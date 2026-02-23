## Implementation Order

Proposed order based on dependencies and quick wins:

1. **#6 — Sidebar & overview simplification** (quick win, standalone) - DONE
2. **#4 — Ship selection UX patterns** (cross-cutting, informs #1, #3, #2) - DONE
3. **#1 — Convoy refueling** (functional gap, uses selection pattern from #4) - DONE
4. **#3 — Convoy member modification** (functional gap, uses multi-select from #4) - DONE
5. **#7 — Normal ships cannot navigate after step 1** (regression after point 1, defunct markup) - DONE
6. **#2 — Upgrade location / shipyard UX** (architectural, most discussion needed)
7. **#5 — Convoy detail screen** (scaling concern, lowest urgency)

---

## Issues

1. Convoys cannot currently be re-fuelled.

Ships are refuelled from the ship detail screen, we need a better place to add that.

Maybe both ships and convoys should have a re-fuel button on list pages that brings up a refuel dialog similar to repair?

2. Ships are currently upgraded from ship detail screens. They should be upgraded from a different tab instead. Later on we are adding tiers of shipyards which will affect tiers of upgrades that are available as well, so they will need to move away from the ship detail screen, the ship needs to be in the location the upgrades are made to apply them. Do we have another layer of sub-navigation and have two tabs on the shipyard screen? Its ship yard functionality but ideally we wouldn't have two sets of tabs right next to each other, maybe we need another more 'gamey' feeling navigation screen where we choose between the shipyard area for purchasing ships and the shipyard for upgrades. Maybe a dialog screen as if we are talking to a vendor?

3. Once a convoy is created, another ship cannot be added to it. I suggested we create a dialog to modify the ships available within system to add to the convoy.

4. We have several places where ships need to be chosen from a list and I would like to think of the best way handle this in this kind of application, e.g the dialog to modify the ships in the convoy, currently we use a checkbox list which doesn't look very nice do we have any alternatives for better ship selectors? We have selects for when a single ship needs to be chosen, the problem ultimately is that the user could have a lot of ships. What is the best way for a user to select a single ship if there are around 50, and what is the best way to let a user select a series of ships when there is a large number? Currently the select on the market screen im okay with but other use cases for selecting ships in various scenarios are not very user friendly with large numbers of ships e.g if we add an upgrade's screen for ships.

5. If a convoy is large the number of ships take up a lot of space on the convoy tab. We might want a convoy detail screen which itself has tabs with various details.

6. The navigation sidebar still has too many ships in it, I purchased 30, same for the fleet summary on the system overview if there are a lot of ships it takes up too much vertical space. Realistically the user will need to use the fleet screen if they want to easily select which ship they want and perform any action on it. Perhaps the navigation sidebar ship/convoy content should just be removed? We can improve the sidebar UX by instead having direct links to the various tabs on a system and briefer summaries, e.g just how many ships / convoys.

7. Regular ship cards need a navigate button because we removed the navigation option in the first part. There is a seconary convoy list on the ships page that should be removed, we also dont need that ship card componment because we have another detailed one on the convoys screen itself.