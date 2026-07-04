import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  compact?: boolean
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'

/** Drag-and-drop file upload — no shared component existed elsewhere in the
 *  app (BulkImportModal.tsx/Expenses.tsx each have their own copy-pasted,
 *  spreadsheet-only version); this is Map Reading's own, accepting PDF/PNG/
 *  JPG/JPEG and multiple files at once. */
export function DropZone({ onFiles, compact }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    onFiles(Array.from(fileList))
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-center transition ${
        compact ? 'p-3' : 'p-8'
      } ${dragging ? 'border-brand-500 bg-brand-900/10' : 'border-[#2a2a2a] hover:border-[#3a3a3a]'}`}
    >
      <Upload size={compact ? 16 : 22} className="text-slate-500" />
      <p className={`${compact ? 'text-[11px]' : 'text-sm'} text-slate-400`}>
        Drag &amp; drop cut PDF/image pages here, or click to browse
      </p>
      <p className="text-[10px] text-slate-600">PDF, PNG, JPG, JPEG &middot; multiple files supported</p>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); if (inputRef.current) inputRef.current.value = '' }}
      />
    </div>
  )
}
