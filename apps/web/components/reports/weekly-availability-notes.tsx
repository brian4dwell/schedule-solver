"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type WeeklyAvailabilityNotesProps = {
  providerName: string;
  notes: string;
};

type NotesPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  transform: string | undefined;
};

export function WeeklyAvailabilityNotes({
  providerName,
  notes,
}: WeeklyAvailabilityNotesProps) {
  const tooltipId = useId();
  const [position, setPosition] = useState<NotesPosition | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const label = `${providerName}: weekly availability notes`;

  function keepNotesOpen() {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  useEffect(() => {
    return () => {
      if (hideTimer.current !== null) {
        clearTimeout(hideTimer.current);
      }
    };
  }, []);

  function showNotes(button: HTMLButtonElement) {
    keepNotesOpen();
    const bounds = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(288, viewportWidth - 16);
    const rightmostLeft = viewportWidth - width - 8;
    const left = Math.max(8, Math.min(bounds.left, rightmostLeft));
    const spaceBelow = viewportHeight - bounds.bottom - 14;
    const showAbove = spaceBelow < 160;
    const top = showAbove ? bounds.top - 6 : bounds.bottom + 6;
    const maxHeight = showAbove ? bounds.top - 14 : spaceBelow;
    const transform = showAbove ? "translateY(-100%)" : undefined;
    const nextPosition = { left, top, width, maxHeight, transform };
    setPosition(nextPosition);
  }

  function hideNotes() {
    keepNotesOpen();
    setPosition(null);
  }

  function scheduleHideNotes() {
    keepNotesOpen();
    hideTimer.current = setTimeout(hideNotes, 150);
  }

  return (
    <>
      <button
        type="button"
        className="monthly-availability-screen-only rounded text-slate-500 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-teal-700"
        aria-label={label}
        aria-describedby={position === null ? undefined : tooltipId}
        onMouseEnter={(event) => showNotes(event.currentTarget)}
        onMouseLeave={scheduleHideNotes}
        onFocus={(event) => showNotes(event.currentTarget)}
        onBlur={hideNotes}
        onClick={(event) => showNotes(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            hideNotes();
          }
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 1 1 19 0Z" />
          <path d="M7 8h9M7 12h9M7 16h5" />
        </svg>
      </button>
      {position !== null ? createPortal(
        <div
          id={tooltipId}
          role="tooltip"
          className="monthly-availability-screen-only fixed z-50 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-800 shadow-lg"
          style={position}
          onMouseEnter={keepNotesOpen}
          onMouseLeave={hideNotes}
        >
          {notes}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
