import React from "react";

export type BadgeTier = "safe" | "mutating" | "dangerous";

export interface BadgeProps {
  tier: BadgeTier;
  label?: string;
  className?: string;
}

const tierStyles: Record<BadgeTier, string> = {
  safe: "bg-green-100 text-green-800 border-green-200",
  mutating: "bg-yellow-100 text-yellow-800 border-yellow-200",
  dangerous: "bg-red-100 text-red-800 border-red-200",
};

const tierLabels: Record<BadgeTier, string> = {
  safe: "Safe",
  mutating: "Mutating",
  dangerous: "Dangerous",
};

export function Badge({
  tier,
  label,
  className = "",
}: BadgeProps): React.ReactElement {
  const displayLabel = label ?? tierLabels[tier];

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${tierStyles[tier]} ${className}`}
    >
      {displayLabel}
    </span>
  );
}