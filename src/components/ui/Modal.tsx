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
  dark = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'xl'
  /** Field Map tool dialogs (AddWorkModal, delete confirms) float over the
   *  dark map canvas and opt into this to keep matching it — every other
   *  consumer renders on the light main content area, so it defaults off. */
  dark?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const shellCls = dark
    ? 'border-[#2a2a2a] bg-[#141414] shadow-xl shadow-black/60'
    : 'border-slate-200 bg-white shadow-xl shadow-slate-900/10'
  const borderCls = dark ? 'border-[#2a2a2a]' : 'border-slate-200'
  const titleCls = dark ? 'text-slate-200' : 'text-slate-900'
  const closeCls = dark ? 'text-slate-500 hover:bg-white/8 hover:text-slate-300' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'

  return (
    <div className="fixed inset-0 z-[3000] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-16">
      <div
        className={`w-full ${sizeClass[size]} rounded-xl border ${shellCls}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between border-b ${borderCls} px-5 py-4`}>
          <h3 className={`text-base font-semibold ${titleCls}`}>{title}</h3>
          <button
            onClick={onClose}
            className={`rounded-md p-1 ${closeCls}`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className={`flex justify-end gap-2 border-t ${borderCls} px-5 py-4`}>{footer}</div>}
      </div>
    </div>
  )
}
