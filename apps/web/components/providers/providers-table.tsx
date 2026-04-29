"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deactivateProvider, type Provider } from "@/lib/api";

type ProvidersTableProps = {
  providers: Provider[];
};

export function ProvidersTable({ providers }: ProvidersTableProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDeactivate(providerId: string) {
    setErrorMessage(null);

    try {
      await deactivateProvider(providerId);
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Provider deactivation failed.";
      setErrorMessage(nextErrorMessage);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      {errorMessage ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Employment</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {providers.map((provider) => {
              const status = provider.is_active ? "Active" : "Inactive";

              return (
                <tr key={provider.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/providers/${provider.id}`}
                      className="font-medium text-slate-950 hover:text-teal-700"
                    >
                      {provider.display_name}
                    </Link>
                    <div className="text-slate-500">{provider.email}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{provider.provider_type}</td>
                  <td className="px-4 py-3 text-slate-600">{provider.employment_type}</td>
                  <td className="px-4 py-3 text-slate-600">{status}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleDeactivate(provider.id)}
                      className="text-sm font-medium text-slate-600 hover:text-red-700"
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
