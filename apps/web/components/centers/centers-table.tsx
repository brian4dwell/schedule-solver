"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deactivateCenter, type Center } from "@/lib/api";

type CentersTableProps = {
  centers: Center[];
};

export function CentersTable({ centers }: CentersTableProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDeactivate(centerId: string) {
    setErrorMessage(null);

    try {
      await deactivateCenter(centerId);
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Center deactivation failed.";
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
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Location</th>
              <th className="px-4 py-3 font-semibold">Timezone</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {centers.map((center) => {
              const location = [center.city, center.state].filter(Boolean).join(", ");
              const status = center.is_active ? "Active" : "Inactive";

              return (
                <tr key={center.id}>
                  <td className="px-4 py-3 font-medium text-slate-950">
                    <Link href={`/centers/${center.id}`} className="hover:text-teal-700">
                      {center.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{location}</td>
                  <td className="px-4 py-3 text-slate-600">{center.timezone}</td>
                  <td className="px-4 py-3 text-slate-600">{status}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleDeactivate(center.id)}
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
