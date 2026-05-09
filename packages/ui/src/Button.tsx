import React from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  className?: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 hover:bg-blue-700 text-white",
  secondary: "bg-gray-200 hover:bg-gray-300 text-gray-800",
  danger: "bg-red-600 hover:bg-red-700 text-white",
};

export function Button({
  children,
  variant = "primary",
  disabled = false,
  onClick,
  type = "button",
  className = "",
}: ButtonProps): React.ReactElement {
  const baseStyles =
    "px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}