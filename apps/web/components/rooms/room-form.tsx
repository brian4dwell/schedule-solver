"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createRoom, type Center, type RoomType } from "@/lib/api";
import type { RoomFormValues } from "@/lib/schemas/room";

type RoomFormProps = {
  centers: Center[];
  roomTypes: RoomType[];
  selectedCenterId?: string;
};

export function RoomForm({ centers, roomTypes, selectedCenterId }: RoomFormProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentCenterId, setCurrentCenterId] = useState(selectedCenterId ?? "");
  const hasSelectedCenter = selectedCenterId !== undefined;
  const selectedCenter = centers.find((center) => {
    const isSelectedCenter = center.id === selectedCenterId;
    return isSelectedCenter;
  });
  const availableRoomTypes = roomTypes.filter((roomType) => {
    const shouldShowRoomType = roomType.is_active;
    return shouldShowRoomType;
  });

  async function handleSubmit(formData: FormData) {
    setErrorMessage(null);

    const displayOrderValue = String(formData.get("displayOrder") ?? "0");
    const roomTypeIds = formData.getAll("roomTypeIds").map((roomTypeId) => {
      const roomTypeIdText = String(roomTypeId);
      return roomTypeIdText;
    });
    const values: RoomFormValues = {
      centerId: String(formData.get("centerId") ?? ""),
      name: String(formData.get("name") ?? ""),
      displayOrder: Number(displayOrderValue),
      mdOnly: formData.get("mdOnly") === "on",
      roomTypeIds,
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
        {hasSelectedCenter ? (
          <div className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Center
            <input type="hidden" name="centerId" value={selectedCenterId} />
            <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-100 px-3 text-slate-700">
              {selectedCenter?.name}
            </div>
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Center
            <select
              name="centerId"
              required
              defaultValue=""
              onChange={(event) => setCurrentCenterId(event.target.value)}
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
        )}
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
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-950">Settings</p>
        <label className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            name="mdOnly"
            className="h-4 w-4 accent-teal-700"
          />
          MDs Only
        </label>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-950">Room Type</p>
        {currentCenterId === "" ? (
          <p className="mt-2 text-sm text-slate-500">Select a center before choosing room types.</p>
        ) : null}
        {currentCenterId !== "" && availableRoomTypes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No active room types are configured for this organization.</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {availableRoomTypes.map((roomType) => {
            return (
              <label
                key={roomType.id}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
              >
                <input
                  type="checkbox"
                  name="roomTypeIds"
                  value={roomType.id}
                  className="h-4 w-4 accent-teal-700"
                />
                {roomType.name}
              </label>
            );
          })}
        </div>
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
