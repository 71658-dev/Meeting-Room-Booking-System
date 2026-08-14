import { ComponentChildren } from 'preact';

interface ButtonProps {
  children: ComponentChildren;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled = false,
  className = '',
  id,
}: ButtonProps) {
  // Modernist: zero radius, no scale/lift on press, labels flush left (a button
  // wider than its label starts the text at the left padding edge — see the
  // system readme). The palette is ink plus the single brick accent; there is no
  // separate danger hue, so destructive actions share the accent fill.
  const baseStyle =
    'inline-flex items-center justify-start text-left font-bold transition-colors duration-150 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed';

  const variantStyles = {
    primary: 'bg-[#9e3526] hover:bg-[#71261b] text-white border-none',
    secondary: 'bg-[#eae9e9] hover:bg-[#d7d3d3] text-[#201e1d] border border-[#201e1d]',
    danger: 'bg-[#9e3526] hover:bg-[#71261b] text-white border-none',
    outline: 'border border-[#201e1d] bg-white hover:bg-[#eae9e9] text-[#201e1d] font-semibold',
    ghost: 'bg-transparent hover:bg-[#201e1d]/7 text-[#9e3526] border-none',
  };

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  };

  return (
    <button
      id={id}
      type={type}
      onClick={onClick}
      disabled={disabled}
      class={`${baseStyle} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </button>
  );
}
