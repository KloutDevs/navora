import React from "react";

export interface CardProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  onClick?: () => void;
}

export function Card({
  children,
  title,
  className = "",
  onClick,
}: CardProps): React.ReactElement {
  const baseStyles = "bg-white rounded-lg border border-gray-200 shadow-sm";
  const clickableStyles = onClick
    ? "cursor-pointer hover:shadow-md transition-shadow"
    : "";

  return (
    <div
      className={`${baseStyles} ${clickableStyles} ${className}`}
      onClick={onClick}
    >
      {title && (
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}