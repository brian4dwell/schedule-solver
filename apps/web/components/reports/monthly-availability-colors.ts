import type { CSSProperties } from "react";

import type { MonthlyScheduleAssignmentApi } from "@/lib/schemas/reports";

type ScheduledCenterStyles = {
  card: CSSProperties;
  badge: CSSProperties;
};

function centerColorTint(color: string | null, colorPercentage: number): string {
  if (color === null) {
    return "transparent";
  }

  const whitePercentage = 100 - colorPercentage;
  const tint = `color-mix(in srgb, ${color} ${colorPercentage}%, white ${whitePercentage}%)`;
  return tint;
}

function centerColorBands(colors: (string | null)[], colorPercentage: number): string {
  const stops = colors.map((color, index) => {
    const tint = centerColorTint(color, colorPercentage);
    const startPercentage = index * 100 / colors.length;
    const endPercentage = (index + 1) * 100 / colors.length;
    const stop = `${tint} ${startPercentage}% ${endPercentage}%`;
    return stop;
  });
  const gradientStops = stops.join(", ");
  const gradient = `linear-gradient(to right, ${gradientStops})`;
  return gradient;
}

export function scheduledCenterStyles(assignments: MonthlyScheduleAssignmentApi[]): ScheduledCenterStyles {
  const assignmentColors = assignments.map((assignment) => assignment.center_color);
  const uniqueColors = new Set(assignmentColors);
  const colors = Array.from(uniqueColors);

  if (colors.length === 1) {
    const color = colors[0];
    const cardTint = centerColorTint(color, 10);
    const badgeTint = centerColorTint(color, 25);
    const borderColor = color === null ? undefined : color;
    const card = { backgroundColor: cardTint, borderColor };
    const badge = { backgroundColor: badgeTint };
    return { card, badge };
  }

  if (colors.length > 1) {
    const cardBands = centerColorBands(colors, 10);
    const badgeBands = centerColorBands(colors, 25);
    const card = { backgroundImage: cardBands };
    const badge = { backgroundImage: badgeBands };
    return { card, badge };
  }

  return { card: {}, badge: {} };
}
