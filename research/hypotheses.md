# Hypotheses

## Primary hypothesis

> Can an AI agent continuously improve its task-solving strategy from
> verified experience without requiring full model retraining?

The framework is designed to let this be tested empirically rather than
asserted. The bundled benchmark tests a narrow, controlled slice of it (see
`methodology.md`); the hypothesis as stated is broader than what one MVP
build can establish, and should be read as the research direction the
architecture is built to support, not a result this repository claims to
have already proven at scale.

## Supporting hypotheses and how ACBE-Bench is meant to test them

| # | Hypothesis | How it's measured |
|---|---|---|
| H1 | Verified-failure-conditioned recovery beats blind retrying. | `Base Agent` vs `Base Agent + Failure Recovery` success rate on the same task set (Section 18 baselines). |
| H2 | Counterfactual, multi-candidate generation beats single-strategy retry. | `Base Agent + Failure Recovery` (single fallback) vs `Base Agent + Counterfactual Recovery` (Section 16 track 5). |
| H3 | A statistical promotion gate reduces regressions vs. promoting on first success. | Regression-suite failure rate with the gate enabled vs. a variant that promotes after one success. |
| H4 | Strategies transfer across environments better than chance and better than never transferring. | `cross_task_transfer_rate` (Section 15) against a random-strategy-selection control. |
| H5 | Adaptive observation/reasoning budgets reduce token cost without reducing success rate. | `Success Rate / Token Cost` (Section 17) for the full loop vs. a fixed-maximum-budget variant. |
| H6 | Improvement generalizes to a genuinely new task suite, not just repeats of the training suite. | Section 16's "Initial Task Suite -> Learning Phase -> Same Task Suite -> New Task Suite -> Transfer Evaluation" protocol. |

## What would falsify or weaken these hypotheses

Being explicit about this is part of not overclaiming:

* If `Base Agent + Counterfactual Recovery` does not measurably outperform
  `Base Agent + Failure Recovery` on a broader, less adversarial task suite
  than the bundled one, H2 is not supported outside narrow synthetic
  settings.
* If promoted strategies' success rate degrades sharply outside the
  specific environments they were validated in (i.e. `transfer_success_rate`
  is far below in-environment `success_rate`), H4 is weak and transfer
  confidence estimation (`CrossTaskTransfer.estimate_confidence`) needs
  more than the current success-rate blend.
* If token savings from adaptive routing come with a material success-rate
  cost when measured on harder, more realistic tasks, H5 does not hold in
  general, only in the low-uncertainty regime.

## Future work

* Replace the static `LOCATOR_HEURISTICS` cheap-scoring table (Section 7)
  with weights learned from accumulated experiment outcomes, closing the
  loop on the ranking heuristic itself.
* Extend `ACBE-Bench` with real `WebArena` / `BrowserGym` tasks (Section 16)
  to test whether results here generalize past the synthetic suite.
* Study Evolution Levels 4-6 (model/tool routing improvement through
  controlled agent-code modification) empirically once Levels 1-3 have
  enough production mileage to trust the promotion gate at higher stakes.
