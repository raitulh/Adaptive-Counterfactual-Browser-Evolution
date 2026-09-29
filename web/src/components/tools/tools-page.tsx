"use client";

import { ScaleIcon, WrenchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToolCatalog, useToolRules } from "./queries";
import { ToolCatalog } from "./tool-catalog";
import { ToolPolicies } from "./tool-policies";

export function ToolsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") === "policies" ? "policies" : "catalog";
  const tools = useToolCatalog();
  const rules = useToolRules();

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Tool Center"
        description="Every tool an agent can request — its permission level, risk, required scopes and how its effect is verified — and the organization rules that govern it."
      />
      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(v === "catalog" ? pathname : `${pathname}?tab=${v}`, { scroll: false })}
      >
        <TabsList aria-label="Tool Center sections">
          <TabsTrigger value="catalog">
            <WrenchIcon /> Catalog
            {tools.data && <span className="font-mono text-2xs text-fg-subtle">{tools.data.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="policies">
            <ScaleIcon /> Policies
            {rules.data && <span className="font-mono text-2xs text-fg-subtle">{rules.data.length}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="mt-5">
          <ToolCatalog
            tools={tools.data}
            isLoading={tools.isLoading}
            error={tools.error}
            onRetry={() => void tools.refetch()}
            rules={rules.data}
          />
        </TabsContent>
        <TabsContent value="policies" className="mt-5">
          <ToolPolicies
            rules={rules.data}
            isLoading={rules.isLoading}
            error={rules.error}
            onRetry={() => void rules.refetch()}
            tools={tools.data ?? []}
          />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
