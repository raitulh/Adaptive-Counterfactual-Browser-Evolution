"""Provider-agnostic cost estimation. Prices are configuration, not truth: keep them
in sync with the provider's price list; unknown models are reported as unpriced."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Price:
    input_per_mtok: float
    output_per_mtok: float


# USD per 1M tokens (standard context). Override/extend via code review, not at runtime.
PRICES: dict[str, Price] = {
    "gemini-2.5-pro": Price(1.25, 10.0),
    "gemini-2.5-flash": Price(0.30, 2.50),
    "gemini-2.5-flash-lite": Price(0.10, 0.40),
    "gemini-embedding-001": Price(0.15, 0.0),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> tuple[float, bool]:
    price = PRICES.get(model)
    if price is None:
        base = next((p for name, p in PRICES.items() if model.startswith(name)), None)
        if base is None:
            return 0.0, False
        price = base
    return (input_tokens * price.input_per_mtok + output_tokens * price.output_per_mtok) / 1_000_000, True
