"""MCPPolicyChecker: pure, side-effect-free checks for the MCP gateway.

Nothing a remote MCP server says is trusted by itself. This module decides:

* whether a server URL may be contacted (SSRF / egress policy; cloud metadata
  endpoints are refused even if an operator lists them as trusted);
* whether an advertised tool is acceptable at all (name, bounded description,
  a real JSON Schema object with only local ``$ref`` and no risky regexes);
* whether a stored tool is *usable* for a tenant right now (tenant match, server
  approved, tool enabled, schema unchanged since approval);
* whether call arguments and outputs are within size/depth limits.

JSON Schema validation never retrieves remote ``$ref`` targets (jsonschema's legacy
default would fetch them with ``urllib`` — an SSRF vector), and format assertions
are off.

Sandbox boundary: tenant servers are reached only over Streamable HTTP through
``MCPEgressPolicy`` (re-vetted and IP-pinned on every request, metadata/link-local
addresses always refused). The stdio transport is not offered to tenants because it
means executing a tenant-chosen local process on our workers.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from jsonschema import (
    Draft4Validator,
    Draft6Validator,
    Draft7Validator,
    Draft201909Validator,
    Draft202012Validator,
)
from jsonschema.exceptions import SchemaError
from referencing import Registry

from app.common.enums import PermissionLevel
from app.common.sanitize import bound_structure, clean_text
from app.core.config import get_settings
from app.core.exceptions import PolicyDenied, ToolInputInvalid, UnsafeURL
from app.mcp.models import MCPServerStatus, MCPToolStatus
from app.mcp.schemas import QUALIFIED_NAME_PATTERN, SERVER_NAME_PATTERN
from app.security.ssrf import EgressPolicy, VettedURL

if TYPE_CHECKING:
    from app.mcp.models import MCPServer, MCPTool

_QUALIFIED_RE = re.compile(QUALIFIED_NAME_PATTERN)
_SERVER_RE = re.compile(SERVER_NAME_PATTERN)
_REMOTE_NAME_RE = re.compile(r"^[A-Za-z0-9_.\-/]{1,128}$")
# Nested quantifiers such as (a+)+ or (a|aa)* are the classic catastrophic-backtracking shapes.
_NESTED_QUANTIFIER = re.compile(r"\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]")
_BACKREFERENCE = re.compile(r"\\[1-9]|\(\?P=")
# Never contacted, even when an operator marks the host as trusted.
_ALWAYS_BLOCKED_HOSTS = frozenset({
    "169.254.169.254", "fd00:ec2::254", "169.254.170.2", "100.100.100.200", "metadata.google.internal",
    "metadata", "metadata.azure.com", "instance-data",
})
# Cloud metadata / instance-identity addresses outside the link-local ranges.
_METADATA_ADDRESSES = frozenset({"100.100.100.200", "fd00:ec2::254"})
_ADVISORY_HINTS = ("readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint")
_REF_KEYS = ("$ref", "$dynamicRef", "$recursiveRef")
# Remote refs are refused: a registry without a retriever resolves only local/embedded resources.
_LOCAL_ONLY_REGISTRY: Registry[Any] = Registry()

_VALIDATOR_BY_META: dict[str, Any] = {}
for _cls in (Draft4Validator, Draft6Validator, Draft7Validator, Draft201909Validator, Draft202012Validator):
    _meta_id = _cls.META_SCHEMA.get("$id") or _cls.META_SCHEMA.get("id") or ""
    _VALIDATOR_BY_META[_meta_id.split("://", 1)[-1].rstrip("#").rstrip("/")] = _cls


@dataclass(frozen=True, slots=True)
class MCPLimits:
    max_argument_bytes: int = 64 * 1024
    max_argument_depth: int = 32
    max_schema_bytes: int = 64 * 1024
    max_schema_depth: int = 32
    max_regex_length: int = 256
    max_description_chars: int = 2_000
    max_title_chars: int = 200
    max_tools_per_server: int = 200
    max_servers_per_tenant: int = 50
    max_list_pages: int = 20
    max_response_bytes: int = 2 * 1024 * 1024
    max_structured_output_bytes: int = 512 * 1024
    # Stricter than the execution engine's own re-bounding of step output (depth 10 incl. the
    # wrapper, 200 items), so what the verifier checks is exactly what the engine stores.
    max_structured_depth: int = 8
    max_structured_items: int = 200
    max_structured_string: int = 16_000
    max_text_output_chars: int = 20_000
    max_content_blocks: int = 50
    max_call_seconds: float = 120.0


DEFAULT_LIMITS = MCPLimits()


class MCPToolRejected(ValueError):
    """An advertised tool is not acceptable; ``reason`` is user-safe."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True, slots=True)
class NormalizedTool:
    remote_name: str
    qualified_name: str
    title: str | None
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None
    annotations: dict[str, Any]
    schema_hash: str


@dataclass(frozen=True, slots=True)
class SchemaProblem:
    path: str
    message: str


# ---------------------------------------------------------------------------- JSON helpers
def json_size(value: Any) -> int:
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8"))


def json_depth(value: Any) -> int:
    """Nesting depth of a JSON-like value (iterative: hostile input cannot blow the stack)."""
    deepest = 0
    stack: list[tuple[Any, int]] = [(value, 1)]
    while stack:
        node, depth = stack.pop()
        if isinstance(node, dict):
            deepest = max(deepest, depth)
            stack.extend((child, depth + 1) for child in node.values())
        elif isinstance(node, list | tuple):
            deepest = max(deepest, depth)
            stack.extend((child, depth + 1) for child in node)
    return deepest


def canonical_json_hash(value: Any) -> str:
    blob = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------- JSON Schema
def validator_class_for(schema: dict[str, Any]) -> Any:
    declared = schema.get("$schema")
    if isinstance(declared, str):
        key = declared.split("://", 1)[-1].rstrip("#").rstrip("/")
        if key in _VALIDATOR_BY_META:
            return _VALIDATOR_BY_META[key]
    return Draft202012Validator


def build_validator(schema: dict[str, Any]) -> Any:
    """A validator that never fetches remote references and does not assert ``format``."""
    cls = validator_class_for(schema)
    return cls(schema, registry=_LOCAL_ONLY_REGISTRY, format_checker=None)


def schema_problems(validator: Any, instance: Any, *, limit: int = 10) -> list[SchemaProblem]:
    problems: list[SchemaProblem] = []
    try:
        for error in validator.iter_errors(instance):
            path = "/".join(str(p) for p in error.absolute_path) or "(root)"
            message = clean_text(str(error.message), max_chars=200)
            problems.append(SchemaProblem(path=path[:200], message=message))
            if len(problems) >= limit:
                break
    except Exception as exc:  # unresolvable $ref and similar schema-level failures
        problems.append(SchemaProblem(path="(schema)",
                                      message=f"schema could not be applied: {type(exc).__name__}"))
    return problems


def regex_is_risky(pattern: str, *, max_length: int) -> bool:
    if len(pattern) > max_length or _NESTED_QUANTIFIER.search(pattern) or _BACKREFERENCE.search(pattern):
        return True
    try:
        re.compile(pattern)
    except re.error:
        return True
    return False


def _walk_schema(node: Any, limits: MCPLimits, path: str = "#") -> Any:
    """Return a copy of ``node`` with annotation strings sanitised; raise on unsafe constructs."""
    if isinstance(node, list):
        return [_walk_schema(item, limits, f"{path}/{idx}") for idx, item in enumerate(node)]
    if not isinstance(node, dict):
        return node
    out: dict[str, Any] = {}
    for key, value in node.items():
        if not isinstance(key, str):
            raise MCPToolRejected(f"schema has a non-string key at {path}")
        if key in _REF_KEYS and isinstance(value, str):
            if not value.startswith("#"):
                raise MCPToolRejected(f"schema uses a non-local reference at {path}")
            out[key] = value
        elif key in ("description", "title") and isinstance(value, str):
            out[key] = clean_text(value, max_chars=1_000)
        elif key == "pattern" and isinstance(value, str):
            if regex_is_risky(value, max_length=limits.max_regex_length):
                raise MCPToolRejected(f"schema has an unsafe regular expression at {path}")
            out[key] = value
        elif key == "patternProperties" and isinstance(value, dict):
            for regex in value:
                if regex_is_risky(str(regex), max_length=limits.max_regex_length):
                    raise MCPToolRejected(f"schema has an unsafe regular expression at {path}")
            out[key] = _walk_schema(value, limits, f"{path}/{key}")
        else:
            out[key] = _walk_schema(value, limits, f"{path}/{key}")
    return out


def check_tool_schema(schema: Any, *, kind: str, limits: MCPLimits = DEFAULT_LIMITS) -> dict[str, Any]:
    """Validate an advertised input/output schema and return its sanitised copy."""
    if not isinstance(schema, dict):
        raise MCPToolRejected(f"{kind} schema is not a JSON object")
    if schema.get("type") != "object":
        raise MCPToolRejected(f"{kind} schema must describe an object (type: object)")
    if json_size(schema) > limits.max_schema_bytes:
        raise MCPToolRejected(f"{kind} schema exceeds {limits.max_schema_bytes} bytes")
    if json_depth(schema) > limits.max_schema_depth:
        raise MCPToolRejected(f"{kind} schema is nested too deeply")
    sanitized: dict[str, Any] = _walk_schema(schema, limits)
    try:
        validator_class_for(sanitized).check_schema(sanitized)
    except SchemaError as exc:
        raise MCPToolRejected(f"{kind} schema is not a valid JSON Schema: "
                              f"{clean_text(str(exc.message), max_chars=160)}") from exc
    return sanitized


# ---------------------------------------------------------------------------- names
def normalize_tool_segment(remote_name: str) -> str:
    segment = re.sub(r"[^a-z0-9_]+", "_", remote_name.lower())
    segment = re.sub(r"_+", "_", segment).strip("_")
    return segment[:64].rstrip("_")


def qualified_tool_name(server_name: str, remote_name: str) -> str:
    if not _SERVER_RE.match(server_name):
        raise MCPToolRejected("server name is not a valid slug")
    segment = normalize_tool_segment(remote_name)
    if not segment:
        raise MCPToolRejected("tool name has no usable characters")
    name = f"mcp.{server_name}.{segment}"
    if not _QUALIFIED_RE.match(name):
        raise MCPToolRejected("tool name cannot be normalised")
    return name


def _annotations(raw: Any, limits: MCPLimits) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for key in _ADVISORY_HINTS:
        if isinstance(raw.get(key), bool):
            out[key] = raw[key]
    if isinstance(raw.get("title"), str):
        out["title"] = clean_text(raw["title"], max_chars=limits.max_title_chars)
    return out


def schema_hash_of(*, remote_name: str, title: str | None, description: str, input_schema: dict[str, Any],
                   output_schema: dict[str, Any] | None, annotations: dict[str, Any]) -> str:
    """Hash of everything a reviewer approves. Description and hints are included because a
    changed description is a prompt-injection vector (tool poisoning) and changed hints
    signal changed behaviour; either must force re-approval."""
    return canonical_json_hash({
        "name": remote_name, "title": title, "description": description, "input_schema": input_schema,
        "output_schema": output_schema, "annotations": annotations,
    })


def normalize_remote_tool(raw: Any, server_name: str, limits: MCPLimits = DEFAULT_LIMITS) -> NormalizedTool:
    if not isinstance(raw, dict):
        raise MCPToolRejected("tool definition is not an object")
    remote_name = raw.get("name")
    if not isinstance(remote_name, str) or not _REMOTE_NAME_RE.match(remote_name):
        raise MCPToolRejected("tool name must be 1-128 characters of [A-Za-z0-9_.-/]")
    qualified = qualified_tool_name(server_name, remote_name)
    title_raw = raw.get("title")
    title = clean_text(title_raw, max_chars=limits.max_title_chars) if isinstance(title_raw, str) else None
    description_raw = raw.get("description")
    description = (clean_text(description_raw, max_chars=limits.max_description_chars, strip_html=True)
                   if isinstance(description_raw, str) else "")
    input_schema = check_tool_schema(raw.get("inputSchema"), kind="input", limits=limits)
    output_raw = raw.get("outputSchema")
    output_schema = (check_tool_schema(output_raw, kind="output", limits=limits)
                     if output_raw is not None else None)
    annotations = _annotations(raw.get("annotations"), limits)
    digest = schema_hash_of(remote_name=remote_name, title=title, description=description,
                            input_schema=input_schema, output_schema=output_schema, annotations=annotations)
    return NormalizedTool(remote_name=remote_name, qualified_name=qualified, title=title,
                          description=description, input_schema=input_schema, output_schema=output_schema,
                          annotations=annotations, schema_hash=digest)


# ---------------------------------------------------------------------------- network
def is_metadata_address(address: str) -> bool:
    """Link-local (169.254/16, fe80::/10) and known cloud metadata addresses: never an MCP server."""
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_link_local or str(ip) in _METADATA_ADDRESSES


class MCPEgressPolicy(EgressPolicy):
    """Egress policy for MCP traffic. ``safe_request`` calls ``check_url`` for every request, so the
    metadata refusal also holds at connect time (e.g. a trusted host whose DNS later points at
    169.254.169.254), not only when the server is registered or approved."""

    __slots__ = ()

    async def check_url(self, url: str) -> VettedURL:
        host = (urlsplit(url).hostname or "").lower().rstrip(".")
        if host in _ALWAYS_BLOCKED_HOSTS:
            raise UnsafeURL("Cloud metadata endpoints are never allowed", details={"host": host})
        vetted = await super().check_url(url)
        if any(is_metadata_address(address) for address in vetted.addresses):
            raise UnsafeURL("Cloud metadata endpoints are never allowed", details={"host": vetted.host})
        return vetted


# ---------------------------------------------------------------------------- checker
def _host_in(host: str, patterns: list[str]) -> bool:
    for pattern in patterns:
        p = pattern.lower().strip().rstrip(".")
        if p.startswith("*."):
            if host == p[2:] or host.endswith(p[1:]):
                return True
        elif p and (host == p or host.endswith("." + p)):
            return True
    return False


@dataclass(slots=True)
class MCPPolicyChecker:
    limits: MCPLimits = field(default_factory=MCPLimits)

    # -- network
    def egress_policy(self) -> EgressPolicy:
        settings = get_settings()
        return MCPEgressPolicy(allow_private_network=settings.allow_private_network_egress,
                               trusted_private_hosts=list(settings.mcp_allowed_hosts))

    def check_url_syntax(self, url: str) -> tuple[str, str, int]:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower().rstrip(".")
        if host in _ALWAYS_BLOCKED_HOSTS:
            raise UnsafeURL("Cloud metadata endpoints are never allowed", details={"host": host})
        if parts.fragment:
            raise UnsafeURL("URL fragments are not allowed")
        policy = self.egress_policy()
        scheme, host, port = policy.check_syntax(url)
        trusted = _host_in(host, policy.trusted_private_hosts)
        if scheme != "https" and get_settings().is_production and not trusted:
            raise UnsafeURL("MCP servers must use https", details={"scheme": scheme})
        return scheme, host, port

    async def vet_server_url(self, url: str) -> VettedURL:
        """Full egress check including DNS resolution (private/reserved addresses refused unless the
        host is listed in MCP_ALLOWED_HOSTS)."""
        self.check_url_syntax(url)
        return await self.egress_policy().check_url(url)

    # -- usability
    def server_problems(self, server: MCPServer) -> list[str]:
        problems: list[str] = []
        if server.status != MCPServerStatus.APPROVED:
            problems.append(f"server status is {server.status}")
        return problems

    def tool_problems(self, tool: MCPTool, server: MCPServer, tenant_id: uuid.UUID) -> list[str]:
        problems: list[str] = []
        if tool.tenant_id != tenant_id or server.tenant_id != tenant_id:
            problems.append("tool belongs to another tenant")
        if tool.server_id != server.id:
            problems.append("tool does not belong to this server")
        problems.extend(self.server_problems(server))
        if not tool.enabled:
            problems.append("tool is not enabled")
        if tool.status != MCPToolStatus.ACTIVE:
            problems.append(f"tool status is {tool.status}")
        if tool.approved_schema_hash is None or tool.schema_hash != tool.approved_schema_hash:
            problems.append("tool schema is not approved")
        return problems

    def is_tool_usable(self, tool: MCPTool, server: MCPServer, tenant_id: uuid.UUID) -> bool:
        return not self.tool_problems(tool, server, tenant_id)

    def ensure_tool_usable(self, tool: MCPTool, server: MCPServer, tenant_id: uuid.UUID) -> None:
        problems = self.tool_problems(tool, server, tenant_id)
        if problems:
            raise PolicyDenied("This MCP tool is not available", details={"tool": tool.qualified_name,
                                                                          "reasons": problems})

    @staticmethod
    def ensure_tenant(owner_tenant_id: uuid.UUID, tenant_id: uuid.UUID) -> None:
        if owner_tenant_id != tenant_id:
            raise PolicyDenied("This MCP tool is not available")

    # -- payloads
    def check_arguments(self, arguments: Any) -> dict[str, Any]:
        if not isinstance(arguments, dict):
            raise ToolInputInvalid("MCP tool arguments must be a JSON object")
        try:
            size = json_size(arguments)
        except (TypeError, ValueError) as exc:
            raise ToolInputInvalid("MCP tool arguments are not JSON-serialisable") from exc
        if size > self.limits.max_argument_bytes:
            raise ToolInputInvalid("MCP tool arguments are too large",
                                   details={"max_bytes": self.limits.max_argument_bytes})
        if json_depth(arguments) > self.limits.max_argument_depth:
            raise ToolInputInvalid("MCP tool arguments are nested too deeply",
                                   details={"max_depth": self.limits.max_argument_depth})
        return arguments

    def structured_output_within_limits(self, value: Any) -> bool:
        try:
            return (json_size(value) <= self.limits.max_structured_output_bytes
                    and json_depth(value) <= self.limits.max_schema_depth)
        except (TypeError, ValueError):
            return False

    def bound_structured_output(self, value: dict[str, Any]) -> dict[str, Any]:
        limits = self.limits
        bounded: dict[str, Any] = bound_structure(value, max_depth=limits.max_structured_depth,
                                                  max_items=limits.max_structured_items,
                                                  max_string=limits.max_structured_string)
        return bounded

    def call_timeout(self, seconds: float) -> float:
        return max(0.5, min(float(seconds), self.limits.max_call_seconds))

    @staticmethod
    def is_read_only(permission_level: PermissionLevel | str) -> bool:
        return PermissionLevel(permission_level) is PermissionLevel.READ


def get_policy_checker() -> MCPPolicyChecker:
    return MCPPolicyChecker()
