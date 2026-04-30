"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createRoomType,
  deactivateRoomType,
  type RoomType,
  updateRoomType,
} from "@/lib/api";
import type { RoomTypeFormValues } from "@/lib/schemas/room";

type RoomTypesPanelProps = {
  roomTypes: RoomType[];
};

export function RoomTypesPanel({
  roomTypes,
}: RoomTypesPanelProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingRoomTypeId, setEditingRoomTypeId] = useState<string | null>(null);
  const [editingRoomTypeName, setEditingRoomTypeName] = useState("");
  const [editingDisplayOrder, setEditingDisplayOrder] = useState("0");
  const visibleRoomTypes = roomTypes;

  function handleEditStart(roomType: RoomType) {
    const displayOrderText = String(roomType.display_order);

    setErrorMessage(null);
    setEditingRoomTypeId(roomType.id);
    setEditingRoomTypeName(roomType.name);
    setEditingDisplayOrder(displayOrderText);
  }

  function handleEditCancel() {
    setEditingRoomTypeId(null);
    setEditingRoomTypeName("");
    setEditingDisplayOrder("0");
  }

  async function handleSubmit(formData: FormData) {
    setErrorMessage(null);

    const displayOrderValue = String(formData.get("displayOrder") ?? "0");
    const values: RoomTypeFormValues = {
      name: String(formData.get("name") ?? ""),
      displayOrder: Number(displayOrderValue),
    };

    try {
      await createRoomType(values);
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Room type save failed.";
      setErrorMessage(nextErrorMessage);
    }
  }

  async function handleDeactivate(roomTypeId: string) {
    setErrorMessage(null);

    try {
      await deactivateRoomType(roomTypeId);
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Room type deactivation failed.";
      setErrorMessage(nextErrorMessage);
    }
  }

  async function handleUpdate(roomTypeId: string) {
    setErrorMessage(null);

    const values: RoomTypeFormValues = {
      name: editingRoomTypeName,
      displayOrder: Number(editingDisplayOrder),
    };

    try {
      await updateRoomType(roomTypeId, values);
      handleEditCancel();
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Room type update failed.";
      setErrorMessage(nextErrorMessage);
    }
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-950">Room types</h3>
        <p className="mt-1 text-sm text-slate-500">
          Configure the organization-wide room types that can be assigned to rooms.
        </p>
      </div>
      {errorMessage ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <form action={handleSubmit} className="grid gap-4 border-b border-slate-200 p-5 md:grid-cols-[1fr_8rem_auto]">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Type name
          <input
            name="name"
            required
            placeholder="Peds"
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Order
          <input
            name="displayOrder"
            type="number"
            min="0"
            defaultValue="0"
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
          >
            Add type
          </button>
        </div>
      </form>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRoomTypes.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-5 text-sm text-slate-500">
                  No room types configured for this organization.
                </td>
              </tr>
            ) : null}
            {visibleRoomTypes.map((roomType) => {
              const isEditing = editingRoomTypeId === roomType.id;
              const status = roomType.is_active ? "Active" : "Inactive";

              return (
                <tr key={roomType.id}>
                  <td className="px-4 py-3 font-medium text-slate-950">
                    {isEditing ? (
                      <input
                        value={editingRoomTypeName}
                        onChange={(event) => setEditingRoomTypeName(event.target.value)}
                        className="h-9 w-full min-w-44 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950"
                      />
                    ) : (
                      roomType.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {isEditing ? (
                      <input
                        type="number"
                        min="0"
                        value={editingDisplayOrder}
                        onChange={(event) => setEditingDisplayOrder(event.target.value)}
                        className="h-9 w-24 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950"
                      />
                    ) : (
                      roomType.display_order
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{status}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleUpdate(roomType.id)}
                            className="text-sm font-medium text-teal-700 hover:text-teal-900"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={handleEditCancel}
                            className="text-sm font-medium text-slate-500 hover:text-slate-800"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleEditStart(roomType)}
                          className="text-sm font-medium text-slate-600 hover:text-slate-950"
                        >
                          Edit
                        </button>
                      )}
                      {roomType.is_active ? (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(roomType.id)}
                          className="text-sm font-medium text-slate-600 hover:text-red-700"
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
