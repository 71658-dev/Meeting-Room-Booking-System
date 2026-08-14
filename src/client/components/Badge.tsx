import { ComponentChildren } from 'preact';

interface BadgeProps {
  children: ComponentChildren;
  variant?: 'cat-1' | 'cat-2' | 'cat-3' | 'cat-4' | 'cat-5' | 'cat-6' | 'accent' | 'neutral' | 'ink';
  size?: 'sm' | 'md';
}

// Wraps the .mtag family in index.css, which mirrors the design system's .tag
// classes. Square corners: the system sets every radius to 0 on purpose.
export function Badge({ children, variant = 'neutral', size = 'sm' }: BadgeProps) {
  const variantStyles = {
    'cat-1': 'cat-1-badge border',
    'cat-2': 'cat-2-badge border',
    'cat-3': 'cat-3-badge border',
    'cat-4': 'cat-4-badge border',
    'cat-5': 'cat-5-badge border',
    'cat-6': 'cat-6-badge border',
    accent: 'mtag mtag-accent-2',
    neutral: 'mtag mtag-neutral',
    ink: 'mtag mtag-ink',
  };

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5 font-bold',
    md: 'text-sm px-2.5 py-1 font-bold',
  };

  return <span class={`inline-flex items-center gap-1 ${variantStyles[variant]} ${sizeStyles[size]}`}>{children}</span>;
}
