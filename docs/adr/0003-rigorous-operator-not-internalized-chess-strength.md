# The assistant is a rigorous engine operator; chess judgment arrives as tool data

**Status:** accepted

## Context

Beta testing raised the goal of an assistant that understands chess "as if we were talking
to an experienced grandmaster," with a model trained on positions and expert annotations as
the proposed means.

That goal is in tension with the constraint the project is built on. This server exists
because a fluent chess guess and an engine result are indistinguishable in the output. A
model with strong internalized chess judgment is a model that can produce confident,
plausible chess prose *without consulting the engine* — a better version of the thing the
architecture distrusts.

The beta transcript shows the tension resolved correctly in one place and violated in
another. The assistant's reasoning about why `f3` fails to `...Bxc3+` is real insight
*derived from the PV and the delta* — engine-licensed, and exactly the division of labour
working. But it also offered "10...g4 or 10...Bxc3+" as alternatives without scoring
either: prose about moves no search had touched. More chess intuition makes that failure
more likely, not less.

The gap the transcript actually shows is not chess knowledge. It is PV literacy and
interrogation discipline: never re-calling with a longer budget when a number was soft,
never checking whether ranked alternatives existed, naming moves it had not scored.

## Decision

Within this repo, the assistant is a **rigorous operator**, not a chess authority. It holds
no chess opinions the engine has not licensed. Every move it names in prose is either in
`legal_moves` and scored via `candidate`, present in `best`/`engine_lines` with its number,
or explicitly flagged as unverified.

Chess judgment beyond that arrives as **data through a tool**, never as intuition in the
model — the same principle as the engine, one level up.

A FEN→annotation service (master-quality commentary from a model trained on annotated
positions) is legitimate future work, and it is a **separate MCP tool with its own
provenance**. It is never called by this server and never populates a field in an
`evaluate_position` response. Three kinds of claim — engine evidence, learned annotation,
assistant reasoning — three sources, so a reader can always tell which one they hold.
Folding annotation into this response would reinstate the summary field D#18 and the PRD's
non-goals reject, and would couple this server's wall-clock budget (R5) to a model
service's latency and availability.

Operator discipline ships as **repo skills**, versioned alongside the schema they describe,
because the rules are meaningless without this server and change when its output changes.
They are to be tuned systematically for performance and quality rather than written once.

## Consequences

A pure operator cannot tell which questions are interesting — it will not know that a
sideline like `...Bg4` deserves a look when the engine did not rank it. That is a real
loss, and it is what an opening/database tool is for: supplying that knowledge as data
rather than as recalled intuition.
