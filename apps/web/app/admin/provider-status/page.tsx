import { auth } from "@clerk/nextjs/server";

import { redirect } from "next/navigation";

export default async function AdminProviderStatusPage() {
  await auth.protect();

  redirect("/admin/provider-invites");
}
