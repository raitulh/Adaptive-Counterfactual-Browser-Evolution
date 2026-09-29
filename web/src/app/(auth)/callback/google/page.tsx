import type { Metadata } from "next";
import { Suspense } from "react";
import { GoogleCallback } from "@/components/auth/google-callback";

export const metadata: Metadata = { title: "Signing in", robots: { index: false, follow: false } };

export default function GoogleCallbackPage() {
  return (
    <Suspense>
      <GoogleCallback />
    </Suspense>
  );
}
