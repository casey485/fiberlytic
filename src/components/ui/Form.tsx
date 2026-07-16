import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, ButtonHTMLAttributes } from 'react'

// Content pages (the vast majority of consumers) render on the light main
// content area; a handful of Field Map tool surfaces (AddWorkModal,
// WorkObjectPropertiesPanel) float over the dark map canvas and opt into
// `dark` to keep matching that canvas instead.
const baseFieldLight =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100'
const baseFieldDark =
  'w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-slate-200 shadow-sm placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-900/40'

export function Field({ label, children, hint, error, required, dark = false }: { label: string; children: ReactNode; hint?: string; error?: string; required?: boolean; dark?: boolean }) {
  return (
    <label className="block">
      <span className={`mb-1 block text-xs font-medium ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
        {label}{required && <span className="ml-0.5 text-red-400">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-400">{error}</span>
      ) : hint ? (
        <span className={`mt-1 block text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{hint}</span>
      ) : null}
    </label>
  )
}

export function Input({ dark = false, ...props }: InputHTMLAttributes<HTMLInputElement> & { dark?: boolean }) {
  return <input {...props} className={`${dark ? baseFieldDark : baseFieldLight} ${props.className ?? ''}`} />
}

export function Select({ dark = false, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { dark?: boolean }) {
  return <select {...props} className={`${dark ? baseFieldDark : baseFieldLight} ${props.className ?? ''}`} />
}

export function Textarea({ dark = false, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { dark?: boolean }) {
  return <textarea {...props} className={`${dark ? baseFieldDark : baseFieldLight} ${props.className ?? ''}`} />
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-200',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-200',
  ghost: 'bg-transparent text-slate-500 hover:bg-slate-100 focus:ring-slate-200',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-200',
}

const darkVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-900/40',
  secondary: 'bg-[#1e1e1e] text-slate-300 border border-[#2a2a2a] hover:bg-[#2a2a2a] focus:ring-slate-700',
  ghost: 'bg-transparent text-slate-400 hover:bg-white/8 focus:ring-slate-700',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-900/40',
}

export function Button({
  variant = 'primary',
  className = '',
  dark = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; dark?: boolean }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${(dark ? darkVariants : variants)[variant]} ${className}`}
    >
      {children}
    </button>
  )
}
