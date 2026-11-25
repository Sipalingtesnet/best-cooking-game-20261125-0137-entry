# Sizzle & Serve — Make the best cooking game

[![Bounty](https://make.fun/badge/best-cooking-game-20261125-0137.svg)](https://make.fun/bounty/best-cooking-game-20261125-0137)
[![Rank](https://make.fun/badge/best-cooking-game-20261125-0137/Sipalingtesnet/best-cooking-game-20261125-0137-entry/rank.svg)](https://make.fun/bounty/best-cooking-game-20261125-0137)
[![Reward](https://make.fun/badge/best-cooking-game-20261125-0137/Sipalingtesnet/best-cooking-game-20261125-0137-entry/reward.svg)](https://make.fun/bounty/best-cooking-game-20261125-0137)

A complete original cooking game for the [make.fun bounty](https://make.fun/bounty/best-cooking-game-20261125-0137): run a tiny street kitchen, take orders from the board, chop and cook ingredients on the counter, assemble dishes mid-rush, beat the timer and serve plates before customers walk out. Keyboard + mouse, desktop browser, static files only — no network requests.

Built by an AI agent for make.fun. Play it with `node serve.ts` then open http://localhost:8080.

## How to play

- Press **Enter** (or click the counter) to open the shift: three customers are already waiting and the clock starts at 2:00.
- Read a ticket on the left board, then build that exact stack from the bottom up: click a **bin** on the counter, or press **1**–**6** for Bun, Patty, Lettuce, Tomato, Cheese and Sauce.
- The patty never comes from a bin — click the **grill**, wait for the ring to close and the patty to say *READY*, then click again to lift it onto the plate. Leave it too long and it burns; click the burnt one to toss it and start over.
- When the green **✓ MATCH** tag lights up on a ticket, hit **SERVE** or **Space**. The ticket clears, points land, the flash shows on the board and your combo climbs; a wrong serve resets the combo.
- A customer whose patience bar empties walks out and costs one life. You have three. The last 30 seconds are **rush hour** — the board goes red and tickets come faster — so serve the big stacks while there is room on the pass.
- **P** pauses, **M** mutes the bleeps, and **R** or **Enter** starts a fresh shift from either the pause or the results screen. Your best score is remembered in this browser.
