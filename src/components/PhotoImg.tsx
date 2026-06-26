import { useEffect, useState } from 'react'
import { loadBlob } from '../lib/fileStore'

interface Props extends React.ImgHTMLAttributes<HTMLImageElement> {
  url: string
}

/** Renders a photo that may be stored in IndexedDB (url starts with "idb:"). */
export function PhotoImg({ url, className, alt, ...props }: Props) {
  const isIdb = url.startsWith('idb:')
  const [src, setSrc] = useState<string | null>(isIdb ? null : url || null)

  useEffect(() => {
    if (!isIdb) { setSrc(url || null); return }
    let cancelled = false
    loadBlob(url.slice(4)).then((data) => { if (!cancelled) setSrc(data) })
    return () => { cancelled = true }
  }, [url, isIdb])

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-100 text-slate-300 text-xs ${className ?? ''}`}
      >
        loading…
      </div>
    )
  }
  return <img src={src} alt={alt} className={className} {...props} />
}
