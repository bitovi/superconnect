import React from "react"

export interface ButtonProps {
  variant?: "solid" | "ghost"
  size?: "sm" | "md"
}

export function Button({ variant, size }: ButtonProps) {
  return <button data-variant={variant} data-size={size} />
}

