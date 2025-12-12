import React from "react"

export interface ButtonProps {
  icon?: React.ReactNode
  children?: React.ReactNode
}

export function Button({ icon, children }: ButtonProps) {
  return (
    <button>
      {icon}
      {children}
    </button>
  )
}

