# Methodology

## Research framing

ACBE explores a failure-conditioned, counterfactual self-improvement
architecture for AI agents, combining verified failure analysis, strategy
evolution, experimentation, cross-task transfer, and inference-efficiency
optimization. It is not positioned as AGI, and its novelty claims are
scoped to the specific combination described in `prior_art.md`, not to any
individual technique.

## What this MVP build actually validates

The bundled synthetic benchmark (`benchmarks/`) and test suite (`tests/`)
are deliberately narrow and fully controlled, for a specific reason: they
let every claim below be checked by running code, rather than taken on
faith.

1. **Failure detection is accurate.** Each of the eight synthetic failure
   families (`tests/test_synthetic_failures.py`) is constructed so the
   *true* failure category is known by design (it's the category the
   environment was built to trigger), and the pipeline's classification is
   checked against it directly.
2. **Recovery is genuinely counterfactual.** The counterfactual generator
   is required to produce multiple, structurally distinct candidates per
   failure (never a bare retry), and the ranking funnel is checked to
   respect its configured stage sizes.
3. **Promotion is conservative.** The promotion gate is tested directly
   against constructed `Experiment` objects covering all four outcomes
   (`PROMOTE` / `REJECT` / `ROLLBACK` / `NEEDS_MORE_DATA`), independent of
   whichever candidate the ranking heuristic happens to prefer.
4. **The end-to-end loop works on at least one real failure family.** The
   `WRONG_ELEMENT` family (a visually-identical decoy element next to the
   real target -- the spec's own worked example) is used as the flagship
   integration test: a naive agent fails on it 100% of the time, the loop
   recovers within one round, and the promoted strategy transfers
   successfully to unseen "websites" with no further failures.
5. **Cross-task transfer is measured, not assumed.** Transfer attempts are
   tracked as their own metric (`transfer_success_rate`), separate from
   in-environment reuse, per Section 10's requirement to never blindly
   trust transfer.

## Known limitation, stated plainly

The cheap-ranking heuristic (Section 7) is a static, hand-specified prior
over locator strategies -- it is *not* guaranteed to pick the single best
candidate for every failure family in this repository. For example, for the
bundled `STATE_MISUNDERSTANDING` (dynamic UI) family, the heuristic's
top-ranked candidate is not always the one that actually resolves the
failure in the sandbox. This is treated as expected behavior, not a bug:
the promotion gate's job is precisely to catch a top-ranked-but-ineffective
candidate and refuse to promote it (`REJECT`, gain ≈ 0) rather than to
guarantee the heuristic is always right. Improving the ranking heuristic
itself (e.g. learning it from experiment outcomes rather than hand-setting
it) is listed as future work in `hypotheses.md`.

## How to reproduce the headline result

```bash
python -m benchmarks.run_benchmark
```

This runs a naive baseline agent over the full adversarial task suite
(expected: 0% success, by construction -- see the caveat printed by the
script and repeated in `prior_art.md`), then runs the full self-improvement
loop against the `WRONG_ELEMENT` family and reports whether it recovered,
whether the recovered strategy was promoted, and its success rate against
brand-new, unseen task instances.

## Threats to validity

* **Synthetic environments.** `MockBrowserAdapter` is a deterministic
  simulator, not a real browser. Section 3's `PlaywrightBrowserAdapter` is
  real, but end-to-end self-improvement against arbitrary live websites
  (with all the non-determinism that implies) is roadmap, not validated
  here -- see `docs/mvp_status.md`.
* **Small sample sizes.** The bundled families have single-digit to
  low-double-digit task counts per category, which is enough to exercise
  the pipeline's logic but not enough to make strong statistical claims
  about real-world success rates. `ACBEConfig.promotion_min_sample_size`
  defaults to 20 for this reason; the benchmark script lowers it
  explicitly and says why, rather than silently using a weaker bar.
* **Heuristic ranking, not learned ranking.** See "Known limitation" above.
