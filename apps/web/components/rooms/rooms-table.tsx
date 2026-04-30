"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteRoom, updateRoom, type Center, type Room, type RoomType } from "@/lib/api";
import type { RoomFormValues } from "@/lib/schemas/room";

type RoomRow = {
  room: Room;
  center: Center;
};

type RoomsTableProps = {
  rows: RoomRow[];
  roomTypes: RoomType[];
};

export function RoomsTable({ rows, roomTypes }: RoomsTableProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingRoomName, setEditingRoomName] = useState("");
  const [editingMdOnly, setEditingMdOnly] = useState(false);
  const [editingRoomTypeIds, setEditingRoomTypeIds] = useState<string[]>([]);

  function handleEditStart(row: RoomRow) {
    const roomTypeIds = row.room.room_types.map((roomType) => {
      const roomTypeId = roomType.id;
      return roomTypeId;
    });

    setErrorMessage(null);
    setEditingRoomId(row.room.id);
    setEditingRoomName(row.room.name);
    setEditingMdOnly(row.room.md_only);
    setEditingRoomTypeIds(roomTypeIds);
  }

  function handleEditCancel() {
    setEditingRoomId(null);
    setEditingRoomName("");
    setEditingMdOnly(false);
    setEditingRoomTypeIds([]);
  }

  function handleRoomTypeToggle(roomTypeId: string) {
    const hasRoomType = editingRoomTypeIds.includes(roomTypeId);

    if (hasRoomType) {
      const nextRoomTypeIds = editingRoomTypeIds.filter((currentRoomTypeId) => {
        const shouldKeepRoomType = currentRoomTypeId !== roomTypeId;
        return shouldKeepRoomType;
      });

      setEditingRoomTypeIds(nextRoomTypeIds);
      return;
    }

    const nextRoomTypeIds = [...editingRoomTypeIds, roomTypeId];
    setEditingRoomTypeIds(nextRoomTypeIds);
  }

  async function handleUpdate(row: RoomRow) {
    setErrorMessage(null);

    const values: RoomFormValues = {
      centerId: row.center.id,
      name: editingRoomName,
      displayOrder: row.room.display_order,
      mdOnly: editingMdOnly,
      roomTypeIds: editingRoomTypeIds,
    };

    try {
      await updateRoom(row.room.id, values);
      handleEditCancel();
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Room update failed.";
      setErrorMessage(nextErrorMessage);
    }
  }

  async function handleDelete(roomId: string) {
    setErrorMessage(null);

    try {
      await deleteRoom(roomId);
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Room delete failed.";
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
              <th className="px-4 py-3 font-semibold">Room</th>
              <th className="px-4 py-3 font-semibold">Center</th>
              <th className="px-4 py-3 font-semibold">Room Type</th>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">MDs Only</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const status = row.room.is_active ? "Active" : "Inactive";
              const isEditing = editingRoomId === row.room.id;
              const selectableRoomTypes = roomTypes.filter((roomType) => {
                const isAssigned = editingRoomTypeIds.includes(roomType.id);
                const shouldShowRoomType = roomType.is_active || isAssigned;
                return shouldShowRoomType;
              });

              return (
                <tr key={row.room.id}>
                  <td className="px-4 py-3 font-medium text-slate-950">
                    {isEditing ? (
                      <input
                        value={editingRoomName}
                        onChange={(event) => setEditingRoomName(event.target.value)}
                        className="h-9 w-full min-w-40 rounded-md border border-slate-300 px-3 text-sm text-slate-950"
                      />
                    ) : (
                      row.room.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.center.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {isEditing ? (
                      <div className="flex min-w-52 flex-wrap gap-2">
                        {selectableRoomTypes.length === 0 ? (
                          <span className="text-slate-400">None</span>
                        ) : null}
                        {selectableRoomTypes.map((roomType) => {
                          const isChecked = editingRoomTypeIds.includes(roomType.id);
                          return (
                            <label
                              key={roomType.id}
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleRoomTypeToggle(roomType.id)}
                                className="h-3.5 w-3.5 accent-teal-700"
                              />
                              {roomType.name}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {row.room.room_types.length === 0 ? (
                          <span className="text-slate-400">None</span>
                        ) : null}
                        {row.room.room_types.map((roomType) => {
                          return (
                            <span
                              key={roomType.id}
                              className="rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800"
                            >
                              {roomType.name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.room.display_order}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {isEditing ? (
                      <label className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={editingMdOnly}
                          onChange={(event) => setEditingMdOnly(event.target.checked)}
                          className="h-3.5 w-3.5 accent-teal-700"
                        />
                        MDs Only
                      </label>
                    ) : (
                      row.room.md_only ? "Yes" : "No"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{status}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleUpdate(row)}
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
                          onClick={() => handleEditStart(row)}
                          className="text-sm font-medium text-slate-600 hover:text-slate-950"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(row.room.id)}
                        className="text-sm font-medium text-slate-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
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
