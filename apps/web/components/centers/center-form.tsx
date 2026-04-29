"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createCenter, type Center, updateCenter } from "@/lib/api";
import type { CenterFormValues } from "@/lib/schemas/center";

type CenterFormProps = {
  center?: Center;
};

export function CenterForm({ center }: CenterFormProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isEditing = center !== undefined;

  async function handleSubmit(formData: FormData) {
    setErrorMessage(null);

    const values: CenterFormValues = {
      name: String(formData.get("name") ?? ""),
      addressLine1: String(formData.get("addressLine1") ?? ""),
      addressLine2: String(formData.get("addressLine2") ?? ""),
      city: String(formData.get("city") ?? ""),
      state: String(formData.get("state") ?? ""),
      postalCode: String(formData.get("postalCode") ?? ""),
      timezone: String(formData.get("timezone") ?? ""),
    };

    try {
      if (center === undefined) {
        await createCenter(values);
      } else {
        await updateCenter(center.id, values);
      }

      router.push("/centers");
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Center save failed.";
      setErrorMessage(nextErrorMessage);
    }
  }

  return (
    <form action={handleSubmit} className="max-w-3xl space-y-5 rounded-md border border-slate-200 bg-white p-5">
      {errorMessage ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Name
          <input
            name="name"
            required
            defaultValue={center?.name}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Timezone
          <input
            name="timezone"
            required
            defaultValue={center?.timezone ?? "America/New_York"}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Address line 1
          <input
            name="addressLine1"
            defaultValue={center?.address_line_1 ?? ""}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Address line 2
          <input
            name="addressLine2"
            defaultValue={center?.address_line_2 ?? ""}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          City
          <input
            name="city"
            defaultValue={center?.city ?? ""}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          State
          <input
            name="state"
            defaultValue={center?.state ?? ""}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Postal code
          <input
            name="postalCode"
            defaultValue={center?.postal_code ?? ""}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
      </div>
      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
      >
        {isEditing ? "Save center" : "Create center"}
      </button>
    </form>
  );
}
