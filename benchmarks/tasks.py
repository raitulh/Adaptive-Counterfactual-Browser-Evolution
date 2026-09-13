"""
ACBE-Bench (Section 16): a small, controlled synthetic task suite.

This ships ~30 tasks across the categories the spec calls out (Navigation,
Forms, Shopping, Dynamic UI, Ambiguous UI/Unexpected UI changes, Failure
recovery, Strategy transfer). It is explicitly a *starter* set matching the
MVP target ("30-50 controlled tasks", Section 16/31) -- integrating
BrowserGym / WebArena / VisualWebArena / OSWorld tasks is tracked as
roadmap (see docs/mvp_status.md) and is intentionally not attempted here.
"""

from __future__ import annotations

from typing import List

from acbe.core.types import ActionType, LocatorStrategy
from acbe.experiments.runner import Task, TaskStep
from benchmarks.environments import (
    make_dynamic_ui_environment,
    make_navigation_environment,
    make_popup_environment,
    make_precondition_environment,
    make_sequence_environment,
    make_shop_environment,
    make_verification_environment,
)

TARGET_ADD_TO_CART = "Add to cart"


def wrong_element_family(n: int = 10) -> List[Task]:
    """Shopping tasks with a visually-identical decoy button next to the
    real 'Add to cart' target -- the spec's worked WRONG_ELEMENT example."""
    tasks = []
    for i in range(n):
        env = make_shop_environment(f"shop-{i}", trap=True)
        steps = [
            TaskStep(ActionType.CLICK, "Browse products"),
            TaskStep(ActionType.CLICK, TARGET_ADD_TO_CART),
            TaskStep(ActionType.CLICK, "Proceed to checkout"),
        ]
        tasks.append(Task(
            task_id=f"wrong_element_{i}", description="Find a product, add it to the cart, and checkout.",
            category="shopping", environment=env, steps=steps, goal_verification=env.goal_state,
            baseline_locator=LocatorStrategy.TEXT_VISUAL, expected_failure_pattern="WRONG_ELEMENT",
        ))
    return tasks


def wrong_element_regression_family(n: int = 4) -> List[Task]:
    """Same shopping flow, but with NO decoy -- used as the held-out
    regression suite to make sure a promoted strategy doesn't break the
    easy case."""
    tasks = []
    for i in range(n):
        env = make_shop_environment(f"shop-clean-{i}", trap=False)
        steps = [
            TaskStep(ActionType.CLICK, "Browse products"),
            TaskStep(ActionType.CLICK, TARGET_ADD_TO_CART),
            TaskStep(ActionType.CLICK, "Proceed to checkout"),
        ]
        tasks.append(Task(
            task_id=f"wrong_element_regression_{i}", description="Find a product, add it to the cart, and checkout.",
            category="shopping_regression", environment=env, steps=steps, goal_verification=env.goal_state,
            baseline_locator=LocatorStrategy.TEXT_VISUAL,
        ))
    return tasks


def dynamic_ui_family(n: int = 4) -> List[Task]:
    tasks = []
    for i in range(n):
        env = make_dynamic_ui_environment(f"settings-{i}")
        steps = [
            TaskStep(ActionType.SELECT, "Select your region", params={"value": "EU"}),
            TaskStep(ActionType.CLICK, "Save settings"),
        ]
        tasks.append(Task(
            task_id=f"dynamic_ui_{i}", description="Change the region setting and save.",
            category="dynamic_ui", environment=env, steps=steps, goal_verification=env.goal_state,
            baseline_locator=LocatorStrategy.TEXT_VISUAL, expected_failure_pattern="STATE_MISUNDERSTANDING",
        ))
    return tasks


def wrong_sequence_family(n: int = 3) -> List[Task]:
    tasks = []
    for i in range(n):
        env = make_sequence_environment(f"signup-{i}")
        steps = [
            TaskStep(ActionType.CLICK, "Submit signup form"),  # deliberately out of order first
            TaskStep(ActionType.TYPE, "Full name", params={"value": "Ada Lovelace"}),
            TaskStep(ActionType.TYPE, "Email address", params={"value": "ada@example.com"}),
            TaskStep(ActionType.CLICK, "Submit signup form"),
        ]
        tasks.append(Task(
            task_id=f"wrong_sequence_{i}", description="Sign up with a name and email.",
            category="forms", environment=env, steps=steps, goal_verification=env.goal_state,
            baseline_locator=LocatorStrategy.TEXT_VISUAL, expected_failure_pattern="WRONG_SEQUENCE",
        ))
    return tasks


def missing_information_family(n: int = 3) -> List[Task]:
    tasks = []
    for i in range(n):
        env = make_precondition_environment(f"checkout-coupon-{i}")
        steps = [
            TaskStep(ActionType.CLICK, "Apply coupon code"),  # precondition not yet satisfied
            TaskStep(ActionType.CLICK, "Have a coupon?"),
        ]
        tasks.append(Task(
            task_id=f"missing_information_{i}", description="Apply a coupon code at checkout.",
            category="forms", environment=env, steps=steps, goal_verification=env.goal_state,
            baseline_locator=LocatorStrategy.TEXT_VISUAL, expected_failure_pattern="MISSING_INFORMATION",
        ))
    return tasks


def context_failure_family(n: int = 3) -> List[Task]:
    tasks = []
    for i in range(n):
        env = make_popup_environment(f"landing-{i}")
        steps = [
            TaskStep(ActionType.CLICK, "Continue to article"),
            TaskStep(ActionType.CLICK, "Continue to article"),
        ]
        tasks.append(Task(
            task_id=f"context_failure_{i}", description="Continue past the landing page to the article.",
            category="navigation", environment=env, steps=steps, goal_verification=env.goal_state,
            baseline_locator=LocatorStrategy.TEXT_VISUAL, expected_failure_pattern="CONTEXT_FAILURE",
        ))
    return tasks


def navigation_failure_family(n: int = 2) -> List[Task]:
    tasks = []
    for i in range(n):
        env = make_navigation_environment(f"nav-{i}", broken=True)
        steps = [TaskStep(ActionType.CLICK, "Go to support center")]
        tasks.append(Task(
            task_id=f"navigation_failure_{i}", description="Go to the support center.",
            category="navigation", environment=env, steps=steps, goal_verification=env.goal_state,
            baseline_locator=LocatorStrategy.TEXT_VISUAL, expected_failure_pattern="ENVIRONMENT_FAILURE",
        ))
    return tasks


def verification_failure_family(n: int = 2) -> List[Task]:
    tasks = []
    for i in range(n):
        env = make_verification_environment(f"order-{i}")
        steps = [TaskStep(ActionType.CLICK, "Place your order")]
        tasks.append(Task(
            task_id=f"verification_failure_{i}", description="Place the order.",
            category="ambiguous_ui", environment=env, steps=steps,
            goal_verification="page:order_confirmation",  # a naive page-based check that
            # will never match -- the environment only ever signals completion via a
            # flag (env.goal_state == "flag:order_placed=true"), never a page change.
            baseline_locator=LocatorStrategy.TEXT_VISUAL, expected_failure_pattern="VERIFICATION_FAILURE",
        ))
    return tasks


def all_tasks() -> List[Task]:
    return (
        wrong_element_family()
        + dynamic_ui_family()
        + wrong_sequence_family()
        + missing_information_family()
        + context_failure_family()
        + navigation_failure_family()
        + verification_failure_family()
    )


def regression_suite() -> List[Task]:
    return wrong_element_regression_family()
