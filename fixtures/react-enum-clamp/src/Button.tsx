import React from "react"

export interface ButtonProps {
  size?: "sm" | "md"
  colorPalette?: "blue" | "red"
}

export function Button({ size, colorPalette }: ButtonProps) {
  return <button data-size={size} data-color={colorPalette} />
}

