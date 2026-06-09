import { redirect } from "next/navigation";

export default async function AdminProviderStatusPage() {
  redirect("/admin/provider-invites");
}
