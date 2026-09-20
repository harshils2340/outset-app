# Ground truth

One file per business, recorded by hand from that business's own booking page, with the date it was read.

These are the only numbers in this repository that were not produced by our own code, which is the whole point:
the agent can only be checked against something it did not generate. A case goes stale — a shop changes its
prices, a Saturday sells out — so every record carries `recordedAt` and the harness says how old it is rather
than pretending a three-week-old reading is still the truth.

Record what the page literally showed. If it said "Booking Subtotal $82.00" and you could not see how many
people that was for, write the subtotal and leave the party size null. A guess written down here becomes a
wrong test that fails real code.
