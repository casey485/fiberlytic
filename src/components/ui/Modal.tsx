import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

const sizeClass: Record<string, string> = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[3000] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-16">
      <div
        className={`w-full ${sizeClass[size]} rounded-xl border border-[#2a2a2a] bg-[#141414] shadow-xl shadow-black/60`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#2a2a2a] px-5 py-4">
          <h3 className="text-base font-semibold text-slate-200">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-white/8 hover:text-slate-300"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[#2a2a2a] px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}
