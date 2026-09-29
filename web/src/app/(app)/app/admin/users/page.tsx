import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminUsers } from "@/components/admin/admin-users";

export const metadata: Metadata = { title: "Users" };

export default function AdminUsersPage() {
  return (
    <Suspense>
      <AdminUsers />
    </Suspense>
  );
}
