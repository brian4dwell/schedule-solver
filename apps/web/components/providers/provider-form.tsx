"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createProvider, type Provider, updateProvider } from "@/lib/api";
import type { ProviderFormValues } from "@/lib/schemas/provider";

type ProviderFormProps = {
  provider?: Provider;
};

export function ProviderForm({ provider }: ProviderFormProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isEditing = provider !== undefined;

  async function handleSubmit(formData: FormData) {
    setErrorMessage(null);

    const values: ProviderFormValues = {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      providerType: String(formData.get("providerType") ?? "crna") as ProviderFormValues["providerType"],
      employmentType: String(formData.get("employmentType") ?? "employee") as ProviderFormValues["employmentType"],
      notes: String(formData.get("notes") ?? ""),
    };

    try {
      if (provider === undefined) {
        await createProvider(values);
      } else {
        await updateProvider(provider.id, values);
      }

      router.push("/providers");
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Provider save failed.";
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
          First name
          <input
            name="firstName"
            required
            defaultValue={provider?.first_name}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Last name
          <input
            name="lastName"
            required
            defaultValue={provider?.last_name}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Display name
          <input
            name="displayName"
            required
            defaultValue={provider?.display_name}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Email
          <input
            name="email"
            type="email"
            defaultValue={provider?.email ?? ""}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Phone
          <input
            name="phone"
            defaultValue={provider?.phone ?? ""}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Provider type
          <select
            name="providerType"
            defaultValue={provider?.provider_type ?? "crna"}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          >
            <option value="crna">CRNA</option>
            <option value="doctor">Doctor</option>
            <option value="staff">Staff</option>
            <option value="contractor">Contractor</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Employment type
          <select
            name="employmentType"
            defaultValue={provider?.employment_type ?? "employee"}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          >
            <option value="employee">Employee</option>
            <option value="contractor">Contractor</option>
            <option value="locum">Locum</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Notes
        <textarea
          name="notes"
          defaultValue={provider?.notes ?? ""}
          className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-slate-950"
        />
      </label>
      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
      >
        {isEditing ? "Save provider" : "Create provider"}
      </button>
    </form>
  );
}
