"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { deactivateRoom, type Center, type Room } from "@/lib/api";

type RoomRow = {
  room: Room;
  center: Center;
};

type RoomsTableProps = {
  rows: RoomRow[];
};

export function RoomsTable({ rows }: RoomsTableProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDeactivate(roomId: string) {
    setErrorMessage(null);

    try {
      await deactivateRoom(roomId);
      router.refresh();
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : "Room deactivation failed.";
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
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const status = row.room.is_active ? "Active" : "Inactive";

              return (
                <tr key={row.room.id}>
                  <td className="px-4 py-3 font-medium text-slate-950">{row.room.name}</td>
                  <td className="px-4 py-3 text-slate-600">{row.center.name}</td>
                  <td className="px-4 py-3 text-slate-600">{row.room.display_order}</td>
                  <td className="px-4 py-3 text-slate-600">{status}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleDeactivate(row.room.id)}
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
