/**
 * GENERATED FILE — DO NOT EDIT.
 * Source: backend OpenAPI document (backend/docs/openapi.json). Regenerate with `npm run api:generate`.
 */
export interface paths {
    "/api/v1/acbe/candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List strategy candidates */
        get: operations["list_candidates_api_v1_acbe_candidates_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acbe/candidates/{candidate_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a strategy candidate with its experiments */
        get: operations["get_candidate_api_v1_acbe_candidates__candidate_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acbe/candidates/{candidate_id}/canary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve a canary rollout of a candidate that passed evaluation */
        post: operations["approve_canary_api_v1_acbe_candidates__candidate_id__canary_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acbe/candidates/{candidate_id}/evaluate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enqueue a baseline-vs-candidate experiment with the promotion gate */
        post: operations["evaluate_candidate_api_v1_acbe_candidates__candidate_id__evaluate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acbe/candidates/{candidate_id}/promote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Promote a canary after its observation period (failure rate must not increase) */
        post: operations["promote_candidate_api_v1_acbe_candidates__candidate_id__promote_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acbe/candidates/{candidate_id}/rollback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Roll back a canary/promoted strategy immediately */
        post: operations["rollback_candidate_api_v1_acbe_candidates__candidate_id__rollback_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/acbe/failures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Verified failure patterns of this organization (fingerprint, taxonomy, significance) */
        get: operations["list_failures_api_v1_acbe_failures_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/feature-flags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Feature flag defaults and overrides */
        get: operations["flags_api_v1_admin_feature_flags_get"];
        /** Create or update a flag override (global or per tenant) */
        put: operations["set_flag_api_v1_admin_feature_flags_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/jobs/{job_id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-queue a dead-lettered job */
        post: operations["retry_job_api_v1_admin_jobs__job_id__retry_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/jobs/dead": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Dead-lettered jobs */
        get: operations["dead_jobs_api_v1_admin_jobs_dead_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List organizations */
        get: operations["organizations_api_v1_admin_organizations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/organizations/{org_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change plan / suspend organization */
        patch: operations["update_org_api_v1_admin_organizations__org_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/security-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recent security events across tenants */
        get: operations["security_events_api_v1_admin_security_events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/system": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Workers, queue depth, dead letters, task states */
        get: operations["system_api_v1_admin_system_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/tasks/{task_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Inspect any task (audited) */
        get: operations["inspect_task_api_v1_admin_tasks__task_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Platform usage by tenant for the current month */
        get: operations["platform_usage_api_v1_admin_usage_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search users */
        get: operations["users_api_v1_admin_users_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Disable / re-enable a user (revokes sessions) */
        patch: operations["set_user_status_api_v1_admin_users__user_id__patch"];
        trace?: never;
    };
    "/api/v1/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List agents */
        get: operations["list_agents_api_v1_agents_get"];
        put?: never;
        /** Create an agent with its first immutable version */
        post: operations["create_agent_api_v1_agents_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agents/{agent_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an agent */
        get: operations["get_agent_api_v1_agents__agent_id__get"];
        put?: never;
        post?: never;
        /** Delete an agent (soft) */
        delete: operations["delete_agent_api_v1_agents__agent_id__delete"];
        options?: never;
        head?: never;
        /** Update agent metadata/status */
        patch: operations["update_agent_api_v1_agents__agent_id__patch"];
        trace?: never;
    };
    "/api/v1/agents/{agent_id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List agent versions */
        get: operations["list_versions_api_v1_agents__agent_id__versions_get"];
        put?: never;
        /** Publish a new immutable agent version (becomes current) */
        post: operations["add_version_api_v1_agents__agent_id__versions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List approval requests (own, or all with approvals:decide_any) */
        get: operations["list_approvals_api_v1_approvals_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/approvals/{approval_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an approval request */
        get: operations["get_approval_api_v1_approvals__approval_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/approvals/{approval_id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve a pending action (re-checked at execution; single use; expires) */
        post: operations["approve_api_v1_approvals__approval_id__approve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/approvals/{approval_id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject a pending action */
        post: operations["reject_api_v1_approvals__approval_id__reject_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Organization audit log (append-only) */
        get: operations["list_audit_api_v1_audit_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign in with e-mail and password */
        post: operations["login_api_v1_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke the current session */
        post: operations["logout_api_v1_auth_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke all sessions of the user */
        post: operations["logout_all_api_v1_auth_logout_all_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/mfa/{factor_id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm TOTP enrollment */
        post: operations["mfa_confirm_api_v1_auth_mfa__factor_id__confirm_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/mfa/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable MFA (requires a valid code) */
        post: operations["mfa_disable_api_v1_auth_mfa_disable_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/mfa/enroll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start TOTP MFA enrollment */
        post: operations["mfa_enroll_api_v1_auth_mfa_enroll_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/oauth/google/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Google sign-in callback */
        get: operations["google_login_callback_api_v1_auth_oauth_google_callback_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/oauth/google/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Begin Sign in with Google */
        get: operations["google_login_start_api_v1_auth_oauth_google_start_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password/change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Change password (revokes other sessions) */
        post: operations["change_password_api_v1_auth_password_change_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rotate the refresh token and get a new access token */
        post: operations["refresh_api_v1_auth_refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an account and a personal organization */
        post: operations["register_api_v1_auth_register_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's sessions/devices */
        get: operations["list_sessions_api_v1_auth_sessions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke a session */
        delete: operations["revoke_session_api_v1_auth_sessions__session_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/stream-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Short-lived token for EventSource (SSE) connections */
        post: operations["stream_token_api_v1_auth_stream_token_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/switch-organization": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Switch the active organization */
        post: operations["switch_org_api_v1_auth_switch_organization_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List your automations (newest first) */
        get: operations["list_automations_api_v1_automations_get"];
        put?: never;
        /** Create a scheduled automation (runs a task on a cron schedule) */
        post: operations["create_automation_api_v1_automations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/{automation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one of your automations */
        get: operations["get_automation_api_v1_automations__automation_id__get"];
        put?: never;
        post?: never;
        /** Delete an automation (soft delete; stops future runs) */
        delete: operations["delete_automation_api_v1_automations__automation_id__delete"];
        options?: never;
        head?: never;
        /** Update an automation (schedule, template, enabled, limits) */
        patch: operations["update_automation_api_v1_automations__automation_id__patch"];
        trace?: never;
    };
    "/api/v1/automations/{automation_id}/run-now": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Run an automation now (idempotent per minute: repeats return the same run) */
        post: operations["run_now_api_v1_automations__automation_id__run_now_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/{automation_id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List an automation's runs (newest first) */
        get: operations["list_runs_api_v1_automations__automation_id__runs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/billing/entitlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current plan and entitlements */
        get: operations["entitlements_api_v1_billing_entitlements_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/billing/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Available plans */
        get: operations["plans_api_v1_billing_plans_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evaluations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List evaluation runs */
        get: operations["list_runs_api_v1_evaluations_get"];
        put?: never;
        /** Enqueue an evaluation run of a suite (runs on the dedicated evaluation worker) */
        post: operations["create_run_api_v1_evaluations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evaluations/{run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an evaluation run with per-case results */
        get: operations["get_run_api_v1_evaluations__run_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evaluations/suites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Built-in evaluation suites and their cases */
        get: operations["list_suites_api_v1_evaluations_suites_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Live SSE stream of the user's task/approval/notification events */
        get: operations["user_stream_api_v1_events_stream_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/experiments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List experiments */
        get: operations["list_experiments_api_v1_experiments_get"];
        put?: never;
        /** Create a controlled experiment (first variant = control) */
        post: operations["create_experiment_api_v1_experiments_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/experiments/{experiment_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an experiment with its evaluation runs */
        get: operations["get_experiment_api_v1_experiments__experiment_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/experiments/{experiment_id}/decide": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Compute the winner with the statistical test and safety gates */
        post: operations["decide_experiment_api_v1_experiments__experiment_id__decide_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/experiments/{experiment_id}/rollback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Roll back an experiment's rollout immediately */
        post: operations["rollback_experiment_api_v1_experiments__experiment_id__rollback_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/experiments/{experiment_id}/rollout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Human rollout decision for the winner (canary, then promotion) */
        post: operations["set_rollout_api_v1_experiments__experiment_id__rollout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/experiments/{experiment_id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start: enqueue an evaluation run for every variant */
        post: operations["start_experiment_api_v1_experiments__experiment_id__start_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List your files */
        get: operations["list_files_api_v1_files_get"];
        put?: never;
        /** Upload a file */
        post: operations["upload_file_api_v1_files_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{file_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a file's metadata */
        get: operations["get_file_api_v1_files__file_id__get"];
        put?: never;
        post?: never;
        /** Delete a file and everything derived from it */
        delete: operations["delete_file_api_v1_files__file_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{file_id}/download-url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a short-lived download URL */
        get: operations["get_download_url_api_v1_files__file_id__download_url_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download a file via a signed link (local storage backend) */
        get: operations["download_api_v1_files_download_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Detailed health: dependencies and provider configuration */
        get: operations["health_api_v1_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's connected accounts (no tokens) */
        get: operations["list_integrations_api_v1_integrations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/{connection_id}/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh tokens now and report connected/expired/revoked/insufficient_scope status */
        post: operations["check_api_v1_integrations__connection_id__check_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/{connection_id}/disconnect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disconnect and revoke the provider tokens */
        post: operations["disconnect_api_v1_integrations__connection_id__disconnect_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/google/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** OAuth redirect target (authenticated by the single-use state) */
        get: operations["google_callback_api_v1_integrations_google_callback_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/google/connect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start connecting Google (Gmail/Calendar/Drive/Contacts) with least-privilege scopes */
        post: operations["connect_google_api_v1_integrations_google_connect_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness: the process is running */
        get: operations["live_api_v1_live_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the organization's MCP servers */
        get: operations["list_servers_api_v1_mcp_servers_get"];
        put?: never;
        /** Register an MCP server (pending admin review) */
        post: operations["register_server_api_v1_mcp_servers_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/servers/{server_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one MCP server */
        get: operations["get_server_api_v1_mcp_servers__server_id__get"];
        put?: never;
        post?: never;
        /** Delete an MCP server and its tools */
        delete: operations["delete_server_api_v1_mcp_servers__server_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/servers/{server_id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve an MCP server after review (re-vets its URL) */
        post: operations["approve_server_api_v1_mcp_servers__server_id__approve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/servers/{server_id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable an MCP server (all of its tools become unavailable) */
        post: operations["disable_server_api_v1_mcp_servers__server_id__disable_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/servers/{server_id}/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Discover the server's tools; changed tools are disabled until re-approved */
        post: operations["sync_server_api_v1_mcp_servers__server_id__sync_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/servers/{server_id}/tools": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the tools discovered on an MCP server */
        get: operations["list_server_tools_api_v1_mcp_servers__server_id__tools_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/tools/{tool_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Enable/disable an MCP tool or set its permission level, risk and approval requirement */
        patch: operations["update_tool_api_v1_mcp_tools__tool_id__patch"];
        trace?: never;
    };
    "/api/v1/memory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List your memories (newest first, cursor-paginated) */
        get: operations["list_memories_api_v1_memory_get"];
        put?: never;
        /** Remember something you state explicitly (deduplicated; may supersede an older value) */
        post: operations["create_memory_api_v1_memory_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memory/{memory_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a memory and its derived data (embedding, sources) */
        delete: operations["delete_memory_api_v1_memory__memory_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memory/{memory_id}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-affirm a memory (marks it fresh and trusted; resolves a conflict in its favour) */
        post: operations["verify_memory_api_v1_memory__memory_id__verify_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memory/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Hybrid search (keyword + semantic + recency + importance) over your memories */
        post: operations["search_memories_api_v1_memory_search_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List in-app notifications */
        get: operations["list_notifications_api_v1_notifications_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{notification_id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark as read */
        post: operations["mark_read_api_v1_notifications__notification_id__read_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark all as read */
        post: operations["mark_all_read_api_v1_notifications_read_all_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an organization (caller becomes owner) */
        post: operations["create_org_api_v1_organizations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The active organization */
        get: operations["current_org_api_v1_organizations_current_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Rename the active organization */
        patch: operations["update_org_api_v1_organizations_current_patch"];
        trace?: never;
    };
    "/api/v1/organizations/current/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List members */
        get: operations["members_api_v1_organizations_current_members_get"];
        put?: never;
        /** Add an existing user as a member */
        post: operations["add_member_api_v1_organizations_current_members_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/current/members/{member_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove member */
        delete: operations["remove_member_api_v1_organizations_current_members__member_id__delete"];
        options?: never;
        head?: never;
        /** Change member role */
        patch: operations["change_role_api_v1_organizations_current_members__member_id__patch"];
        trace?: never;
    };
    "/api/v1/organizations/current/policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Organization execution policy */
        get: operations["get_policy_api_v1_organizations_current_policy_get"];
        /** Replace organization execution policy */
        put: operations["put_policy_api_v1_organizations_current_policy_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Readiness: critical dependencies reachable (503 otherwise) */
        get: operations["ready_api_v1_ready_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/search/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Search your indexed documents (hybrid keyword + semantic) */
        post: operations["search_documents_api_v1_search_documents_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/search/web": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Search the web (ranked, deduplicated, cited) */
        post: operations["search_web_api_v1_search_web_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List tasks (newest first, cursor pagination) */
        get: operations["list_tasks_api_v1_tasks_get"];
        put?: never;
        /** Create a task from a natural-language goal (executed asynchronously by workers) */
        post: operations["create_task_api_v1_tasks_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Task with plan, steps, verification evidence */
        get: operations["get_task_api_v1_tasks__task_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel (cooperative; stops at a safe boundary) */
        post: operations["cancel_api_v1_tasks__task_id__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Ordered task events after a sequence number */
        get: operations["list_events_api_v1_tasks__task_id__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/events/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Server-Sent Events stream of task events (resumable) */
        get: operations["stream_events_api_v1_tasks__task_id__events_stream_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/input": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Answer the task's pending question */
        post: operations["provide_input_api_v1_tasks__task_id__input_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** User-safe execution log */
        get: operations["list_logs_api_v1_tasks__task_id__logs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pause a queued/running task */
        post: operations["pause_api_v1_tasks__task_id__pause_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume a paused/blocked/expired/failed task */
        post: operations["resume_api_v1_tasks__task_id__resume_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/steps/{step_id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm the real-world outcome of an action that could not be verified automatically */
        post: operations["confirm_step_api_v1_tasks__task_id__steps__step_id__confirm_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** User-facing execution summary (what happened / changed / verified) */
        get: operations["get_summary_api_v1_tasks__task_id__summary_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tools": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Tool catalogue with your effective permission for each */
        get: operations["list_tools_api_v1_tools_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tools/connect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Connect the account a tool provider needs (returns an OAuth authorization URL) */
        post: operations["connect_api_v1_tools_connect_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tools/policies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Organization tool policy rules */
        get: operations["list_rules_api_v1_tools_policies_get"];
        put?: never;
        /** Add an organization tool rule (deny / require_approval / allow) */
        post: operations["add_rule_api_v1_tools_policies_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tools/policies/{rule_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a tool rule */
        delete: operations["delete_rule_api_v1_tools_policies__rule_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Usage for the current month (yours, or org-wide for admins) */
        get: operations["usage_api_v1_usage_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current user, active organization and permissions */
        get: operations["me_api_v1_users_me_get"];
        put?: never;
        post?: never;
        /** Delete account (right to delete). Revokes sessions now; purges data asynchronously. */
        delete: operations["delete_me_api_v1_users_me_delete"];
        options?: never;
        head?: never;
        /** Update profile (display name, timezone, locale) */
        patch: operations["update_me_api_v1_users_me_patch"];
        trace?: never;
    };
    "/api/v1/users/me/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Organizations the user belongs to */
        get: operations["my_orgs_api_v1_users_me_organizations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhooks/{provider}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Receive a signed webhook (verified, replay-protected, idempotent) */
        post: operations["receive_api_v1_webhooks__provider__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AccountDeletionRequest */
        AccountDeletionRequest: {
            /**
             * Confirm
             * @description Must be true
             */
            confirm: boolean;
            /**
             * Password
             * @description Required for password accounts
             */
            password?: string | null;
        };
        /**
         * ActorType
         * @description Canonical ActorType values (published for API clients).
         * @enum {string}
         */
        ActorType: "user" | "system" | "worker" | "agent" | "scheduler" | "admin";
        /** AdminOrgOut */
        AdminOrgOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Data Region */
            data_region: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Plan */
            plan: string;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
        };
        /** AdminUserOut */
        AdminUserOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Email */
            email: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Is Platform Admin */
            is_platform_admin: boolean;
            /** Last Login At */
            last_login_at: string | null;
            /** Mfa Enabled */
            mfa_enabled: boolean;
            /** Status */
            status: string;
        };
        /** AgentCreate */
        AgentCreate: {
            /** Description */
            description?: string | null;
            execution_limits?: components["schemas"]["ExecutionLimits"];
            /**
             * Instructions
             * @default
             */
            instructions?: string;
            memory_policy?: components["schemas"]["MemoryPolicy"];
            model_policy?: components["schemas"]["ModelPolicy"];
            /** Name */
            name: string;
            tool_policy?: components["schemas"]["ToolPolicy"];
            verification_policy?: components["schemas"]["VerificationPolicy"];
        };
        /** AgentOut */
        AgentOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            current_version?: components["schemas"]["AgentVersionOut"] | null;
            /** Current Version Id */
            current_version_id: string | null;
            /** Description */
            description: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Status */
            status: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** AgentUpdate */
        AgentUpdate: {
            /** Description */
            description?: string | null;
            /** Status */
            status?: string | null;
        };
        /** AgentVersionIn */
        AgentVersionIn: {
            execution_limits?: components["schemas"]["ExecutionLimits"];
            /**
             * Instructions
             * @default
             */
            instructions?: string;
            memory_policy?: components["schemas"]["MemoryPolicy"];
            model_policy?: components["schemas"]["ModelPolicy"];
            tool_policy?: components["schemas"]["ToolPolicy"];
            verification_policy?: components["schemas"]["VerificationPolicy"];
        };
        /** AgentVersionOut */
        AgentVersionOut: {
            /**
             * Agent Id
             * Format: uuid
             */
            agent_id: string;
            /** Checksum */
            checksum: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Created By */
            created_by?: string | null;
            /**
             * Created By Name
             * @description Display name (or e-mail) of the author
             */
            created_by_name?: string | null;
            execution_limits?: components["schemas"]["ExecutionLimits"];
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Instructions
             * @default
             */
            instructions?: string;
            memory_policy?: components["schemas"]["MemoryPolicy"];
            model_policy?: components["schemas"]["ModelPolicy"];
            tool_policy?: components["schemas"]["ToolPolicy"];
            verification_policy?: components["schemas"]["VerificationPolicy"];
            /** Version Number */
            version_number: number;
        };
        /** ExperimentOut */
        app__acbe__router__ExperimentOut: {
            /** Baseline Metrics */
            baseline_metrics: {
                [key: string]: unknown;
            };
            /** Candidate Metrics */
            candidate_metrics: {
                [key: string]: unknown;
            };
            /** Completed At */
            completed_at: string | null;
            /** Confidence */
            confidence: number | null;
            /** Decision */
            decision: string | null;
            /** Decision Reason */
            decision_reason: string | null;
            /** Evaluation Suite */
            evaluation_suite: string;
            /** Experiment Version */
            experiment_version: number;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Regression Metrics */
            regression_metrics: {
                [key: string]: unknown;
            };
            /** Safety Checks */
            safety_checks: {
                [key: string]: unknown;
            };
            /**
             * Started At
             * Format: date-time
             */
            started_at: string;
            /** Status */
            status: string;
        };
        /** ExperimentOut */
        app__evaluation__schemas__ExperimentOut: {
            /** Approved At */
            approved_at: string | null;
            /** Approved By */
            approved_by: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Created By */
            created_by: string | null;
            /** Decided At */
            decided_at: string | null;
            /** Evaluation Set */
            evaluation_set: string;
            /** Hypothesis */
            hypothesis: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Kind */
            kind: string;
            /** Metrics */
            metrics: {
                [key: string]: unknown;
            };
            /** Name */
            name: string;
            /** Repetitions */
            repetitions: number;
            /** Rollback Reason */
            rollback_reason: string | null;
            /** Rolled Back At */
            rolled_back_at: string | null;
            /** Rollout Percentage */
            rollout_percentage: number;
            /** Safety Checks */
            safety_checks: {
                [key: string]: unknown;
            };
            /** Status */
            status: string;
            /** Strategy Candidate Id */
            strategy_candidate_id: string | null;
            /** Tenant Id */
            tenant_id: string | null;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Variants */
            variants: {
                [key: string]: unknown;
            }[];
            /** Winner Reason */
            winner_reason: string | null;
            /** Winner Variant */
            winner_variant: string | null;
        };
        /** ApprovalOut */
        ApprovalOut: {
            /** Action */
            action: string;
            /** Approved At */
            approved_at: string | null;
            /** Approved By */
            approved_by: string | null;
            /** Arguments Preview */
            arguments_preview: {
                [key: string]: unknown;
            };
            /** Consumed At */
            consumed_at: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            permission_level: components["schemas"]["PermissionLevel"];
            /** Reasons */
            reasons: string[];
            /** Rejected At */
            rejected_at: string | null;
            /** Rejected By */
            rejected_by: string | null;
            /** Rejection Reason */
            rejection_reason: string | null;
            risk_level: components["schemas"]["RiskLevel"];
            status: components["schemas"]["ApprovalStatus"];
            /**
             * Step Id
             * Format: uuid
             */
            step_id: string;
            /** Summary */
            summary: string;
            /** Target */
            target: string | null;
            /**
             * Task Id
             * Format: uuid
             */
            task_id: string;
            /** Tool Name */
            tool_name: string;
            /**
             * User Id
             * Format: uuid
             */
            user_id: string;
        };
        /**
         * ApprovalStatus
         * @enum {string}
         */
        ApprovalStatus: "pending" | "approved" | "rejected" | "expired" | "cancelled";
        /** ApproveRequest */
        ApproveRequest: {
            /** Note */
            note?: string | null;
        };
        /** AuditOut */
        AuditOut: {
            /** Action */
            action: string;
            /** Actor Type */
            actor_type: string;
            /** Approval Id */
            approval_id: string | null;
            /** Category */
            category: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Ip Address */
            ip_address: string | null;
            /** Metadata */
            metadata: {
                [key: string]: unknown;
            };
            /** Request Id */
            request_id: string | null;
            /** Resource Id */
            resource_id: string | null;
            /** Resource Type */
            resource_type: string | null;
            /** Result Summary */
            result_summary: string | null;
            /** Status */
            status: string;
            /** Step Id */
            step_id: string | null;
            /** Task Id */
            task_id: string | null;
            /** Tenant Id */
            tenant_id: string | null;
            /** Tool Name */
            tool_name: string | null;
            /** User Id */
            user_id: string | null;
        };
        /**
         * AutomationCreate
         * @example {
         *       "cron_expression": "0 8 * * 1-5",
         *       "name": "Morning inbox digest",
         *       "task_template": {
         *         "goal": "Summarize my unread e-mails from the last 24 hours."
         *       },
         *       "timezone": "Europe/Berlin"
         *     }
         */
        AutomationCreate: {
            /**
             * Cron Expression
             * @description 5-field cron expression; runs at most every 15 minutes
             */
            cron_expression: string;
            /**
             * Enabled
             * @default true
             */
            enabled?: boolean;
            /** Max Runs */
            max_runs?: number | null;
            /** Name */
            name: string;
            policy?: components["schemas"]["AutomationPolicy"];
            retry_policy?: components["schemas"]["RetryPolicy"];
            task_template: components["schemas"]["TaskTemplate"];
            /**
             * Timezone
             * @description IANA time zone the schedule is evaluated in
             * @default UTC
             */
            timezone?: string;
            /**
             * Trigger Type
             * @default schedule
             * @constant
             */
            trigger_type?: "schedule";
        };
        /** AutomationOut */
        AutomationOut: {
            /** Consecutive Failures */
            consecutive_failures: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Cron Expression */
            cron_expression: string;
            /** Disabled Reason */
            disabled_reason: string | null;
            /** Enabled */
            enabled: boolean;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Last Run At */
            last_run_at: string | null;
            /** Last Status */
            last_status: string | null;
            /** Max Runs */
            max_runs: number | null;
            /** Name */
            name: string;
            /** Next Run At */
            next_run_at: string | null;
            /** Policy */
            policy: {
                [key: string]: unknown;
            };
            /** Retry Policy */
            retry_policy: {
                [key: string]: unknown;
            };
            /** Run Count */
            run_count: number;
            /** Task Template */
            task_template: {
                [key: string]: unknown;
            };
            /** Timezone */
            timezone: string;
            /** Trigger Type */
            trigger_type: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version */
            version: number;
        };
        /** AutomationPolicy */
        AutomationPolicy: {
            /**
             * Max Consecutive Failures
             * @default 3
             */
            max_consecutive_failures?: number;
            /**
             * Pause On Failure
             * @default true
             */
            pause_on_failure?: boolean;
        };
        /** AutomationRunOut */
        AutomationRunOut: {
            /** Attempts */
            attempts: number;
            /**
             * Automation Id
             * Format: uuid
             */
            automation_id: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Error */
            error: string | null;
            /** Finished At */
            finished_at: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Next Attempt At */
            next_attempt_at: string | null;
            /**
             * Scheduled For
             * Format: date-time
             */
            scheduled_for: string;
            /** Status */
            status: string;
            /** Task Id */
            task_id: string | null;
            /** Trigger */
            trigger: string;
        };
        /**
         * AutomationRunStatus
         * @description Canonical AutomationRunStatus values (published for API clients).
         * @enum {string}
         */
        AutomationRunStatus: "created" | "succeeded" | "failed" | "skipped";
        /** AutomationUpdate */
        AutomationUpdate: {
            /** Cron Expression */
            cron_expression?: string | null;
            /** Enabled */
            enabled?: boolean | null;
            /**
             * Expected Version
             * @description Optimistic concurrency: reject if the version changed
             */
            expected_version?: number | null;
            /** Max Runs */
            max_runs?: number | null;
            /** Name */
            name?: string | null;
            policy?: components["schemas"]["AutomationPolicy"] | null;
            retry_policy?: components["schemas"]["RetryPolicy"] | null;
            task_template?: components["schemas"]["TaskTemplate"] | null;
            /** Timezone */
            timezone?: string | null;
        };
        /** Body_upload_file_api_v1_files_post */
        Body_upload_file_api_v1_files_post: {
            /**
             * File
             * @description The file to upload
             */
            file: string;
            /**
             * Purpose
             * @default user_upload
             * @enum {string}
             */
            purpose?: "user_upload" | "temp";
        };
        /** CanaryRequest */
        CanaryRequest: {
            /**
             * Rollout Percentage
             * @description Share of tasks (deterministic per task) on the canary
             */
            rollout_percentage: number;
        };
        /** CandidateDetail */
        CandidateDetail: {
            /** Approved At */
            approved_at: string | null;
            /** Approved By */
            approved_by: string | null;
            /** Candidate Config */
            candidate_config: {
                [key: string]: unknown;
            };
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Created By */
            created_by: string;
            /** Experiments */
            experiments?: components["schemas"]["app__acbe__router__ExperimentOut"][];
            /** Failed Strategy */
            failed_strategy: {
                [key: string]: unknown;
            };
            /** Failure Fingerprint */
            failure_fingerprint: string;
            /** Failure Type */
            failure_type: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Promoted At */
            promoted_at: string | null;
            /** Rationale */
            rationale: string;
            /** Rollback Reason */
            rollback_reason: string | null;
            /** Rolled Back At */
            rolled_back_at: string | null;
            /** Rollout Percentage */
            rollout_percentage: number;
            /** Scope */
            scope: string;
            /** Source Failure Ids */
            source_failure_ids: string[];
            /** Status */
            status: string;
            /** Tenant Id */
            tenant_id: string | null;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version Label */
            version_label: string;
        };
        /** CandidateOut */
        CandidateOut: {
            /** Approved At */
            approved_at: string | null;
            /** Approved By */
            approved_by: string | null;
            /** Candidate Config */
            candidate_config: {
                [key: string]: unknown;
            };
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Created By */
            created_by: string;
            /** Failed Strategy */
            failed_strategy: {
                [key: string]: unknown;
            };
            /** Failure Fingerprint */
            failure_fingerprint: string;
            /** Failure Type */
            failure_type: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Promoted At */
            promoted_at: string | null;
            /** Rationale */
            rationale: string;
            /** Rollback Reason */
            rollback_reason: string | null;
            /** Rolled Back At */
            rolled_back_at: string | null;
            /** Rollout Percentage */
            rollout_percentage: number;
            /** Scope */
            scope: string;
            /** Source Failure Ids */
            source_failure_ids: string[];
            /** Status */
            status: string;
            /** Tenant Id */
            tenant_id: string | null;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version Label */
            version_label: string;
        };
        /** ChangePasswordRequest */
        ChangePasswordRequest: {
            /** Current Password */
            current_password: string;
            /** New Password */
            new_password: string;
        };
        /** Citation */
        Citation: {
            /** Provider */
            provider: string;
            /** Relevance */
            relevance: number;
            /**
             * Retrieved At
             * Format: date-time
             */
            retrieved_at: string;
            /** Source Url */
            source_url: string;
            /** Title */
            title: string;
        };
        /** ConnectGoogleRequest */
        ConnectGoogleRequest: {
            /**
             * Capabilities
             * @description Least-privilege capability bundles
             */
            capabilities?: components["schemas"]["GoogleCapability"][];
            /** Login Hint */
            login_hint?: string | null;
        };
        /** ConnectGoogleResponse */
        ConnectGoogleResponse: {
            /** Authorization Url */
            authorization_url: string;
            /** Requested Scopes */
            requested_scopes: string[];
        };
        /** ConnectionOut */
        ConnectionOut: {
            /** Account Email */
            account_email: string | null;
            /** Capabilities */
            capabilities?: string[];
            /**
             * Connected At
             * Format: date-time
             */
            connected_at: string;
            /** Disconnected At */
            disconnected_at: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Last Error Code */
            last_error_code: string | null;
            /** Last Refreshed At */
            last_refreshed_at: string | null;
            /** Provider */
            provider: string;
            /** Scopes */
            scopes?: string[];
            /**
             * Status
             * @enum {string}
             */
            status: "connected" | "expired" | "revoked" | "insufficient_scope" | "temporarily_unavailable" | "disconnected";
            /** Token Expires At */
            token_expires_at: string | null;
        };
        /**
         * ConnectionStatus
         * @description Canonical ConnectionStatus values (published for API clients).
         * @enum {string}
         */
        ConnectionStatus: "connected" | "expired" | "revoked" | "insufficient_scope" | "temporarily_unavailable" | "disconnected";
        /** DocumentSearchHit */
        DocumentSearchHit: {
            /**
             * Chunk Id
             * Format: uuid
             */
            chunk_id: string;
            /** Chunk Index */
            chunk_index: number;
            /** Content */
            content: string;
            /**
             * Document Id
             * Format: uuid
             */
            document_id: string;
            /** Keyword Score */
            keyword_score?: number | null;
            /** Score */
            score: number;
            /** Source Id */
            source_id: string;
            /** Source Type */
            source_type: string;
            /** Title */
            title: string;
            /** Url */
            url?: string | null;
            /** Vector Score */
            vector_score?: number | null;
        };
        /** DocumentSearchRequest */
        DocumentSearchRequest: {
            /**
             * Limit
             * @default 10
             */
            limit?: number;
            /** Query */
            query: string;
        };
        /** DocumentSearchResponse */
        DocumentSearchResponse: {
            /** Query */
            query: string;
            /** Results */
            results: components["schemas"]["DocumentSearchHit"][];
            /** Used Vector Search */
            used_vector_search: boolean;
        };
        /** DownloadUrlOut */
        DownloadUrlOut: {
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /** Filename */
            filename: string;
            /**
             * Method
             * @default GET
             */
            method?: string;
            /** Url */
            url: string;
        };
        /** EntitlementsOut */
        EntitlementsOut: {
            /** Billing Provider */
            billing_provider: string;
            plan: components["schemas"]["PlanOut"];
        };
        /**
         * ErrorClass
         * @description Canonical ErrorClass values (published for API clients).
         * @enum {string}
         */
        ErrorClass: "transient" | "timeout" | "rate_limited" | "network_error" | "auth_expired" | "permission_denied" | "invalid_input" | "tool_unavailable" | "conflict" | "verification_failed" | "model_error" | "policy_blocked" | "needs_user_input" | "unknown_outcome" | "unknown";
        /** EvaluationResultOut */
        EvaluationResultOut: {
            /** Case Id */
            case_id: string;
            /** Category */
            category: string;
            /** Cost Usd */
            cost_usd: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Details */
            details: {
                [key: string]: unknown;
            };
            /** False Completion */
            false_completion: boolean;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Latency Ms */
            latency_ms: number;
            /** Passed */
            passed: boolean;
            /** Recovered */
            recovered: boolean | null;
            /** Repetition */
            repetition: number;
            /** Task Status */
            task_status: string | null;
            /** Tool Call Accuracy */
            tool_call_accuracy: number | null;
            /** Unauthorized Action */
            unauthorized_action: boolean;
            /** Verification Passed */
            verification_passed: boolean | null;
        };
        /** EvaluationRunCreate */
        EvaluationRunCreate: {
            /** Case Ids */
            case_ids?: string[] | null;
            /**
             * Label
             * @default baseline
             */
            label?: string;
            /**
             * Model Mode
             * @description scripted plans (deterministic) or the configured model for use_model cases
             * @default scripted
             * @enum {string}
             */
            model_mode?: "scripted" | "configured";
            /**
             * Platform
             * @description Platform-level run (platform administrators only)
             * @default false
             */
            platform?: boolean;
            /**
             * Repetitions
             * @default 1
             */
            repetitions?: number;
            /** @description Strategy pinned for every case (default: none) */
            strategy?: components["schemas"]["StrategyConfig"] | null;
            /**
             * Suite
             * @default core
             */
            suite?: string;
        };
        /** EvaluationRunDetail */
        EvaluationRunDetail: {
            /** Case Ids */
            case_ids: string[] | null;
            /** Completed At */
            completed_at: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Created By */
            created_by: string | null;
            /** Error */
            error: string | null;
            /** Experiment Id */
            experiment_id: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Metrics */
            metrics: {
                [key: string]: unknown;
            };
            /** Model */
            model: string;
            /** Repetitions */
            repetitions: number;
            /** Results */
            results?: components["schemas"]["EvaluationResultOut"][];
            /** Started At */
            started_at: string | null;
            /** Status */
            status: string;
            /** Strategy Config */
            strategy_config: {
                [key: string]: unknown;
            };
            /** Strategy Label */
            strategy_label: string;
            /** Suite */
            suite: string;
            /** Tenant Id */
            tenant_id: string | null;
            /** Variant */
            variant: string | null;
        };
        /** EvaluationRunOut */
        EvaluationRunOut: {
            /** Case Ids */
            case_ids: string[] | null;
            /** Completed At */
            completed_at: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Created By */
            created_by: string | null;
            /** Error */
            error: string | null;
            /** Experiment Id */
            experiment_id: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Metrics */
            metrics: {
                [key: string]: unknown;
            };
            /** Model */
            model: string;
            /** Repetitions */
            repetitions: number;
            /** Started At */
            started_at: string | null;
            /** Status */
            status: string;
            /** Strategy Config */
            strategy_config: {
                [key: string]: unknown;
            };
            /** Strategy Label */
            strategy_label: string;
            /** Suite */
            suite: string;
            /** Tenant Id */
            tenant_id: string | null;
            /** Variant */
            variant: string | null;
        };
        /**
         * EventType
         * @description Canonical EventType values (published for API clients).
         * @enum {string}
         */
        EventType: "TASK_CREATED" | "TASK_STATE_CHANGED" | "PLANNING_STARTED" | "PLAN_CREATED" | "PLAN_REJECTED" | "PLAN_VALIDATED" | "STEP_STARTED" | "STEP_COMPLETED" | "STEP_FAILED" | "STEP_SKIPPED" | "TOOL_CALL_STARTED" | "TOOL_CALL_FINISHED" | "APPROVAL_REQUIRED" | "APPROVAL_GRANTED" | "APPROVAL_REJECTED" | "APPROVAL_EXPIRED" | "INPUT_REQUIRED" | "INPUT_RECEIVED" | "RETRY_SCHEDULED" | "RECOVERY_STARTED" | "RECOVERY_DECIDED" | "RECONCILIATION_REQUIRED" | "RECONCILIATION_RESOLVED" | "VERIFICATION_STARTED" | "VERIFICATION_PASSED" | "VERIFICATION_FAILED" | "CANCEL_REQUESTED" | "TASK_PAUSED" | "TASK_RESUMED" | "TASK_COMPLETED" | "TASK_FAILED" | "TASK_CANCELLED" | "BUDGET_EXCEEDED" | "NOTIFICATION_CREATED";
        /** ExecutionLimits */
        ExecutionLimits: {
            /** Max Browser Actions */
            max_browser_actions?: number | null;
            /** Max Cost Usd */
            max_cost_usd?: number | null;
            /** Max Duration Seconds */
            max_duration_seconds?: number | null;
            /** Max Model Calls */
            max_model_calls?: number | null;
            /** Max Steps */
            max_steps?: number | null;
            /** Max Tool Calls */
            max_tool_calls?: number | null;
        };
        /** ExecutionLogOut */
        ExecutionLogOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Level */
            level: string;
            /** Message */
            message: string;
            /** Step Id */
            step_id: string | null;
        };
        /**
         * ExperimentCreate
         * @description The first variant is the control. Variants may only differ in ``StrategyConfig`` knobs.
         */
        ExperimentCreate: {
            /**
             * Evaluation Set
             * @default core
             */
            evaluation_set?: string;
            /**
             * Hypothesis
             * @default
             */
            hypothesis?: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "agent_version" | "planner_strategy" | "memory_retrieval" | "verification_strategy" | "recovery_strategy" | "acbe_strategy";
            /** Name */
            name: string;
            /**
             * Platform
             * @default false
             */
            platform?: boolean;
            /**
             * Repetitions
             * @default 1
             */
            repetitions?: number;
            /** Variants */
            variants: components["schemas"]["VariantSpec"][];
        };
        /** ExperimentDetail */
        ExperimentDetail: {
            /** Approved At */
            approved_at: string | null;
            /** Approved By */
            approved_by: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Created By */
            created_by: string | null;
            /** Decided At */
            decided_at: string | null;
            /** Evaluation Set */
            evaluation_set: string;
            /** Hypothesis */
            hypothesis: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Kind */
            kind: string;
            /** Metrics */
            metrics: {
                [key: string]: unknown;
            };
            /** Name */
            name: string;
            /** Repetitions */
            repetitions: number;
            /** Rollback Reason */
            rollback_reason: string | null;
            /** Rolled Back At */
            rolled_back_at: string | null;
            /** Rollout Percentage */
            rollout_percentage: number;
            /** Runs */
            runs?: components["schemas"]["EvaluationRunOut"][];
            /** Safety Checks */
            safety_checks: {
                [key: string]: unknown;
            };
            /** Status */
            status: string;
            /** Strategy Candidate Id */
            strategy_candidate_id: string | null;
            /** Tenant Id */
            tenant_id: string | null;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Variants */
            variants: {
                [key: string]: unknown;
            }[];
            /** Winner Reason */
            winner_reason: string | null;
            /** Winner Variant */
            winner_variant: string | null;
        };
        /**
         * ExtractionStatus
         * @description Canonical ExtractionStatus values (published for API clients).
         * @enum {string}
         */
        ExtractionStatus: "pending" | "completed" | "truncated" | "skipped" | "failed";
        /** FailurePatternOut */
        FailurePatternOut: {
            /** Error Class */
            error_class: string;
            /** Error Code */
            error_code: string;
            /** Failure Type */
            failure_type: string;
            /** Fingerprint */
            fingerprint: string;
            /**
             * First Seen
             * Format: date-time
             */
            first_seen: string;
            /**
             * Last Seen
             * Format: date-time
             */
            last_seen: string;
            /** Learnable */
            learnable: boolean;
            /** Occurrences */
            occurrences: number;
            /** Sample Message */
            sample_message: string;
            /** Significant */
            significant: boolean;
            /** Strategy Versions */
            strategy_versions: {
                [key: string]: number;
            };
            /** Tasks */
            tasks: number;
            /** Tool Name */
            tool_name: string | null;
        };
        /** FileMetadataOut */
        FileMetadataOut: {
            /** Char Count */
            char_count?: number | null;
            /** Chunk Count */
            chunk_count?: number | null;
            /** Extracted Summary */
            extracted_summary?: string | null;
            /** Extraction Status */
            extraction_status: string;
            /** Language */
            language?: string | null;
            /** Page Count */
            page_count?: number | null;
        };
        /** FileOut */
        FileOut: {
            /** Content Type */
            content_type: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Expires At */
            expires_at?: string | null;
            /** Filename */
            filename: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            metadata?: components["schemas"]["FileMetadataOut"] | null;
            /** Purpose */
            purpose: string;
            /** Scan Status */
            scan_status: string;
            /** Sha256 */
            sha256: string;
            /** Size Bytes */
            size_bytes: number;
            /** Status */
            status: string;
            /** Task Id */
            task_id?: string | null;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /**
             * User Id
             * Format: uuid
             */
            user_id: string;
        };
        /**
         * FileStatus
         * @description Canonical FileStatus values (published for API clients).
         * @enum {string}
         */
        FileStatus: "uploaded" | "processing" | "ready" | "quarantined" | "failed" | "deleted";
        /** FlagIn */
        FlagIn: {
            /** Description */
            description?: string | null;
            /** Enabled */
            enabled: boolean;
            /** Key */
            key: string;
            /**
             * Rollout Percentage
             * @default 100
             */
            rollout_percentage?: number;
            /** Tenant Id */
            tenant_id?: string | null;
        };
        /**
         * GoogleCapability
         * @description Least-privilege Google Workspace capability bundles (each maps to exact OAuth scopes).
         * @enum {string}
         */
        GoogleCapability: "gmail.read" | "gmail.compose" | "gmail.send" | "calendar.read" | "calendar.write" | "drive.read" | "drive.file" | "contacts.read";
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** LoginRequest */
        LoginRequest: {
            /** Device Name */
            device_name?: string | null;
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Mfa Code */
            mfa_code?: string | null;
            /** Password */
            password: string;
            /**
             * Token Delivery
             * @default body
             * @enum {string}
             */
            token_delivery?: "body" | "cookie";
        };
        /** MCPServerCreate */
        MCPServerCreate: {
            /**
             * Auth Credential Id
             * @description Use an existing tool credential as the header value instead.
             */
            auth_credential_id?: string | null;
            /**
             * Auth Header Name
             * @default Authorization
             */
            auth_header_name?: string;
            /**
             * Auth Header Value
             * @description Header value sent to the server (e.g. 'Bearer …'). Stored encrypted.
             */
            auth_header_value?: string | null;
            /**
             * Name
             * @description Slug used in tool names: mcp.<name>.<tool>
             */
            name: string;
            /**
             * Rate Limit Per Minute
             * @default 60
             */
            rate_limit_per_minute?: number;
            /** Timeout Seconds */
            timeout_seconds?: number | null;
            /**
             * Transport
             * @description Only Streamable HTTP is supported; stdio would mean running tenant-chosen processes.
             * @default streamable_http
             * @constant
             */
            transport?: "streamable_http";
            /**
             * Url
             * @description Streamable HTTP endpoint (https://…/mcp)
             */
            url: string;
        };
        /**
         * MCPServerOut
         * @description Server as returned by the API. Never contains credentials.
         */
        MCPServerOut: {
            /** Approved At */
            approved_at: string | null;
            /** Approved By */
            approved_by: string | null;
            /** Auth Credential Id */
            auth_credential_id: string | null;
            /** Auth Header Name */
            auth_header_name: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Created By */
            created_by: string | null;
            /** Has Auth */
            has_auth: boolean;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Last Error */
            last_error: string | null;
            /** Last Sync At */
            last_sync_at: string | null;
            /** Name */
            name: string;
            /** Protocol Version */
            protocol_version: string | null;
            /** Rate Limit Per Minute */
            rate_limit_per_minute: number;
            /** Server Info */
            server_info: {
                [key: string]: unknown;
            };
            /** Status */
            status: string;
            /** Timeout Seconds */
            timeout_seconds: number;
            /** Transport */
            transport: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Url */
            url: string;
        };
        /**
         * MCPServerStatus
         * @description Canonical MCPServerStatus values (published for API clients).
         * @enum {string}
         */
        MCPServerStatus: "pending_review" | "approved" | "disabled" | "error";
        /** MCPSyncResult */
        MCPSyncResult: {
            /** Added */
            added?: string[];
            /** Rejected */
            rejected?: components["schemas"]["RejectedTool"][];
            /** Removed */
            removed?: string[];
            /**
             * Schema Changed
             * @description Disabled pending re-approval
             */
            schema_changed?: string[];
            server: components["schemas"]["MCPServerOut"];
            /** Tools */
            tools?: components["schemas"]["MCPToolOut"][];
            /**
             * Truncated
             * @description The server advertised more tools than the gateway accepts
             * @default false
             */
            truncated?: boolean;
            /** Unchanged */
            unchanged?: string[];
            /** Updated */
            updated?: string[];
        };
        /** MCPToolOut */
        MCPToolOut: {
            /**
             * Annotations
             * @description Server-provided hints; advisory only, never trusted
             */
            annotations: {
                [key: string]: unknown;
            };
            /** Approved At */
            approved_at: string | null;
            /** Approved By */
            approved_by: string | null;
            /** Approved Schema Hash */
            approved_schema_hash: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Description */
            description: string;
            /** Enabled */
            enabled: boolean;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Input Schema */
            input_schema: {
                [key: string]: unknown;
            };
            /** Last Seen At */
            last_seen_at: string | null;
            /** Output Schema */
            output_schema: {
                [key: string]: unknown;
            } | null;
            permission_level: components["schemas"]["PermissionLevel"];
            /** Qualified Name */
            qualified_name: string;
            /** Remote Name */
            remote_name: string;
            /** Requires Approval */
            requires_approval: boolean;
            risk_level: components["schemas"]["RiskLevel"];
            /** Schema Approved */
            schema_approved: boolean;
            /** Schema Hash */
            schema_hash: string;
            /**
             * Server Id
             * Format: uuid
             */
            server_id: string;
            /** Status */
            status: string;
            /** Title */
            title: string | null;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /**
             * Usable
             * @description Enabled, active, schema approved and server approved
             */
            usable: boolean;
        };
        /**
         * MCPToolStatus
         * @description Canonical MCPToolStatus values (published for API clients).
         * @enum {string}
         */
        MCPToolStatus: "active" | "schema_changed" | "removed";
        /**
         * MCPToolUpdate
         * @description Admin decision about one tool. Enabling approves the tool's *current* schema.
         */
        MCPToolUpdate: {
            /** Enabled */
            enabled?: boolean | null;
            permission_level?: components["schemas"]["PermissionLevel"] | null;
            /** Requires Approval */
            requires_approval?: boolean | null;
            risk_level?: components["schemas"]["RiskLevel"] | null;
        };
        /** MemberAdd */
        MemberAdd: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /** @default member */
            role?: components["schemas"]["SystemRole"];
        };
        /** MemberOut */
        MemberOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Display Name */
            display_name: string | null;
            /** Email */
            email: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Role */
            role: string;
            /** Status */
            status: string;
            /**
             * User Id
             * Format: uuid
             */
            user_id: string;
        };
        /** MemberRoleUpdate */
        MemberRoleUpdate: {
            role: components["schemas"]["SystemRole"];
        };
        /**
         * MemoryCreate
         * @description A memory the user states explicitly (highest trust: confidence 1.0).
         */
        MemoryCreate: {
            /** Content */
            content: string;
            /** Expires At */
            expires_at?: string | null;
            /**
             * Importance
             * @default 0.7
             */
            importance?: number;
            /** @default long_term */
            memory_type?: components["schemas"]["MemoryType"];
            /**
             * Subject Key
             * @description Optional normalized key for conflict detection, e.g. 'contact:rahim:email' or 'pref:meeting_length'
             */
            subject_key?: string | null;
        };
        /** MemoryOut */
        MemoryOut: {
            /** Access Count */
            access_count: number;
            /** Confidence */
            confidence: number;
            /** Content */
            content: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Expires At */
            expires_at: string | null;
            /**
             * Freshness
             * @enum {string}
             */
            freshness: "fresh" | "stale" | "unverified";
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Importance */
            importance: number;
            /** Last Accessed At */
            last_accessed_at: string | null;
            /**
             * Last Verified At
             * Format: date-time
             */
            last_verified_at: string;
            /** Memory Type */
            memory_type: string;
            /** Source Reference */
            source_reference: string;
            /** Source Type */
            source_type: string;
            /** Status */
            status: string;
            /** Subject Key */
            subject_key: string | null;
            /** Superseded By */
            superseded_by: string | null;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** MemoryPolicy */
        MemoryPolicy: {
            /**
             * Enabled
             * @default true
             */
            enabled?: boolean;
            /**
             * Extract After Task
             * @default true
             */
            extract_after_task?: boolean;
            /**
             * Max Items
             * @default 8
             */
            max_items?: number;
        };
        /** MemorySearchRequest */
        MemorySearchRequest: {
            /**
             * Limit
             * @default 8
             */
            limit?: number;
            /** Memory Types */
            memory_types?: components["schemas"]["MemoryType"][] | null;
            /** Query */
            query: string;
        };
        /** MemorySearchResponse */
        MemorySearchResponse: {
            /** Results */
            results: components["schemas"]["RetrievedMemory"][];
        };
        /**
         * MemoryStatus
         * @description Canonical MemoryStatus values (published for API clients).
         * @enum {string}
         */
        MemoryStatus: "active" | "superseded" | "conflicted" | "deleted";
        /**
         * MemoryType
         * @enum {string}
         */
        MemoryType: "conversational" | "short_term" | "long_term" | "semantic" | "preference" | "task_history" | "verified_fact" | "contact";
        /** MemoryWeights */
        MemoryWeights: {
            /**
             * Importance
             * @default 0.2
             */
            importance?: number;
            /**
             * Keyword
             * @default 0.25
             */
            keyword?: number;
            /**
             * Recency
             * @default 0.1
             */
            recency?: number;
            /**
             * Semantic
             * @default 0.45
             */
            semantic?: number;
        };
        /** MeOut */
        MeOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Display Name */
            display_name: string | null;
            /** Email */
            email: string;
            /** Email Verified */
            email_verified: boolean;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Is Platform Admin */
            is_platform_admin: boolean;
            /** Last Login At */
            last_login_at: string | null;
            /** Locale */
            locale: string;
            /** Mfa Enabled */
            mfa_enabled: boolean;
            /** Permissions */
            permissions: string[];
            /** Role */
            role: string;
            /** Status */
            status: string;
            /**
             * Tenant Id
             * Format: uuid
             */
            tenant_id: string;
            /** Timezone */
            timezone: string;
        };
        /** MfaCodeRequest */
        MfaCodeRequest: {
            /** Code */
            code: string;
        };
        /** MfaEnrollResponse */
        MfaEnrollResponse: {
            /**
             * Factor Id
             * Format: uuid
             */
            factor_id: string;
            /** Otpauth Uri */
            otpauth_uri: string;
            /** Secret */
            secret: string;
        };
        /** ModelPolicy */
        ModelPolicy: {
            /** Default */
            default?: string | null;
            /** Fallbacks */
            fallbacks?: string[];
            /** Fast */
            fast?: string | null;
            /**
             * Planning Tier
             * @default default
             */
            planning_tier?: string;
            /** Reasoning */
            reasoning?: string | null;
        };
        /**
         * NotificationEvent
         * @description Canonical NotificationEvent values (published for API clients).
         * @enum {string}
         */
        NotificationEvent: "approval_required" | "input_required" | "task_completed" | "task_failed" | "automation_failed" | "connection_expired" | "security_alert";
        /** NotificationOut */
        NotificationOut: {
            /** Body */
            body: string;
            /** Channel */
            channel: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Data */
            data: {
                [key: string]: unknown;
            };
            /** Event Type */
            event_type: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Read At */
            read_at: string | null;
            /** Status */
            status: string;
            /** Title */
            title: string;
        };
        /** OAuthStartResponse */
        OAuthStartResponse: {
            /** Authorization Url */
            authorization_url: string;
            /** State */
            state: string;
        };
        /** OrganizationCreate */
        OrganizationCreate: {
            /** Name */
            name: string;
        };
        /** OrganizationOut */
        OrganizationOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Data Region */
            data_region: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Is Personal */
            is_personal: boolean;
            /** Name */
            name: string;
            /** Plan */
            plan: string;
            /** Role */
            role?: string | null;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
        };
        /**
         * OrganizationPolicy
         * @description Tenant-level execution policy. Stored in organizations.policy and versioned.
         */
        OrganizationPolicy: {
            /**
             * Allow Destructive Actions
             * @default false
             */
            allow_destructive_actions?: boolean;
            /**
             * Allow Financial Actions
             * @default false
             */
            allow_financial_actions?: boolean;
            /** Always Require Approval */
            always_require_approval?: string[];
            /** Approval Ttl Seconds */
            approval_ttl_seconds?: number | null;
            /** Blocked Tools */
            blocked_tools?: string[];
            /** Browser Allowed Domains */
            browser_allowed_domains?: string[];
            /** Browser Denied Domains */
            browser_denied_domains?: string[];
            /** Extra */
            extra?: {
                [key: string]: unknown;
            };
            /** Internal Email Domains */
            internal_email_domains?: string[];
            /** Max Concurrent Tasks */
            max_concurrent_tasks?: number | null;
        };
        /** OrganizationUpdate */
        OrganizationUpdate: {
            /** Name */
            name?: string | null;
        };
        /** OrgPlanUpdate */
        OrgPlanUpdate: {
            /** Plan */
            plan: string;
            /** Status */
            status?: ("active" | "suspended") | null;
        };
        /** Page[AgentOut] */
        Page_AgentOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["AgentOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[ApprovalOut] */
        Page_ApprovalOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["ApprovalOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[AuditOut] */
        Page_AuditOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["AuditOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[AutomationOut] */
        Page_AutomationOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["AutomationOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[AutomationRunOut] */
        Page_AutomationRunOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["AutomationRunOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[CandidateOut] */
        Page_CandidateOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["CandidateOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[EvaluationRunOut] */
        Page_EvaluationRunOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["EvaluationRunOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[ExperimentOut] */
        Page_ExperimentOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["app__evaluation__schemas__ExperimentOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[FileOut] */
        Page_FileOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["FileOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[MemoryOut] */
        Page_MemoryOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["MemoryOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[NotificationOut] */
        Page_NotificationOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["NotificationOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /** Page[TaskOut] */
        Page_TaskOut_: {
            /**
             * Has More
             * @default false
             */
            has_more?: boolean;
            /** Items */
            items: components["schemas"]["TaskOut"][];
            /**
             * Next Cursor
             * @description Opaque cursor for the next page
             */
            next_cursor?: string | null;
        };
        /**
         * PermissionCode
         * @description Canonical PermissionCode values (published for API clients).
         * @enum {string}
         */
        PermissionCode: "tasks:create" | "tasks:read" | "tasks:read_all" | "tasks:cancel" | "approvals:decide" | "approvals:decide_any" | "agents:read" | "agents:manage" | "memory:read" | "memory:write" | "tools:read" | "tools:manage" | "integrations:manage" | "automations:manage" | "files:read" | "files:write" | "audit:read" | "usage:read" | "members:manage" | "org:manage" | "mcp:manage" | "billing:manage" | "experiments:manage" | "search:use";
        /**
         * PermissionLevel
         * @description What class of effect a tool/action has on the outside world.
         * @enum {string}
         */
        PermissionLevel: "read" | "write" | "high_risk_write" | "destructive" | "financial" | "admin";
        /** PlanOut */
        PlanOut: {
            /** Display Name */
            display_name: string;
            /** Features */
            features: string[];
            /** Max Automations */
            max_automations: number;
            /** Max Concurrent Tasks */
            max_concurrent_tasks: number;
            /** Max Members */
            max_members: number;
            /** Monthly Quotas */
            monthly_quotas: {
                [key: string]: number;
            };
            /** Name */
            name: string;
        };
        /** PolicyOut */
        PolicyOut: {
            policy: components["schemas"]["OrganizationPolicy"];
            /** Policy Version */
            policy_version: number;
        };
        /** ReadbackTuning */
        ReadbackTuning: {
            /** Attempts */
            attempts: number;
            /** Delay Ms */
            delay_ms: number;
        };
        /**
         * RecoveryAction
         * @description Canonical RecoveryAction values (published for API clients).
         * @enum {string}
         */
        RecoveryAction: "retry" | "reconcile" | "repair" | "request_user" | "block" | "fail";
        /** RefreshRequest */
        RefreshRequest: {
            /** Refresh Token */
            refresh_token?: string | null;
            /**
             * Token Delivery
             * @default body
             * @enum {string}
             */
            token_delivery?: "body" | "cookie";
        };
        /** RegisterRequest */
        RegisterRequest: {
            /** Display Name */
            display_name?: string | null;
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Organization Name */
            organization_name?: string | null;
            /** Password */
            password: string;
            /**
             * Timezone
             * @default UTC
             */
            timezone?: string;
        };
        /** RejectedTool */
        RejectedTool: {
            /** Name */
            name: string;
            /** Reason */
            reason: string;
        };
        /** RejectRequest */
        RejectRequest: {
            /** Reason */
            reason: string;
        };
        /**
         * RetrievedMemory
         * @description A memory returned by retrieval, with the signals a consumer needs to weigh it.
         *
         *     ``freshness`` is ``"unverified"`` for low-confidence or conflicted memories and ``"stale"``
         *     when the memory has not been re-verified within its type's maximum age: consumers must
         *     treat such memories as hints to confirm, never as ground truth.
         */
        RetrievedMemory: {
            /** Confidence */
            confidence: number;
            /** Content */
            content: string;
            /**
             * Freshness
             * @enum {string}
             */
            freshness: "fresh" | "stale" | "unverified";
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Importance */
            importance: number;
            /**
             * Last Verified At
             * Format: date-time
             */
            last_verified_at: string;
            /** Memory Type */
            memory_type: string;
            /** Score */
            score: number;
            /** Source Reference */
            source_reference: string;
            /** Source Type */
            source_type: string;
            /**
             * Status
             * @default active
             */
            status?: string;
            /** Subject Key */
            subject_key?: string | null;
        };
        /**
         * RetryPolicy
         * @description Retries for *materializing* a run (e.g. the owner is at the active-task limit).
         */
        RetryPolicy: {
            /**
             * Backoff Seconds
             * @default 60
             */
            backoff_seconds?: number;
            /**
             * Max Attempts
             * @default 3
             */
            max_attempts?: number;
        };
        /**
         * RiskLevel
         * @enum {string}
         */
        RiskLevel: "low" | "medium" | "high" | "critical";
        /** RollbackRequest */
        RollbackRequest: {
            /** Reason */
            reason: string;
        };
        /** RolloutRequest */
        RolloutRequest: {
            /**
             * Rollout Percentage
             * @description 1–99 = canary, 100 = promote (after the canary)
             */
            rollout_percentage: number;
        };
        /** SessionOut */
        SessionOut: {
            /** Auth Method */
            auth_method: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Current
             * @default false
             */
            current?: boolean;
            /** Device Name */
            device_name: string | null;
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Ip Address */
            ip_address: string | null;
            /**
             * Last Seen At
             * Format: date-time
             */
            last_seen_at: string;
            /** Revoked At */
            revoked_at: string | null;
            /** User Agent */
            user_agent: string | null;
        };
        /** StepConfirmation */
        StepConfirmation: {
            /** Note */
            note?: string | null;
            /**
             * Outcome
             * @enum {string}
             */
            outcome: "succeeded" | "did_not_happen";
        };
        /** StepOut */
        StepOut: {
            /** Action */
            action: string;
            /** Approval Request Id */
            approval_request_id: string | null;
            /** Attempt Count */
            attempt_count: number;
            /** Completed At */
            completed_at: string | null;
            /** Error Class */
            error_class: string | null;
            /** Error Message */
            error_message: string | null;
            /** External Ref */
            external_ref: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Output Summary */
            output_summary: string | null;
            /** Output Trust */
            output_trust: string | null;
            permission_level: components["schemas"]["PermissionLevel"];
            /** Plan Version */
            plan_version: number;
            /** Policy Reasons */
            policy_reasons: string[];
            /** Position */
            position: number;
            /** Requires Approval */
            requires_approval: boolean;
            risk_level: components["schemas"]["RiskLevel"];
            /** Started At */
            started_at: string | null;
            status: components["schemas"]["StepStatus"];
            /** Step Key */
            step_key: string;
            /** Tool Name */
            tool_name: string;
            /** Tool Version */
            tool_version: string;
            /** Verification Method */
            verification_method: string;
            verification_status: components["schemas"]["VerificationStatus"];
        };
        /**
         * StepStatus
         * @enum {string}
         */
        StepStatus: "pending" | "waiting_approval" | "waiting_input" | "running" | "waiting_external" | "verifying" | "retry_scheduled" | "requires_reconciliation" | "completed" | "failed" | "skipped" | "cancelled" | "blocked";
        /**
         * StrategyConfig
         * @description The complete set of knobs ACBE may turn. Anything else is rejected by schema.
         */
        StrategyConfig: {
            /** Browser Locator Order */
            browser_locator_order?: ("role" | "label" | "text" | "test_id" | "css")[];
            memory_weights?: components["schemas"]["MemoryWeights"] | null;
            /** Planner Hints */
            planner_hints?: string[];
            /** Tool Retry */
            tool_retry?: {
                [key: string]: components["schemas"]["ToolRetryTuning"];
            };
            /** Verification Readback */
            verification_readback?: {
                [key: string]: components["schemas"]["ReadbackTuning"];
            };
        };
        /** StreamTokenResponse */
        StreamTokenResponse: {
            /** Expires In */
            expires_in: number;
            /** Token */
            token: string;
        };
        /** SuiteCaseOut */
        SuiteCaseOut: {
            /** Category */
            category: string;
            /** Description */
            description: string;
            /** Goal */
            goal: string;
            /** Id */
            id: string;
        };
        /** SuiteOut */
        SuiteOut: {
            /** Cases */
            cases: components["schemas"]["SuiteCaseOut"][];
            /** Name */
            name: string;
        };
        /** SummaryChangeItem */
        SummaryChangeItem: {
            /** Description */
            description?: string | null;
            /** External Ref */
            external_ref?: string | null;
            /** Step */
            step: string;
            /** Tool */
            tool: string;
        };
        /** SummaryFailureItem */
        SummaryFailureItem: {
            /** Error Class */
            error_class?: string | null;
            /** Message */
            message?: string | null;
            status: components["schemas"]["StepStatus"];
            /** Step */
            step: string;
            /** Tool */
            tool: string;
        };
        /** SummaryStepItem */
        SummaryStepItem: {
            /** Action */
            action: string;
            status: components["schemas"]["StepStatus"];
            /** Step */
            step: string;
            /** Summary */
            summary?: string | null;
            /** Tool */
            tool: string;
        };
        /** SummaryVerificationItem */
        SummaryVerificationItem: {
            /** Differences */
            differences?: (string | null)[];
            /** Method */
            method: string;
            status: components["schemas"]["VerificationStatus"];
            /** Step */
            step: string;
        };
        /** SummaryWaitingItem */
        SummaryWaitingItem: {
            /** Approval Id */
            approval_id?: string | null;
            /** Expires At */
            expires_at?: string | null;
            /** Message */
            message?: string | null;
            /** Question */
            question?: string | null;
            /** Step */
            step?: string | null;
            /** Summary */
            summary?: string | null;
            /**
             * Type
             * @enum {string}
             */
            type: "approval" | "input" | "confirm_outcome";
        };
        /** SwitchOrganizationRequest */
        SwitchOrganizationRequest: {
            /**
             * Organization Id
             * Format: uuid
             */
            organization_id: string;
        };
        /**
         * SystemRole
         * @enum {string}
         */
        SystemRole: "owner" | "admin" | "member" | "viewer";
        /**
         * TaskCreate
         * @example {
         *       "goal": "Check my calendar tomorrow, find a free 30-minute slot after 2 PM, schedule a meeting with Rahim, and send him a confirmation email."
         *     }
         */
        TaskCreate: {
            /**
             * Agent Id
             * @description Agent to use (default: built-in agent)
             */
            agent_id?: string | null;
            /**
             * Context
             * @description Optional extra context from the user
             */
            context?: string | null;
            /**
             * Goal
             * @description Natural-language goal
             */
            goal: string;
            /** Max Duration Seconds */
            max_duration_seconds?: number | null;
            /**
             * Priority
             * @description Lower runs sooner
             * @default 100
             */
            priority?: number;
        };
        /** TaskDetail */
        TaskDetail: {
            /** Agent Id */
            agent_id: string | null;
            /** Agent Version Id */
            agent_version_id: string | null;
            /** Completed At */
            completed_at: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Failure Code */
            failure_code: string | null;
            /** Failure Message */
            failure_message: string | null;
            /** Goal */
            goal: string;
            /** Model Calls */
            model_calls: number;
            /** Pending Questions */
            pending_questions: string[] | null;
            /** Plan */
            plan?: {
                [key: string]: unknown;
            } | null;
            /** Plan Version */
            plan_version: number;
            /** Priority */
            priority: number;
            /** Progress */
            progress: number;
            /** Reproducibility */
            reproducibility?: {
                [key: string]: unknown;
            };
            /** Result Summary */
            result_summary: {
                [key: string]: unknown;
            } | null;
            /** Started At */
            started_at: string | null;
            status: components["schemas"]["TaskStatus"];
            /** Steps */
            steps?: components["schemas"]["StepOut"][];
            /**
             * Task Id
             * Format: uuid
             */
            task_id: string;
            /** Tool Calls */
            tool_calls: number;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Verifications */
            verifications?: components["schemas"]["VerificationOut"][];
        };
        /** TaskEventOut */
        TaskEventOut: {
            /** Actor Type */
            actor_type: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Event Type */
            event_type: string;
            /** Payload */
            payload: {
                [key: string]: unknown;
            };
            /** Seq */
            seq: number;
            /** Step Id */
            step_id: string | null;
        };
        /** TaskEventsPage */
        TaskEventsPage: {
            /** Items */
            items: components["schemas"]["TaskEventOut"][];
            /** Next After Seq */
            next_after_seq: number | null;
        };
        /** TaskInput */
        TaskInput: {
            /** Answer */
            answer: string;
        };
        /** TaskOut */
        TaskOut: {
            /** Agent Id */
            agent_id: string | null;
            /** Agent Version Id */
            agent_version_id: string | null;
            /** Completed At */
            completed_at: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Failure Code */
            failure_code: string | null;
            /** Failure Message */
            failure_message: string | null;
            /** Goal */
            goal: string;
            /** Model Calls */
            model_calls: number;
            /** Pending Questions */
            pending_questions: string[] | null;
            /** Plan Version */
            plan_version: number;
            /** Priority */
            priority: number;
            /** Progress */
            progress: number;
            /** Result Summary */
            result_summary: {
                [key: string]: unknown;
            } | null;
            /** Started At */
            started_at: string | null;
            status: components["schemas"]["TaskStatus"];
            /**
             * Task Id
             * Format: uuid
             */
            task_id: string;
            /** Tool Calls */
            tool_calls: number;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * TaskStatus
         * @enum {string}
         */
        TaskStatus: "created" | "planning" | "planned" | "validating" | "waiting_approval" | "waiting_input" | "queued" | "running" | "verifying" | "recovering" | "requires_reconciliation" | "paused" | "cancel_requested" | "completed" | "failed" | "cancelled" | "blocked" | "expired";
        /**
         * TaskSummaryOut
         * @description Deterministic, user-facing account of a task: built from recorded steps and verifications only.
         */
        TaskSummaryOut: {
            /** Direct Response */
            direct_response?: string | null;
            /** Direct Response Note */
            direct_response_note?: string | null;
            /** Headline */
            headline: string;
            /** Partial Completion */
            partial_completion: boolean;
            status: components["schemas"]["TaskStatus"];
            /** Waiting For User */
            waiting_for_user: components["schemas"]["SummaryWaitingItem"][];
            /** What Changed */
            what_changed: components["schemas"]["SummaryChangeItem"][];
            /** What Failed */
            what_failed: components["schemas"]["SummaryFailureItem"][];
            /** What Happened */
            what_happened: components["schemas"]["SummaryStepItem"][];
            /** What Was Verified */
            what_was_verified: components["schemas"]["SummaryVerificationItem"][];
        };
        /**
         * TaskTemplate
         * @description The task each run creates (a subset of ``TaskCreate``).
         */
        TaskTemplate: {
            /** Agent Id */
            agent_id?: string | null;
            /** Context */
            context?: string | null;
            /** Goal */
            goal: string;
            /** Max Duration Seconds */
            max_duration_seconds?: number | null;
            /**
             * Priority
             * @default 100
             */
            priority?: number;
        };
        /** TokenResponse */
        TokenResponse: {
            /** Access Token */
            access_token: string;
            /** Expires In */
            expires_in: number;
            /**
             * Refresh Token
             * @description Omitted when delivered as an HttpOnly cookie
             */
            refresh_token?: string | null;
            /**
             * Session Id
             * Format: uuid
             */
            session_id: string;
            /**
             * Tenant Id
             * Format: uuid
             */
            tenant_id: string;
            /**
             * Token Type
             * @default bearer
             * @constant
             */
            token_type?: "bearer";
            /**
             * User Id
             * Format: uuid
             */
            user_id: string;
        };
        /** ToolConnectRequest */
        ToolConnectRequest: {
            /** Capabilities */
            capabilities: components["schemas"]["GoogleCapability"][];
            /**
             * Provider
             * @constant
             */
            provider: "google";
        };
        /** ToolOut */
        ToolOut: {
            /** Available To You */
            available_to_you: boolean;
            /** Category */
            category: string;
            /** Description */
            description: string;
            /**
             * Idempotency Strategy
             * @description native_key | reconcile_lookup | none
             */
            idempotency_strategy: string;
            /** Input Schema */
            input_schema: {
                [key: string]: unknown;
            };
            /**
             * Max Attempts
             * @description Attempts including the first (retry policy)
             */
            max_attempts: number;
            /** Name */
            name: string;
            /** Output Schema */
            output_schema: {
                [key: string]: unknown;
            };
            /** Output Trust */
            output_trust: string;
            /** Parallel Safe */
            parallel_safe: boolean;
            /** Permission Level */
            permission_level: string;
            /** Policy Reasons */
            policy_reasons?: string[];
            /** Provider */
            provider: string;
            /** Required Scopes */
            required_scopes: string[];
            /** Requires Approval */
            requires_approval: boolean;
            /** Risk Level */
            risk_level: string;
            /** Timeout Seconds */
            timeout_seconds: number;
            /** Verification Method */
            verification_method: string;
            /** Version */
            version: string;
        };
        /** ToolPolicy */
        ToolPolicy: {
            /** Allowed */
            allowed?: string[];
            /** Denied */
            denied?: string[];
        };
        /** ToolRetryTuning */
        ToolRetryTuning: {
            /**
             * Base Delay Seconds
             * @default 2
             */
            base_delay_seconds?: number;
            /** Max Attempts */
            max_attempts: number;
        };
        /** ToolRuleIn */
        ToolRuleIn: {
            /**
             * Effect
             * @enum {string}
             */
            effect: "deny" | "require_approval" | "allow";
            /** Reason */
            reason?: string | null;
            /** Role */
            role?: string | null;
            /** Tool Pattern */
            tool_pattern: string;
        };
        /** ToolRuleOut */
        ToolRuleOut: {
            /**
             * Effect
             * @enum {string}
             */
            effect: "deny" | "require_approval" | "allow";
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Reason */
            reason?: string | null;
            /** Role */
            role?: string | null;
            /** Tool Pattern */
            tool_pattern: string;
        };
        /**
         * TrustLevel
         * @description Canonical TrustLevel values (published for API clients).
         * @enum {string}
         */
        TrustLevel: "trusted_system_logic" | "controlled_agent_output" | "untrusted_external_content";
        /** UsageSummary */
        UsageSummary: {
            /** By Day */
            by_day: {
                [key: string]: unknown;
            }[];
            /** Cost Usd */
            cost_usd: number;
            /**
             * Period Start
             * Format: date
             */
            period_start: string;
            /** Plan */
            plan: string;
            /** Quotas */
            quotas: {
                [key: string]: number;
            };
            /** Scope */
            scope: string;
            /** Totals */
            totals: {
                [key: string]: number;
            };
        };
        /** UserOut */
        UserOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Display Name */
            display_name: string | null;
            /** Email */
            email: string;
            /** Email Verified */
            email_verified: boolean;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Is Platform Admin */
            is_platform_admin: boolean;
            /** Last Login At */
            last_login_at: string | null;
            /** Locale */
            locale: string;
            /** Mfa Enabled */
            mfa_enabled: boolean;
            /** Status */
            status: string;
            /** Timezone */
            timezone: string;
        };
        /** UserStatusUpdate */
        UserStatusUpdate: {
            /** Reason */
            reason: string;
            /**
             * Status
             * @enum {string}
             */
            status: "active" | "disabled";
        };
        /** UserUpdate */
        UserUpdate: {
            /** Display Name */
            display_name?: string | null;
            /** Locale */
            locale?: string | null;
            /** Timezone */
            timezone?: string | null;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
        /** VariantSpec */
        VariantSpec: {
            config?: components["schemas"]["StrategyConfig"];
            /** Name */
            name: string;
            /**
             * Weight
             * @default 1
             */
            weight?: number;
        };
        /** VerificationOut */
        VerificationOut: {
            /** Differences */
            differences: {
                [key: string]: unknown;
            }[];
            /** Evidence */
            evidence: {
                [key: string]: unknown;
            };
            /** Expected */
            expected: {
                [key: string]: unknown;
            };
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Method */
            method: string;
            /** Observed */
            observed: {
                [key: string]: unknown;
            };
            /** Scope */
            scope: string;
            status: components["schemas"]["VerificationStatus"];
            /** Step Id */
            step_id: string | null;
            /**
             * Verified At
             * Format: date-time
             */
            verified_at: string;
        };
        /** VerificationPolicy */
        VerificationPolicy: {
            /**
             * Readback Attempts
             * @default 3
             */
            readback_attempts?: number;
            /**
             * Readback Delay Ms
             * @default 500
             */
            readback_delay_ms?: number;
        };
        /**
         * VerificationStatus
         * @enum {string}
         */
        VerificationStatus: "pending" | "passed" | "failed" | "inconclusive" | "not_applicable";
        /** WebSearchHit */
        WebSearchHit: {
            citation: components["schemas"]["Citation"];
            /** Document Id */
            document_id?: string | null;
            /** Provider */
            provider: string;
            /** Provider Rank */
            provider_rank: number;
            /** Published At */
            published_at?: string | null;
            /** Rank */
            rank: number;
            /**
             * Relevance
             * @description 0..1 blend of provider rank and query-term overlap
             */
            relevance: number;
            /**
             * Retrieved At
             * Format: date-time
             */
            retrieved_at: string;
            /** Snippet */
            snippet: string;
            /** Title */
            title: string;
            /** Url */
            url: string;
        };
        /** WebSearchRequest */
        WebSearchRequest: {
            /**
             * Max Results
             * @default 10
             */
            max_results?: number;
            /** Query */
            query: string;
        };
        /** WebSearchResponse */
        WebSearchResponse: {
            /** Provider */
            provider: string;
            /** Query */
            query: string;
            /** Results */
            results: components["schemas"]["WebSearchHit"][];
            /**
             * Retrieved At
             * Format: date-time
             */
            retrieved_at: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type AccountDeletionRequest = components['schemas']['AccountDeletionRequest'];
export type ActorType = components['schemas']['ActorType'];
export type AdminOrgOut = components['schemas']['AdminOrgOut'];
export type AdminUserOut = components['schemas']['AdminUserOut'];
export type AgentCreate = components['schemas']['AgentCreate'];
export type AgentOut = components['schemas']['AgentOut'];
export type AgentUpdate = components['schemas']['AgentUpdate'];
export type AgentVersionIn = components['schemas']['AgentVersionIn'];
export type AgentVersionOut = components['schemas']['AgentVersionOut'];
export type AppAcbeRouterExperimentOut = components['schemas']['app__acbe__router__ExperimentOut'];
export type AppEvaluationSchemasExperimentOut = components['schemas']['app__evaluation__schemas__ExperimentOut'];
export type ApprovalOut = components['schemas']['ApprovalOut'];
export type ApprovalStatus = components['schemas']['ApprovalStatus'];
export type ApproveRequest = components['schemas']['ApproveRequest'];
export type AuditOut = components['schemas']['AuditOut'];
export type AutomationCreate = components['schemas']['AutomationCreate'];
export type AutomationOut = components['schemas']['AutomationOut'];
export type AutomationPolicy = components['schemas']['AutomationPolicy'];
export type AutomationRunOut = components['schemas']['AutomationRunOut'];
export type AutomationRunStatus = components['schemas']['AutomationRunStatus'];
export type AutomationUpdate = components['schemas']['AutomationUpdate'];
export type BodyUploadFileApiV1FilesPost = components['schemas']['Body_upload_file_api_v1_files_post'];
export type CanaryRequest = components['schemas']['CanaryRequest'];
export type CandidateDetail = components['schemas']['CandidateDetail'];
export type CandidateOut = components['schemas']['CandidateOut'];
export type ChangePasswordRequest = components['schemas']['ChangePasswordRequest'];
export type Citation = components['schemas']['Citation'];
export type ConnectGoogleRequest = components['schemas']['ConnectGoogleRequest'];
export type ConnectGoogleResponse = components['schemas']['ConnectGoogleResponse'];
export type ConnectionOut = components['schemas']['ConnectionOut'];
export type ConnectionStatus = components['schemas']['ConnectionStatus'];
export type DocumentSearchHit = components['schemas']['DocumentSearchHit'];
export type DocumentSearchRequest = components['schemas']['DocumentSearchRequest'];
export type DocumentSearchResponse = components['schemas']['DocumentSearchResponse'];
export type DownloadUrlOut = components['schemas']['DownloadUrlOut'];
export type EntitlementsOut = components['schemas']['EntitlementsOut'];
export type ErrorClass = components['schemas']['ErrorClass'];
export type EvaluationResultOut = components['schemas']['EvaluationResultOut'];
export type EvaluationRunCreate = components['schemas']['EvaluationRunCreate'];
export type EvaluationRunDetail = components['schemas']['EvaluationRunDetail'];
export type EvaluationRunOut = components['schemas']['EvaluationRunOut'];
export type EventType = components['schemas']['EventType'];
export type ExecutionLimits = components['schemas']['ExecutionLimits'];
export type ExecutionLogOut = components['schemas']['ExecutionLogOut'];
export type ExperimentCreate = components['schemas']['ExperimentCreate'];
export type ExperimentDetail = components['schemas']['ExperimentDetail'];
export type ExtractionStatus = components['schemas']['ExtractionStatus'];
export type FailurePatternOut = components['schemas']['FailurePatternOut'];
export type FileMetadataOut = components['schemas']['FileMetadataOut'];
export type FileOut = components['schemas']['FileOut'];
export type FileStatus = components['schemas']['FileStatus'];
export type FlagIn = components['schemas']['FlagIn'];
export type GoogleCapability = components['schemas']['GoogleCapability'];
export type HttpValidationError = components['schemas']['HTTPValidationError'];
export type LoginRequest = components['schemas']['LoginRequest'];
export type McpServerCreate = components['schemas']['MCPServerCreate'];
export type McpServerOut = components['schemas']['MCPServerOut'];
export type McpServerStatus = components['schemas']['MCPServerStatus'];
export type McpSyncResult = components['schemas']['MCPSyncResult'];
export type McpToolOut = components['schemas']['MCPToolOut'];
export type McpToolStatus = components['schemas']['MCPToolStatus'];
export type McpToolUpdate = components['schemas']['MCPToolUpdate'];
export type MemberAdd = components['schemas']['MemberAdd'];
export type MemberOut = components['schemas']['MemberOut'];
export type MemberRoleUpdate = components['schemas']['MemberRoleUpdate'];
export type MemoryCreate = components['schemas']['MemoryCreate'];
export type MemoryOut = components['schemas']['MemoryOut'];
export type MemoryPolicy = components['schemas']['MemoryPolicy'];
export type MemorySearchRequest = components['schemas']['MemorySearchRequest'];
export type MemorySearchResponse = components['schemas']['MemorySearchResponse'];
export type MemoryStatus = components['schemas']['MemoryStatus'];
export type MemoryType = components['schemas']['MemoryType'];
export type MemoryWeights = components['schemas']['MemoryWeights'];
export type MeOut = components['schemas']['MeOut'];
export type MfaCodeRequest = components['schemas']['MfaCodeRequest'];
export type MfaEnrollResponse = components['schemas']['MfaEnrollResponse'];
export type ModelPolicy = components['schemas']['ModelPolicy'];
export type NotificationEvent = components['schemas']['NotificationEvent'];
export type NotificationOut = components['schemas']['NotificationOut'];
export type OAuthStartResponse = components['schemas']['OAuthStartResponse'];
export type OrganizationCreate = components['schemas']['OrganizationCreate'];
export type OrganizationOut = components['schemas']['OrganizationOut'];
export type OrganizationPolicy = components['schemas']['OrganizationPolicy'];
export type OrganizationUpdate = components['schemas']['OrganizationUpdate'];
export type OrgPlanUpdate = components['schemas']['OrgPlanUpdate'];
export type PageAgentOut = components['schemas']['Page_AgentOut_'];
export type PageApprovalOut = components['schemas']['Page_ApprovalOut_'];
export type PageAuditOut = components['schemas']['Page_AuditOut_'];
export type PageAutomationOut = components['schemas']['Page_AutomationOut_'];
export type PageAutomationRunOut = components['schemas']['Page_AutomationRunOut_'];
export type PageCandidateOut = components['schemas']['Page_CandidateOut_'];
export type PageEvaluationRunOut = components['schemas']['Page_EvaluationRunOut_'];
export type PageExperimentOut = components['schemas']['Page_ExperimentOut_'];
export type PageFileOut = components['schemas']['Page_FileOut_'];
export type PageMemoryOut = components['schemas']['Page_MemoryOut_'];
export type PageNotificationOut = components['schemas']['Page_NotificationOut_'];
export type PageTaskOut = components['schemas']['Page_TaskOut_'];
export type PermissionCode = components['schemas']['PermissionCode'];
export type PermissionLevel = components['schemas']['PermissionLevel'];
export type PlanOut = components['schemas']['PlanOut'];
export type PolicyOut = components['schemas']['PolicyOut'];
export type ReadbackTuning = components['schemas']['ReadbackTuning'];
export type RecoveryAction = components['schemas']['RecoveryAction'];
export type RefreshRequest = components['schemas']['RefreshRequest'];
export type RegisterRequest = components['schemas']['RegisterRequest'];
export type RejectedTool = components['schemas']['RejectedTool'];
export type RejectRequest = components['schemas']['RejectRequest'];
export type RetrievedMemory = components['schemas']['RetrievedMemory'];
export type RetryPolicy = components['schemas']['RetryPolicy'];
export type RiskLevel = components['schemas']['RiskLevel'];
export type RollbackRequest = components['schemas']['RollbackRequest'];
export type RolloutRequest = components['schemas']['RolloutRequest'];
export type SessionOut = components['schemas']['SessionOut'];
export type StepConfirmation = components['schemas']['StepConfirmation'];
export type StepOut = components['schemas']['StepOut'];
export type StepStatus = components['schemas']['StepStatus'];
export type StrategyConfig = components['schemas']['StrategyConfig'];
export type StreamTokenResponse = components['schemas']['StreamTokenResponse'];
export type SuiteCaseOut = components['schemas']['SuiteCaseOut'];
export type SuiteOut = components['schemas']['SuiteOut'];
export type SummaryChangeItem = components['schemas']['SummaryChangeItem'];
export type SummaryFailureItem = components['schemas']['SummaryFailureItem'];
export type SummaryStepItem = components['schemas']['SummaryStepItem'];
export type SummaryVerificationItem = components['schemas']['SummaryVerificationItem'];
export type SummaryWaitingItem = components['schemas']['SummaryWaitingItem'];
export type SwitchOrganizationRequest = components['schemas']['SwitchOrganizationRequest'];
export type SystemRole = components['schemas']['SystemRole'];
export type TaskCreate = components['schemas']['TaskCreate'];
export type TaskDetail = components['schemas']['TaskDetail'];
export type TaskEventOut = components['schemas']['TaskEventOut'];
export type TaskEventsPage = components['schemas']['TaskEventsPage'];
export type TaskInput = components['schemas']['TaskInput'];
export type TaskOut = components['schemas']['TaskOut'];
export type TaskStatus = components['schemas']['TaskStatus'];
export type TaskSummaryOut = components['schemas']['TaskSummaryOut'];
export type TaskTemplate = components['schemas']['TaskTemplate'];
export type TokenResponse = components['schemas']['TokenResponse'];
export type ToolConnectRequest = components['schemas']['ToolConnectRequest'];
export type ToolOut = components['schemas']['ToolOut'];
export type ToolPolicy = components['schemas']['ToolPolicy'];
export type ToolRetryTuning = components['schemas']['ToolRetryTuning'];
export type ToolRuleIn = components['schemas']['ToolRuleIn'];
export type ToolRuleOut = components['schemas']['ToolRuleOut'];
export type TrustLevel = components['schemas']['TrustLevel'];
export type UsageSummary = components['schemas']['UsageSummary'];
export type UserOut = components['schemas']['UserOut'];
export type UserStatusUpdate = components['schemas']['UserStatusUpdate'];
export type UserUpdate = components['schemas']['UserUpdate'];
export type ValidationError = components['schemas']['ValidationError'];
export type VariantSpec = components['schemas']['VariantSpec'];
export type VerificationOut = components['schemas']['VerificationOut'];
export type VerificationPolicy = components['schemas']['VerificationPolicy'];
export type VerificationStatus = components['schemas']['VerificationStatus'];
export type WebSearchHit = components['schemas']['WebSearchHit'];
export type WebSearchRequest = components['schemas']['WebSearchRequest'];
export type WebSearchResponse = components['schemas']['WebSearchResponse'];
export type $defs = Record<string, never>;
export interface operations {
    list_candidates_api_v1_acbe_candidates_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
                status?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_CandidateOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_candidate_api_v1_acbe_candidates__candidate_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidate_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    approve_canary_api_v1_acbe_candidates__candidate_id__canary_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidate_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CanaryRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    evaluate_candidate_api_v1_acbe_candidates__candidate_id__evaluate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidate_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    promote_candidate_api_v1_acbe_candidates__candidate_id__promote_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidate_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    rollback_candidate_api_v1_acbe_candidates__candidate_id__rollback_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidate_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RollbackRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_failures_api_v1_acbe_failures_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FailurePatternOut"][];
                };
            };
        };
    };
    flags_api_v1_admin_feature_flags_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    set_flag_api_v1_admin_feature_flags_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FlagIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    retry_job_api_v1_admin_jobs__job_id__retry_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    dead_jobs_api_v1_admin_jobs_dead_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    organizations_api_v1_admin_organizations_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrgOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_org_api_v1_admin_organizations__org_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                org_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrgPlanUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOrgOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    security_events_api_v1_admin_security_events_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    system_api_v1_admin_system_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    inspect_task_api_v1_admin_tasks__task_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    platform_usage_api_v1_admin_usage_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    users_api_v1_admin_users_get: {
        parameters: {
            query?: {
                email?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_user_status_api_v1_admin_users__user_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                user_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserStatusUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_agents_api_v1_agents_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_AgentOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_agent_api_v1_agents_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_agent_api_v1_agents__agent_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agent_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_agent_api_v1_agents__agent_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agent_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_agent_api_v1_agents__agent_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agent_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_versions_api_v1_agents__agent_id__versions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agent_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentVersionOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_version_api_v1_agents__agent_id__versions_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agent_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentVersionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentVersionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_approvals_api_v1_approvals_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
                status?: string | null;
                task_id?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_ApprovalOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_approval_api_v1_approvals__approval_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                approval_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    approve_api_v1_approvals__approval_id__approve_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client-generated key; retries with the same key return the original result. */
                "Idempotency-Key"?: string | null;
            };
            path: {
                approval_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ApproveRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalOut"];
                };
            };
            /** @description Not found or not yours */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not pending/expired */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reject_api_v1_approvals__approval_id__reject_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client-generated key; retries with the same key return the original result. */
                "Idempotency-Key"?: string | null;
            };
            path: {
                approval_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RejectRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_audit_api_v1_audit_get: {
        parameters: {
            query?: {
                action?: string | null;
                category?: string | null;
                cursor?: string | null;
                limit?: number;
                task_id?: string | null;
                user_id?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_AuditOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    login_api_v1_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Invalid credentials or MFA required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    logout_api_v1_auth_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    logout_all_api_v1_auth_logout_all_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    mfa_confirm_api_v1_auth_mfa__factor_id__confirm_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                factor_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MfaCodeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    mfa_disable_api_v1_auth_mfa_disable_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MfaCodeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    mfa_enroll_api_v1_auth_mfa_enroll_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MfaEnrollResponse"];
                };
            };
        };
    };
    google_login_callback_api_v1_auth_oauth_google_callback_get: {
        parameters: {
            query: {
                code: string;
                state: string;
                token_delivery?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    google_login_start_api_v1_auth_oauth_google_start_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OAuthStartResponse"];
                };
            };
        };
    };
    change_password_api_v1_auth_password_change_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePasswordRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    refresh_api_v1_auth_refresh_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["RefreshRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Invalid, expired or reused refresh token */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    register_api_v1_auth_register_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Registration failed */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    list_sessions_api_v1_auth_sessions_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"][];
                };
            };
        };
    };
    revoke_session_api_v1_auth_sessions__session_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    stream_token_api_v1_auth_stream_token_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StreamTokenResponse"];
                };
            };
        };
    };
    switch_org_api_v1_auth_switch_organization_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SwitchOrganizationRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_automations_api_v1_automations_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_AutomationOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_automation_api_v1_automations_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client-generated key; retries with the same key return the original result. */
                "Idempotency-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutomationCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationOut"];
                };
            };
            /** @description Idempotency conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Rate limit or plan automation limit reached */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_automation_api_v1_automations__automation_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                automation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_automation_api_v1_automations__automation_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                automation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_automation_api_v1_automations__automation_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                automation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutomationUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    run_now_api_v1_automations__automation_id__run_now_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                automation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run materialized; its task is executed asynchronously */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationRunOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_runs_api_v1_automations__automation_id__runs_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
            };
            header?: never;
            path: {
                automation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_AutomationRunOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    entitlements_api_v1_billing_entitlements_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntitlementsOut"];
                };
            };
        };
    };
    plans_api_v1_billing_plans_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanOut"][];
                };
            };
        };
    };
    list_runs_api_v1_evaluations_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_EvaluationRunOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_run_api_v1_evaluations_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client-generated key; retries with the same key return the original result. */
                "Idempotency-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvaluationRunCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationRunOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_run_api_v1_evaluations__run_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationRunDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_suites_api_v1_evaluations_suites_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuiteOut"][];
                };
            };
        };
    };
    user_stream_api_v1_events_stream_get: {
        parameters: {
            query?: {
                access_token?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_experiments_api_v1_experiments_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_ExperimentOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_experiment_api_v1_experiments_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client-generated key; retries with the same key return the original result. */
                "Idempotency-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExperimentCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["app__evaluation__schemas__ExperimentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_experiment_api_v1_experiments__experiment_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                experiment_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExperimentDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    decide_experiment_api_v1_experiments__experiment_id__decide_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                experiment_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["app__evaluation__schemas__ExperimentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    rollback_experiment_api_v1_experiments__experiment_id__rollback_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                experiment_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RollbackRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["app__evaluation__schemas__ExperimentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_rollout_api_v1_experiments__experiment_id__rollout_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                experiment_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RolloutRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["app__evaluation__schemas__ExperimentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_experiment_api_v1_experiments__experiment_id__start_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                experiment_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["app__evaluation__schemas__ExperimentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_files_api_v1_files_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
                purpose?: ("user_upload" | "task_artifact" | "browser_artifact" | "temp") | null;
                status?: ("uploaded" | "processing" | "ready" | "quarantined" | "failed") | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_FileOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_file_api_v1_files_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client-generated key; retries with the same key return the original result. */
                "Idempotency-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_file_api_v1_files_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileOut"];
                };
            };
            /** @description File too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unsupported file type, empty file or malware detected */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Malware scanning unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_file_api_v1_files__file_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_file_api_v1_files__file_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_download_url_api_v1_files__file_id__download_url_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DownloadUrlOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_api_v1_files_download_get: {
        parameters: {
            query: {
                token: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": unknown;
                };
            };
            /** @description Invalid or expired link */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    health_api_v1_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    list_integrations_api_v1_integrations_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionOut"][];
                };
            };
        };
    };
    check_api_v1_integrations__connection_id__check_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connection_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    disconnect_api_v1_integrations__connection_id__disconnect_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connection_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    google_callback_api_v1_integrations_google_callback_get: {
        parameters: {
            query: {
                code?: string | null;
                error?: string | null;
                state: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    connect_google_api_v1_integrations_google_connect_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConnectGoogleRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectGoogleResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    live_api_v1_live_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    list_servers_api_v1_mcp_servers_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MCPServerOut"][];
                };
            };
        };
    };
    register_server_api_v1_mcp_servers_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client-generated key; retries with the same key return the original result. */
                "Idempotency-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MCPServerCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MCPServerOut"];
                };
            };
            /** @description Name already used */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description URL not allowed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_server_api_v1_mcp_servers__server_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                server_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MCPServerOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_server_api_v1_mcp_servers__server_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                server_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    approve_server_api_v1_mcp_servers__server_id__approve_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                server_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MCPServerOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    disable_server_api_v1_mcp_servers__server_id__disable_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                server_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MCPServerOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sync_server_api_v1_mcp_servers__server_id__sync_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                server_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MCPSyncResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_server_tools_api_v1_mcp_servers__server_id__tools_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                server_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MCPToolOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_tool_api_v1_mcp_tools__tool_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tool_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MCPToolUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MCPToolOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_memories_api_v1_memory_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
                memory_type?: components["schemas"]["MemoryType"] | null;
                status?: ("active" | "superseded" | "conflicted") | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_MemoryOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_memory_api_v1_memory_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client-generated key; retries with the same key return the original result. */
                "Idempotency-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemoryCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemoryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_memory_api_v1_memory__memory_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                memory_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    verify_memory_api_v1_memory__memory_id__verify_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                memory_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemoryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_memories_api_v1_memory_search_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemorySearchRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemorySearchResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_notifications_api_v1_notifications_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
                unread_only?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_NotificationOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    mark_read_api_v1_notifications__notification_id__read_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                notification_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    mark_all_read_api_v1_notifications_read_all_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    create_org_api_v1_organizations_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrganizationCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    current_org_api_v1_organizations_current_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationOut"];
                };
            };
        };
    };
    update_org_api_v1_organizations_current_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrganizationUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    members_api_v1_organizations_current_members_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"][];
                };
            };
        };
    };
    add_member_api_v1_organizations_current_members_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberAdd"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    remove_member_api_v1_organizations_current_members__member_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    change_role_api_v1_organizations_current_members__member_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberRoleUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_policy_api_v1_organizations_current_policy_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PolicyOut"];
                };
            };
        };
    };
    put_policy_api_v1_organizations_current_policy_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrganizationPolicy"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PolicyOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    ready_api_v1_ready_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    search_documents_api_v1_search_documents_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DocumentSearchRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentSearchResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_web_api_v1_search_web_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WebSearchRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebSearchResponse"];
                };
            };
            /** @description Web search disabled */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Web search not configured */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    list_tasks_api_v1_tasks_get: {
        parameters: {
            query?: {
                /** @description Organization-wide (requires tasks:read_all) */
                all_users?: boolean;
                cursor?: string | null;
                limit?: number;
                status?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_TaskOut_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_task_api_v1_tasks_post: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client-generated key; retries with the same key return the original result. */
                "Idempotency-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskCreate"];
            };
        };
        responses: {
            /** @description Task accepted; poll or stream for progress */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskOut"];
                };
            };
            /** @description Idempotency conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Rate/quota limit */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_task_api_v1_tasks__task_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_api_v1_tasks__task_id__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_events_api_v1_tasks__task_id__events_get: {
        parameters: {
            query?: {
                after_seq?: number;
                limit?: number;
            };
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskEventsPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    stream_events_api_v1_tasks__task_id__events_stream_get: {
        parameters: {
            query?: {
                access_token?: string | null;
            };
            header?: {
                "Last-Event-ID"?: string | null;
            };
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description `id` = event seq; reconnect with Last-Event-ID to resume */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    provide_input_api_v1_tasks__task_id__input_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_logs_api_v1_tasks__task_id__logs_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExecutionLogOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    pause_api_v1_tasks__task_id__pause_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resume_api_v1_tasks__task_id__resume_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    confirm_step_api_v1_tasks__task_id__steps__step_id__confirm_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                step_id: string;
                task_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepConfirmation"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_summary_api_v1_tasks__task_id__summary_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskSummaryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_tools_api_v1_tools_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolOut"][];
                };
            };
        };
    };
    connect_api_v1_tools_connect_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ToolConnectRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectGoogleResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_rules_api_v1_tools_policies_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolRuleOut"][];
                };
            };
        };
    };
    add_rule_api_v1_tools_policies_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ToolRuleIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolRuleOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_rule_api_v1_tools_policies__rule_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rule_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    usage_api_v1_usage_get: {
        parameters: {
            query?: {
                org_wide?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UsageSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    me_api_v1_users_me_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeOut"];
                };
            };
        };
    };
    delete_me_api_v1_users_me_delete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccountDeletionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_me_api_v1_users_me_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    my_orgs_api_v1_users_me_organizations_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationOut"][];
                };
            };
        };
    };
    receive_api_v1_webhooks__provider__post: {
        parameters: {
            query?: never;
            header?: {
                "x-agentos-signature"?: string | null;
                "x-agentos-timestamp"?: string | null;
            };
            path: {
                provider: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Bad/missing signature or replayed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description Provider not configured */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
type FlattenedDeepRequired<T> = {
    [K in keyof T]-?: FlattenedDeepRequired<T[K] extends unknown[] | undefined | null ? Extract<T[K], unknown[]>[number] : T[K]>;
};
type ReadonlyArray<T> = [
    Exclude<T, undefined>
] extends [
    unknown[]
] ? Readonly<Exclude<T, undefined>> : Readonly<Exclude<T, undefined>[]>;
export const pathsApiV1FilesGetParametersQueryPurposeAnyOf0Values: ReadonlyArray<FlattenedDeepRequired<paths>["/api/v1/files"]["get"]["parameters"]["query"]["purpose"]> = ["user_upload", "task_artifact", "browser_artifact", "temp"];
export const pathsApiV1FilesGetParametersQueryStatusAnyOf0Values: ReadonlyArray<FlattenedDeepRequired<paths>["/api/v1/files"]["get"]["parameters"]["query"]["status"]> = ["uploaded", "processing", "ready", "quarantined", "failed"];
export const pathsApiV1MemoryGetParametersQueryStatusAnyOf0Values: ReadonlyArray<FlattenedDeepRequired<paths>["/api/v1/memory"]["get"]["parameters"]["query"]["status"]> = ["active", "superseded", "conflicted"];
export const actorTypeValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["ActorType"]> = ["user", "system", "worker", "agent", "scheduler", "admin"];
export const approvalStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["ApprovalStatus"]> = ["pending", "approved", "rejected", "expired", "cancelled"];
export const automationRunStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["AutomationRunStatus"]> = ["created", "succeeded", "failed", "skipped"];
export const body_upload_file_api_v1_files_postPurposeValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["Body_upload_file_api_v1_files_post"]["purpose"]> = ["user_upload", "temp"];
export const connectionOutStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["ConnectionOut"]["status"]> = ["connected", "expired", "revoked", "insufficient_scope", "temporarily_unavailable", "disconnected"];
export const connectionStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["ConnectionStatus"]> = ["connected", "expired", "revoked", "insufficient_scope", "temporarily_unavailable", "disconnected"];
export const errorClassValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["ErrorClass"]> = ["transient", "timeout", "rate_limited", "network_error", "auth_expired", "permission_denied", "invalid_input", "tool_unavailable", "conflict", "verification_failed", "model_error", "policy_blocked", "needs_user_input", "unknown_outcome", "unknown"];
export const evaluationRunCreateModel_modeValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["EvaluationRunCreate"]["model_mode"]> = ["scripted", "configured"];
export const eventTypeValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["EventType"]> = ["TASK_CREATED", "TASK_STATE_CHANGED", "PLANNING_STARTED", "PLAN_CREATED", "PLAN_REJECTED", "PLAN_VALIDATED", "STEP_STARTED", "STEP_COMPLETED", "STEP_FAILED", "STEP_SKIPPED", "TOOL_CALL_STARTED", "TOOL_CALL_FINISHED", "APPROVAL_REQUIRED", "APPROVAL_GRANTED", "APPROVAL_REJECTED", "APPROVAL_EXPIRED", "INPUT_REQUIRED", "INPUT_RECEIVED", "RETRY_SCHEDULED", "RECOVERY_STARTED", "RECOVERY_DECIDED", "RECONCILIATION_REQUIRED", "RECONCILIATION_RESOLVED", "VERIFICATION_STARTED", "VERIFICATION_PASSED", "VERIFICATION_FAILED", "CANCEL_REQUESTED", "TASK_PAUSED", "TASK_RESUMED", "TASK_COMPLETED", "TASK_FAILED", "TASK_CANCELLED", "BUDGET_EXCEEDED", "NOTIFICATION_CREATED"];
export const experimentCreateKindValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["ExperimentCreate"]["kind"]> = ["agent_version", "planner_strategy", "memory_retrieval", "verification_strategy", "recovery_strategy", "acbe_strategy"];
export const extractionStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["ExtractionStatus"]> = ["pending", "completed", "truncated", "skipped", "failed"];
export const fileStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["FileStatus"]> = ["uploaded", "processing", "ready", "quarantined", "failed", "deleted"];
export const googleCapabilityValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["GoogleCapability"]> = ["gmail.read", "gmail.compose", "gmail.send", "calendar.read", "calendar.write", "drive.read", "drive.file", "contacts.read"];
export const loginRequestToken_deliveryValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["LoginRequest"]["token_delivery"]> = ["body", "cookie"];
export const mCPServerStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["MCPServerStatus"]> = ["pending_review", "approved", "disabled", "error"];
export const mCPToolStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["MCPToolStatus"]> = ["active", "schema_changed", "removed"];
export const memoryOutFreshnessValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["MemoryOut"]["freshness"]> = ["fresh", "stale", "unverified"];
export const memoryStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["MemoryStatus"]> = ["active", "superseded", "conflicted", "deleted"];
export const memoryTypeValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["MemoryType"]> = ["conversational", "short_term", "long_term", "semantic", "preference", "task_history", "verified_fact", "contact"];
export const notificationEventValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["NotificationEvent"]> = ["approval_required", "input_required", "task_completed", "task_failed", "automation_failed", "connection_expired", "security_alert"];
export const orgPlanUpdateStatusAnyOf0Values: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["OrgPlanUpdate"]["status"]> = ["active", "suspended"];
export const permissionCodeValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["PermissionCode"]> = ["tasks:create", "tasks:read", "tasks:read_all", "tasks:cancel", "approvals:decide", "approvals:decide_any", "agents:read", "agents:manage", "memory:read", "memory:write", "tools:read", "tools:manage", "integrations:manage", "automations:manage", "files:read", "files:write", "audit:read", "usage:read", "members:manage", "org:manage", "mcp:manage", "billing:manage", "experiments:manage", "search:use"];
export const permissionLevelValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["PermissionLevel"]> = ["read", "write", "high_risk_write", "destructive", "financial", "admin"];
export const recoveryActionValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["RecoveryAction"]> = ["retry", "reconcile", "repair", "request_user", "block", "fail"];
export const refreshRequestToken_deliveryValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["RefreshRequest"]["token_delivery"]> = ["body", "cookie"];
export const retrievedMemoryFreshnessValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["RetrievedMemory"]["freshness"]> = ["fresh", "stale", "unverified"];
export const riskLevelValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["RiskLevel"]> = ["low", "medium", "high", "critical"];
export const stepConfirmationOutcomeValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["StepConfirmation"]["outcome"]> = ["succeeded", "did_not_happen"];
export const stepStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["StepStatus"]> = ["pending", "waiting_approval", "waiting_input", "running", "waiting_external", "verifying", "retry_scheduled", "requires_reconciliation", "completed", "failed", "skipped", "cancelled", "blocked"];
export const strategyConfigBrowser_locator_orderValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["StrategyConfig"]["browser_locator_order"]> = ["role", "label", "text", "test_id", "css"];
export const summaryWaitingItemTypeValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["SummaryWaitingItem"]["type"]> = ["approval", "input", "confirm_outcome"];
export const systemRoleValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["SystemRole"]> = ["owner", "admin", "member", "viewer"];
export const taskStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["TaskStatus"]> = ["created", "planning", "planned", "validating", "waiting_approval", "waiting_input", "queued", "running", "verifying", "recovering", "requires_reconciliation", "paused", "cancel_requested", "completed", "failed", "cancelled", "blocked", "expired"];
export const toolRuleInEffectValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["ToolRuleIn"]["effect"]> = ["deny", "require_approval", "allow"];
export const toolRuleOutEffectValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["ToolRuleOut"]["effect"]> = ["deny", "require_approval", "allow"];
export const trustLevelValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["TrustLevel"]> = ["trusted_system_logic", "controlled_agent_output", "untrusted_external_content"];
export const userStatusUpdateStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["UserStatusUpdate"]["status"]> = ["active", "disabled"];
export const verificationStatusValues: ReadonlyArray<FlattenedDeepRequired<components>["schemas"]["VerificationStatus"]> = ["pending", "passed", "failed", "inconclusive", "not_applicable"];
