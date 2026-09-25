"use client";

import { KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { CreateApiKeyDialog } from "@/components/dashboard/create-api-key-dialog";
import { DataTable, Td, Th, Tr } from "@/components/dashboard/data-table";
import { MockNotice } from "@/components/dashboard/mock-notice";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useApiKeys, useRevokeApiKey } from "@/hooks/use-dashboard-data";
import { toApiError } from "@/lib/api";
import { formatUtcDateTime } from "@/lib/utils/format";

export function ApiKeysView() {
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();

  async function handleRevoke(id: string, name: string) {
    try {
      await revoke.mutateAsync(id);
      toast.success(`Revoked “${name}”`);
    } catch (error) {
      toast.error("Couldn't revoke the key", { description: toApiError(error).message });
    }
  }

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Secret keys authenticate your server. They are shown once, at creation."
        actions={<CreateApiKeyDialog />}
      />
      <MockNotice>Keys created here are mock values and are not stored anywhere.</MockNotice>

      {keys.isPending ? (
        <LoadingState rows={3} label="Loading API keys" />
      ) : keys.isError ? (
        <ErrorState
          title="Couldn't load API keys"
          description={toApiError(keys.error).message}
          onRetry={() => void keys.refetch()}
        />
      ) : keys.data.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys yet"
          description="Create a test key to start redeeming verification tokens from your server."
          action={<CreateApiKeyDialog />}
        />
      ) : (
        <DataTable label="API keys">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Key</Th>
              <Th>Environment</Th>
              <Th>Created</Th>
              <Th>Last used</Th>
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {keys.data.map((key) => (
              <Tr key={key.id}>
                <Td className="font-medium text-foreground">{key.name}</Td>
                <Td className="font-mono text-xs" data-testid="api-key-masked">
                  {key.maskedKey}
                </Td>
                <Td>
                  <Badge size="sm" tone={key.environment === "live" ? "accent" : "neutral"}>
                    {key.environment}
                  </Badge>
                </Td>
                <Td className="font-mono text-xs">{formatUtcDateTime(key.createdAt)}</Td>
                <Td className="font-mono text-xs">
                  {key.lastUsedAt ? formatUtcDateTime(key.lastUsedAt) : "Never"}
                </Td>
                <Td className="text-right">
                  <ConfirmDialog
                    title={`Revoke “${key.name}”?`}
                    description="Requests using this key will be rejected immediately. This cannot be undone."
                    confirmLabel="Revoke key"
                    onConfirm={() => handleRevoke(key.id, key.name)}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${key.name}`}>
                        <Trash2 aria-hidden />
                      </Button>
                    }
                  />
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
