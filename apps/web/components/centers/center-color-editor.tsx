"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { updateCenterColor, type Center } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import { CenterColorPicker } from "@/components/centers/center-color-picker";

type CenterColorEditorProps = {
  center: Center;
};

export function CenterColorEditor({ center }: CenterColorEditorProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [color, setColor] = useState(center.color);
  const [savedColor, setSavedColor] = useState(center.color);
  const [isSaving, setIsSaving] = useState(false);
  const hasChanges = color !== savedColor;
  const pickerLabel = `${center.name} color`;

  async function saveColor() {
    setIsSaving(true);

    try {
      const updatedCenter = await updateCenterColor(center.id, color);
      setSavedColor(updatedCenter.color);
      showToast({ title: "Center color saved", description: center.name, tone: "success" });
      router.refresh();
    } catch (error) {
      const description = error instanceof Error ? error.message : "Center color save failed.";
      showToast({ title: "Center color save failed", description, tone: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <CenterColorPicker color={color} onChange={setColor} label={pickerLabel} disabled={isSaving} />
      {hasChanges ? (
        <button
          type="button"
          disabled={isSaving}
          onClick={saveColor}
          className="text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50"
          aria-label={`Save ${center.name} color`}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      ) : null}
    </div>
  );
}
