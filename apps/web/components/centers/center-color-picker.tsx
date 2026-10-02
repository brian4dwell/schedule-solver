"use client";

import { centerColorSchema } from "@/lib/schemas/center";

type CenterColorPickerProps = {
  color: string | null;
  onChange: (color: string | null) => void;
  label: string;
  disabled?: boolean;
};

export function CenterColorPicker({ color, onChange, label, disabled }: CenterColorPickerProps) {
  const colorInputValue = color === null ? "" : color;
  const colorResult = centerColorSchema.safeParse(color);
  const validColor = colorResult.success ? colorResult.data : null;
  const initialColor = validColor === null ? undefined : validColor;

  return (
    <div className="flex items-center gap-2">
      <label className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded border border-slate-300 focus-within:outline-2 focus-within:outline-teal-700">
        <span
          className="absolute inset-0 flex items-center justify-center text-slate-500"
          style={{ backgroundColor: initialColor }}
          aria-hidden="true"
        >
          {color === null ? "+" : null}
        </span>
        <input
          type="color"
          aria-label={label}
          defaultValue={initialColor}
          disabled={disabled}
          onClick={(event) => {
            if (validColor !== null) {
              event.currentTarget.value = validColor;
            }
          }}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait"
        />
      </label>
      <input
        type="text"
        aria-label={`${label} hex value`}
        placeholder="Not set"
        value={colorInputValue}
        maxLength={7}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value;
          const nextColor = value === "" ? null : value;
          onChange(nextColor);
        }}
        className="h-8 w-24 rounded border border-slate-300 px-2 text-xs text-slate-700 focus:outline-teal-700 disabled:opacity-50"
      />
      {color !== null ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className="text-xs font-medium text-slate-600 hover:text-red-700 disabled:opacity-50"
          aria-label={`Clear ${label}`}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
