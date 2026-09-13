"""
Synthetic environment builders backing ACBE-Bench (Section 16) and the unit
test suite. Each builder returns a fresh, independent ``EnvironmentSpec`` --
``MockBrowserAdapter`` never mutates the spec itself, so the same spec could
technically be reused across adapters, but builders are provided per-call
to keep every task in the benchmark obviously self-contained.
"""

from __future__ import annotations

from acbe.browser.mock_adapter import ElementSpec, EnvironmentSpec, PageSpec


def make_shop_environment(env_id: str, *, trap: bool = True) -> EnvironmentSpec:
    """home -> product -> cart -> checkout. A WRONG_ELEMENT trap sits on the
    'Add to cart' button: a decoy with identical visible text but a
    different accessible name/role also exists on the product page."""
    home = PageSpec(
        page_id="home", page_type="home",
        elements=[ElementSpec("browse_btn", "link", "Browse products", "Browse")],
        transitions={"browse_btn": "product"},
    )
    product_elements = [
        ElementSpec("add_to_cart", "button", "Add the featured item to cart", "Add to cart"),
    ]
    traps = {}
    if trap:
        product_elements.insert(0, ElementSpec("add_related_to_cart", "button",
                                                 "Add related accessory to cart", "Add to cart"))
        traps = {"add_related_to_cart": "add_to_cart"}
    product = PageSpec(
        page_id="product", page_type="product",
        elements=product_elements, traps=traps,
        transitions={"add_to_cart": "cart"},
    )
    cart = PageSpec(
        page_id="cart", page_type="cart",
        elements=[ElementSpec("checkout_btn", "button", "Proceed to checkout", "Checkout")],
        transitions={"checkout_btn": "checkout"},
    )
    checkout = PageSpec(page_id="checkout", page_type="checkout", elements=[])
    return EnvironmentSpec(
        env_id=env_id, start_page="home",
        pages={"home": home, "product": product, "cart": cart, "checkout": checkout},
        goal_state="page:checkout",
    )


def make_dynamic_ui_environment(env_id: str) -> EnvironmentSpec:
    """A settings page with a dropdown that only becomes interactive after a
    WAIT / readiness check (STATE_MISUNDERSTANDING family)."""
    settings = PageSpec(
        page_id="settings", page_type="settings",
        elements=[
            ElementSpec("region_dropdown", "combobox", "Select your region", "Region", kind="select", dynamic=True),
            ElementSpec("save_btn", "button", "Save settings", "Save"),
        ],
        transitions={"save_btn": "saved"},
    )
    saved = PageSpec(page_id="saved", page_type="confirmation", elements=[])
    return EnvironmentSpec(
        env_id=env_id, start_page="settings",
        pages={"settings": settings, "saved": saved},
        goal_state="page:saved",
    )


def make_sequence_environment(env_id: str) -> EnvironmentSpec:
    """A signup form that must be filled name -> email -> submit, in that
    order (WRONG_SEQUENCE family)."""
    form = PageSpec(
        page_id="signup", page_type="form",
        elements=[
            ElementSpec("name_field", "textbox", "Full name", "Name", kind="input"),
            ElementSpec("email_field", "textbox", "Email address", "Email", kind="input"),
            ElementSpec("submit_btn", "button", "Submit signup form", "Submit"),
        ],
        required_sequence=["name_field", "email_field", "submit_btn"],
        transitions={"submit_btn": "welcome"},
    )
    welcome = PageSpec(page_id="welcome", page_type="confirmation", elements=[])
    return EnvironmentSpec(
        env_id=env_id, start_page="signup",
        pages={"signup": form, "welcome": welcome},
        goal_state="page:welcome",
    )


def make_precondition_environment(env_id: str) -> EnvironmentSpec:
    """A checkout page where 'Apply coupon' is gated behind opening a
    'Have a coupon?' link first (MISSING_INFORMATION family)."""
    checkout = PageSpec(
        page_id="checkout", page_type="checkout",
        elements=[
            ElementSpec("coupon_link", "link", "Have a coupon?", "Have a coupon?", sets_flag="coupon_open"),
            ElementSpec("apply_coupon_btn", "button", "Apply coupon code", "Apply",
                        requires_flag="coupon_open"),
            ElementSpec("place_order_btn", "button", "Place order", "Place order"),
        ],
        transitions={"place_order_btn": "confirmation"},
    )
    confirmation = PageSpec(page_id="confirmation", page_type="confirmation", elements=[])
    return EnvironmentSpec(
        env_id=env_id, start_page="checkout",
        pages={"checkout": checkout, "confirmation": confirmation},
        goal_state="flag:coupon_open=true",
    )


def make_popup_environment(env_id: str) -> EnvironmentSpec:
    """A page that spawns an unexpected popup after the first action
    (CONTEXT_FAILURE family)."""
    landing = PageSpec(
        page_id="landing", page_type="landing",
        elements=[
            ElementSpec("dismiss_popup_btn", "button", "Dismiss newsletter popup", "No thanks"),
            ElementSpec("continue_btn", "button", "Continue to article", "Continue"),
        ],
        popup_after_actions=1,
        popup_close_element_id="dismiss_popup_btn",
        transitions={"continue_btn": "article"},
    )
    article = PageSpec(page_id="article", page_type="article", elements=[])
    return EnvironmentSpec(
        env_id=env_id, start_page="landing",
        pages={"landing": landing, "article": article},
        goal_state="page:article",
    )


def make_navigation_environment(env_id: str, *, broken: bool = True) -> EnvironmentSpec:
    """A nav menu whose 'Support' link points at a non-existent route unless
    ``broken=False`` (ENVIRONMENT_FAILURE family)."""
    home = PageSpec(
        page_id="home", page_type="home",
        elements=[ElementSpec("support_link", "link", "Go to support center", "Support")],
        transitions={"support_link": "__missing_route__"} if broken else {"support_link": "support"},
    )
    support = PageSpec(page_id="support", page_type="support", elements=[])
    return EnvironmentSpec(
        env_id=env_id, start_page="home",
        pages={"home": home, "support": support},
        goal_state="page:support",
    )


def make_verification_environment(env_id: str) -> EnvironmentSpec:
    """Placing an order sets a flag but does NOT change the page/URL, so a
    page-id-based verifier wrongly reports failure (VERIFICATION_FAILURE
    family) unless a flag-based check is used instead."""
    checkout = PageSpec(
        page_id="checkout", page_type="checkout",
        elements=[ElementSpec("place_order_btn", "button", "Place your order", "Place order",
                               sets_flag="order_placed")],
        transitions={},  # deliberately does not navigate away
    )
    return EnvironmentSpec(
        env_id=env_id, start_page="checkout",
        pages={"checkout": checkout},
        goal_state="flag:order_placed=true",
    )