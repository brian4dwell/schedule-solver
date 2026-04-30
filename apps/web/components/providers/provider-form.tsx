"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createProvider, type Center, type Provider, type RoomType, updateProvider } from "@/lib/api";
import type { ProviderFormValues } from "@/lib/schemas/provider";

type ProviderFormProps = {
  centers: Center[];
  provider?: Provider;
  roomTypes: RoomType[];
};

function providerIsCredentialedForCenter(provider: Provider | undefined, centerId: string) {
  if (provider === undefined) {
    return false;
  }

  const providerCenterIds = provider.credentialed_center_ids;
  const isCredentialed = providerCenterIds.includes(centerId);
  return isCredentialed;
}

function providerHasRoomTypeSkill(provider: Provider | undefined, roomTypeId: string) {
  if (provider === undefined) {
    return false;
  }

  const providerRoomTypeIds = provider.skill_room_type_ids;
  const hasSkill = providerRoomTypeIds.includes(roomTypeId);
  return hasSkill;
}

export function ProviderForm({ centers, provider, roomTypes }: ProviderFormProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isEditing = provider !== undefined;
  const availableRoomTypes = roomTypes.filter((roomType) => {
    const shouldShowRoomType = roomType.is_active;
    return shouldShowRoomType;
  });

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
      credentialedCenterIds: formData.getAll("credentialedCenterIds").map((centerId) => {
        const credentialedCenterId = String(centerId);
        return credentialedCenterId;
      }),
      skillRoomTypeIds: formData.getAll("skillRoomTypeIds").map((roomTypeId) => {
        const skillRoomTypeId = String(roomTypeId);
        return skillRoomTypeId;
      }),
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
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-950">
          Credentialed centers
        </legend>
        {centers.length === 0 ? (
          <p className="text-sm leading-6 text-slate-500">Add centers before credentialing providers.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {centers.map((center) => {
              const isCredentialed = providerIsCredentialedForCenter(provider, center.id);

              return (
                <label
                  key={center.id}
                  className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
                >
                  <input
                    name="credentialedCenterIds"
                    type="checkbox"
                    value={center.id}
                    defaultChecked={isCredentialed}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700"
                  />
                  <span>{center.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-950">
          Skills
        </legend>
        {availableRoomTypes.length === 0 ? (
          <p className="text-sm leading-6 text-slate-500">Add room types before assigning provider skills.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {availableRoomTypes.map((roomType) => {
              const hasSkill = providerHasRoomTypeSkill(provider, roomType.id);

              return (
                <label
                  key={roomType.id}
                  className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
                >
                  <input
                    name="skillRoomTypeIds"
                    type="checkbox"
                    value={roomType.id}
                    defaultChecked={hasSkill}
                    className="h-4 w-4 rounded border-slate-300 text-teal-700"
                  />
                  <span>{roomType.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
      >
        {isEditing ? "Save provider" : "Create provider"}
      </button>
    </form>
  );
}
