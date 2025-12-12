import React from "react"

export interface ButtonProps {
  size?: "sm" | "md"
}

export function Button({ size }: ButtonProps) {
  return <button data-size={size} />
}

