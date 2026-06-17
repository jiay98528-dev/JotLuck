/**
 * button-variants.ts — 零依赖 CVA 实现
 *
 * 借鉴 shadcn/ui 的 class-variance-authority 模式，手动实现。
 * 将 { variant, size } 映射为 BEM 风格的 CSS 类名字符串。
 */

export type ButtonVariant =
  | 'default' // filled accent (primary action)
  | 'secondary' // muted paper-surface (secondary)
  | 'outline' // bordered transparent (tertiary)
  | 'ghost' // bare, bg on hover only (toolbar/icon)
  | 'destructive' // signal-error (dangerous actions)
  | 'link'; // text-only, underline on hover

export type ButtonSize =
  | 'sm' // 28px height, text-xs
  | 'md' // 34px height, text-sm (default)
  | 'lg' // 42px height, text-base
  | 'icon' // 34px square
  | 'icon-sm' // 28px square
  | 'icon-lg'; // 42px square

export interface ButtonVariantOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * 返回空格分隔的 BEM CSS 类名字符串。
 * 示例：buttonVariants({ variant: 'outline', size: 'sm' })
 *    → "mk-btn mk-btn--outline mk-btn--sm"
 */
export function buttonVariants(options: ButtonVariantOptions = {}): string {
  const variant = options.variant ?? 'default';
  const size = options.size ?? 'md';
  return `mk-btn mk-btn--${variant} mk-btn--${size}`;
}
