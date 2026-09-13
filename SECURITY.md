# Security Policy

## Scope

ACBE gives an AI agent the ability to act inside a browser/computer
environment and to propose and (under gating) promote changes to its own
strategies. The security-relevant surfaces are:

* `acbe/browser/playwright_adapter.py` -- real browser automation.
* `acbe/safety/guard.py` -- permission boundaries, protected components,
  destructive-action confirmation, domain allowlisting, rate limiting.
* `acbe/evolution/promotion.py` -- what is allowed to become "trusted"
  strategy, and under what statistical bar.
* `acbe/telemetry/tracer.py` -- secret redaction in logs/traces.

## Reporting a vulnerability

Please do not open a public GitHub issue for security vulnerabilities.
Instead, email the maintainers listed in the repository's `README.md` with:

1. A description of the vulnerability and its potential impact.
2. Steps to reproduce (a minimal script/task is ideal).
3. Any suggested mitigation.

We aim to acknowledge reports within 5 business days.

## Hard constraints (see `acbe/core/config.py` and `acbe/safety/guard.py`)

The following are never permitted without explicit human approval, by
design, regardless of what an agent or a promoted strategy requests:

* Modifying the evaluator, safety gate, benchmark definitions, promotion
  thresholds, or audit logs (`ACBEConfig.protected_components`).
* Financial transactions, credential changes, destructive deletion, or
  other security-sensitive operations
  (`ACBEConfig.require_confirmation_for`) without confirmation.
* Navigating outside a configured domain allowlist, when one is set.

If you find a way to bypass any of the above through the public API,
that is a valid, high-priority security report.
