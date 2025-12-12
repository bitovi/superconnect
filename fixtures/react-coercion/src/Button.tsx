import React from "react"

export interface ButtonProps {
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  isDisabled?: boolean
  variant?: "solid" | "ghost"
  children?: React.ReactNode
}

export function Button({ leftIcon, rightIcon, isDisabled, variant, children }: ButtonProps) {
  return (
    <button disabled={isDisabled} data-variant={variant}>
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  )
}

