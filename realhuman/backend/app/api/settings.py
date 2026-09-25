from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentProject, DbSession, Now, TrustedOrigin
from app.models import Project, ProjectSettings
from app.schemas.dashboard import ProjectSettingsIn, ProjectSettingsOut

router = APIRouter(prefix="/v1/project", tags=["project"])


def _settings_of(project: Project, db: DbSession, now) -> ProjectSettings:
    if project.settings is None:
        project.settings = ProjectSettings(updated_at=now)
        db.commit()
    return project.settings


def _out(project: Project, settings: ProjectSettings) -> ProjectSettingsOut:
    return ProjectSettingsOut(
        project_name=project.name,
        site_key=project.site_key,
        allow_threshold=settings.allow_threshold,
        step_up_threshold=settings.step_up_threshold,
        retention_days=str(settings.retention_days),
    )


@router.get("/settings", response_model=ProjectSettingsOut)
def get_settings(project: CurrentProject, db: DbSession, now: Now) -> ProjectSettingsOut:
    return _out(project, _settings_of(project, db, now))


@router.put("/settings", response_model=ProjectSettingsOut, dependencies=[TrustedOrigin])
def update_settings(
    body: ProjectSettingsIn, project: CurrentProject, db: DbSession, now: Now
) -> ProjectSettingsOut:
    settings = _settings_of(project, db, now)
    project.name = body.project_name
    settings.allow_threshold = round(body.allow_threshold, 2)
    settings.step_up_threshold = round(body.step_up_threshold, 2)
    settings.retention_days = int(body.retention_days)
    settings.updated_at = now
    db.commit()
    return _out(project, settings)
