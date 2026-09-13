# Prior Art

ACBE does not claim to be the first system to explore self-improving agents,
failure-driven learning, or browser/computer-use automation. This document
places it relative to existing lines of work so its actual contribution --
a specific architectural combination and an accompanying benchmark -- is
clear.

## Failure-driven / reflective agents

**Reflexion**-style agents (verbal self-reflection on a failed trajectory,
fed back into the next attempt) established that language-model agents can
improve within an episode or across a handful of attempts by reasoning
about their own mistakes in natural language. ACBE differs primarily in
*where the learning is stored and validated*: Reflexion-style reflection
typically lives in the prompt/context of a single run, whereas ACBE
persists a structured, versioned `Strategy` object in procedural memory,
independent of any one conversation, and requires it to pass a statistical
promotion gate before it is trusted again.

**Voyager** and similar agents in game/simulation environments build a
growing *skill library* of reusable, verified code/behaviors. ACBE's
`StrategyMemory` plays an analogous role for browser/computer-use
strategies rather than game skills, and adds an explicit experiment +
promotion + rollback pipeline in front of "add this to the library."

## Self-referential / self-modifying agent architectures

**Gödel Agent** and the **Darwin Gödel Machine** line of work explore agents
that can rewrite their own logic (up to and including their own code) based
on performance feedback, with an emphasis on open-ended, recursive
self-improvement. ACBE is intentionally more conservative: Section 11 caps
what can be modified without human approval (the evaluator, safety gates,
benchmark definitions, promotion thresholds, and audit logs are permanently
off-limits to autonomous modification), and the "Evolution Levels" (Section
11 of the self-improvement update) are explicitly staged from strategy-level
changes up through controlled code evolution, each gated by the same
sandbox/regression/safety pipeline. ACBE is not attempting open-ended
recursive self-improvement; it is attempting bounded, auditable improvement
of a fixed *kind* of artifact (locator/observation/routing strategies).

## Browser and computer-use agents

A substantial body of work builds agents that operate real browsers or
desktop UIs (accessibility-tree- and DOM-grounded agents, vision-grounded
computer-use agents, and hybrid approaches that combine both signals).
ACBE's browser layer (Section 3) does not propose a new grounding method;
it proposes a *counterfactual competition* over several existing grounding
methods (role/accessible-name, DOM attributes, semantic search, visual
grounding, nearby-element anchoring) conditioned on which one a verified
failure implicates, and a cheap-to-expensive funnel (Section 7) for
deciding which of those methods to trust for a given failure pattern.

## Context/token-efficiency methods

Compact observation representations, state deduplication, and
small-model-first routing are all established techniques for reducing
inference cost in agent loops. ACBE's contribution here (Sections 4 and 8)
is not a new compression or routing algorithm; it is tying those
efficiency decisions to the same uncertainty/confidence signal that drives
the failure-recovery pipeline, so that a well-understood, previously-solved
situation costs less to re-solve than a novel one.

## What ACBE actually combines

Put plainly: none of the individual pieces above (reflection, skill
libraries, bounded self-modification, multi-strategy grounding, adaptive
efficiency routing) are new in isolation. ACBE's position is a specific
combination and set of engineering constraints:

1. Failures must be *verified* (via an evaluator the agent cannot
   influence) before they trigger anything.
2. Every recovery is *counterfactual and multi-candidate*, never a single
   retry.
3. Every candidate is *cheaply filtered* before any expensive reasoning or
   real-environment test.
4. Nothing is promoted without *sandbox validation, a regression check, and
   a statistical significance test*.
5. Everything promoted is *versioned and reversible*.
6. The same failure-pattern index used for within-task recovery is reused
   for *cross-task transfer*.

Section 16 (ACBE-Bench) and `research/hypotheses.md` describe how this
combination is intended to be evaluated empirically, including against the
"Base Agent + X" baselines in Section 18, rather than asserted.

## Benchmarks

**WebArena**, **VisualWebArena**, **BrowserGym**, and **OSWorld** are
established, more comprehensive benchmarks for web/computer-use agents.
ACBE-Bench (Section 16) is a much smaller, fully synthetic, controlled
suite whose purpose is different: measuring whether an agent *improves
after experiencing a verified failure and transfers that improvement*,
which those benchmarks are not designed to isolate on their own. Section 16
explicitly plans to integrate them later rather than duplicate them.
