import React from "react"

export interface ButtonProps {
  colorPalette?: string
  size?: "sm" | "md"
  variant?: "solid" | "ghost"
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  isDisabled?: boolean
  children?: React.ReactNode
}

export function Button(props: ButtonProps) {
  const { colorPalette, size, variant, leftIcon, rightIcon, isDisabled, children } = props
  return (
    <button disabled={isDisabled} data-color={colorPalette} data-size={size} data-variant={variant}>
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  )
}

