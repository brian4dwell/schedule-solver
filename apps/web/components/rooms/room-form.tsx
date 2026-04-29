"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createRoom, type Center } from "@/lib/api";
import type { RoomFormValues } from "@/lib/schemas/room";

type RoomFormProps = {
  centers: Center[];
  selectedCenterId?: string;
};

export function RoomForm({ centers, selectedCenterId }: RoomFormProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setErrorMessage(null);

    const displayOrderValue = String(formData.get("displayOrder") ?? "0");
    const values: RoomFormValues = {
      centerId: String(formData.get("centerId") ?? ""),
      name: String(formData.get("name") ?? ""),
      displayOrder: Number(displayOrderValue),
    };

    try {
      await createRoom(values);
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Room save failed.";
      setErrorMessage(nextErrorMessage);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
      {errorMessage ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Center
          <select
            name="centerId"
            required
            defaultValue={selectedCenterId ?? ""}
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          >
            <option value="" disabled>
              Select center
            </option>
            {centers.map((center) => {
              return (
                <option key={center.id} value={center.id}>
                  {center.name}
                </option>
              );
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Room name
          <input
            name="name"
            required
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Display order
          <input
            name="displayOrder"
            type="number"
            min="0"
            defaultValue="0"
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
      </div>
      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
      >
        Add room
      </button>
    </form>
  );
}
