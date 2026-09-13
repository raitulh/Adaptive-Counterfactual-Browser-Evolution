# Contributing to ACBE

Thanks for considering a contribution. A few ground rules that keep the
project's safety and research claims honest:

## Development setup

```bash
git clone <this repo>
cd acbe
pip install -e ".[dev]"
python -m unittest discover -s tests -v
```

## Guidelines

1. **Never weaken the protected components without discussion.** The
   evaluator, safety gate, benchmark definitions, promotion thresholds, and
   audit logs (`ACBEConfig.protected_components`) are deliberately hard to
   change programmatically. If your change touches
   `acbe/safety/guard.py`, `acbe/evolution/promotion.py`, or
   `acbe/evaluation/evaluator.py`, open an issue describing why first.
2. **New failure categories are additive, not destructive.** Use
   `FailureTaxonomy.register()` for new categories; never redefine an
   existing category's meaning (`acbe/failure/taxonomy.py` enforces this).
3. **Every new feature needs a test that would fail without it.** See
   `tests/` for the existing style (plain `unittest`, synthetic
   `MockBrowserAdapter` environments -- no live network/browser calls).
4. **Don't overclaim in docs.** If you add a benchmark result or a new
   capability, describe what was actually measured (see
   `research/methodology.md`'s tone) rather than a general claim of
   superiority.
5. **New adapters (frameworks, model providers) should be soft
   dependencies.** Follow the pattern in `acbe/adapters/langgraph_adapter.py`:
   the module must import cleanly even if the target package isn't
   installed; only fail when the adapter is actually used.

## Reporting issues

Please include: the command/code you ran, what you expected, what
happened instead, and (if relevant) the contents of `.acbe/acbe.db`'s
`failures`/`experiments` tables via `acbe failures` / `acbe experiment list`.

## Security issues

See `SECURITY.md` -- please do not open a public issue for a security
vulnerability.
