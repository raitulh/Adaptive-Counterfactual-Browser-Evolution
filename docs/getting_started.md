# Getting Started

## Install

```bash
cd acbe
pip install -e .
```

The core install has **no required third-party dependencies** beyond the
Python standard library (see `docs/mvp_status.md` for why). Optional extras:

```bash
pip install -e ".[browser]"   # Playwright, for real browser automation
pip install -e ".[server]"   # Flask, for `acbe serve`
pip install -e ".[full]"     # everything, including the frameworks in Section 19
```

## Run the bundled benchmark

```bash
python -m benchmarks.run_benchmark
```

## Try the CLI

```bash
acbe init
acbe run --list                       # see available synthetic tasks
acbe run --task wrong_element_0       # naive attempt -- fails by design
acbe improve --task wrong_element_0   # full self-improvement loop
acbe strategies                       # what got promoted
acbe failures                         # what failed and how it was classified
acbe experiment list
acbe serve                            # basic dashboard at http://127.0.0.1:8420
```

## Use it as a library

```python
from acbe import ACBE
from acbe.agents.custom_agent import ScriptedAgent
from acbe.core.types import ActionType, LocatorStrategy
from acbe.experiments.runner import TaskStep
from benchmarks.environments import make_shop_environment

env = make_shop_environment("my-shop", trap=True)
agent = ScriptedAgent(
    steps=[
        TaskStep(ActionType.CLICK, "Browse products"),
        TaskStep(ActionType.CLICK, "Add to cart"),
        TaskStep(ActionType.CLICK, "Proceed to checkout"),
    ],
    locator_strategy=LocatorStrategy.TEXT_VISUAL,  # naive on purpose
)

system = ACBE(agent=agent, browser="mock", environment=env)
result = system.run("Add a product to the cart and check out.")
print(result.success, result.tokens_used)

# If it fails, the same call can trigger the full self-improvement loop:
result = system.run_and_improve("Add a product to the cart and check out.")
print(result.improvement_triggered, result.improvement_result)
```

See `examples/` for more (`basic_usage.py`, `self_improve_example.py`,
`custom_agent_example.py`).

## Run the tests

```bash
python -m unittest discover -s tests -v
```
