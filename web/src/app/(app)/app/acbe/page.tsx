import type { Metadata } from "next";
import { Suspense } from "react";
import { AcbeLab } from "@/components/acbe/acbe-lab";

export const metadata: Metadata = { title: "ACBE Lab" };

export default function AcbePage() {
  return (
    <Suspense>
      <AcbeLab />
    </Suspense>
  );
}
