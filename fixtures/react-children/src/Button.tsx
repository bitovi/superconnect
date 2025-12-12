import React from "react"

export interface ButtonProps {
  variant?: "solid" | "ghost"
  children?: React.ReactNode
}

export function Button({ variant, children }: ButtonProps) {
  return <button data-variant={variant}>{children}</button>
}

