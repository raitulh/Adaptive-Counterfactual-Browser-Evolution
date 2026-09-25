"use client";

import { Info } from "lucide-react";
import { toast } from "sonner";
import { BrowserFrame } from "@/components/demo/browser-frame";
import { DemoConsole } from "@/components/demo/demo-console";
import { ScenarioPicker } from "@/components/demo/scenario-picker";
import { VerificationWidget } from "@/components/demo/verification-widget";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/field";
import { useVerificationDemo } from "@/hooks/use-verification-demo";
import { apiMode } from "@/lib/api/mode";

export function LiveDemo() {
  const demo = useVerificationDemo();
  const { state } = demo;
  const isMock = apiMode === "mock";
  const modeLabel = isMock ? "Mock mode" : "Live API";

  return (
    <div className="flex flex-col gap-8">
      {isMock ? <ScenarioPicker value={demo.scenario} onChange={demo.setScenario} /> : null}

      <BrowserFrame
        url="app.example.com/signup"
        aside={
          <Badge tone={isMock ? "warning" : "accent"} size="sm">
            {isMock ? "Simulated" : "Live"}
          </Badge>
        }
      >
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="relative flex items-center justify-center overflow-hidden px-5 py-10 sm:px-10 sm:py-14">
            <div aria-hidden className="absolute inset-0 bg-grid opacity-60" />
            <form
              aria-label="Example signup form"
              className="relative flex w-full max-w-md flex-col gap-5 rounded-2xl border border-border bg-surface/90 p-6 shadow-elevated backdrop-blur sm:p-7"
              onSubmit={(event) => {
                event.preventDefault();
                toast.success("Demo complete", {
                  description:
                    "In production, your server redeems the token with your secret key before creating the account.",
                });
              }}
            >
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold tracking-tight">Create your account</p>
                <p className="text-sm text-muted">
                  An example signup flow protected by verification.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="demo-email">Work email</Label>
                <Input id="demo-email" defaultValue="alex@example.com" readOnly aria-readonly />
              </div>
              <VerificationWidget
                state={state}
                secondsLeft={demo.secondsLeft}
                start={demo.start}
                submit={demo.submit}
                retry={demo.retry}
                runAgain={demo.runAgain}
              />
              <Button type="submit" size="lg" disabled={state.status !== "verified"}>
                Create account
              </Button>
            </form>
          </div>

          <DemoConsole
            state={state}
            modeLabel={modeLabel}
            className="border-t border-border lg:border-t-0 lg:border-l"
          />
        </div>
      </BrowserFrame>

      <p className="mx-auto flex max-w-2xl items-start gap-2 text-center text-xs text-subtle sm:items-center">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 sm:mt-0" />
        {isMock
          ? "Simulated with a deterministic mock adapter. Results are illustrative and provide no protection — production verification runs server-side on live signals."
          : "Connected to the live verification API configured for this deployment."}
      </p>
    </div>
  );
}
