"""SQLAlchemy models. Importing this package registers every table on `Base.metadata`."""

from app.models.api_key import ApiKey
from app.models.base import Base, new_id, utcnow
from app.models.contact import ContactRequest
from app.models.event import RequestLog, VerificationEvent
from app.models.project import Project, ProjectSettings
from app.models.session import SignalRecord, VerificationSession
from app.models.user import AuthSession, User
from app.models.webhook import WebhookDelivery, WebhookEndpoint

__all__ = [
    "ApiKey",
    "AuthSession",
    "Base",
    "ContactRequest",
    "Project",
    "ProjectSettings",
    "RequestLog",
    "SignalRecord",
    "User",
    "VerificationEvent",
    "VerificationSession",
    "WebhookDelivery",
    "WebhookEndpoint",
    "new_id",
    "utcnow",
]
