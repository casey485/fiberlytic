import { useState } from 'react'
import { X, ListChecks } from 'lucide-react'
import {
  DEFAULT_CALLOUT_DISPLAY_SETTINGS, getCalloutDisplaySettings, saveCalloutDisplaySettings,
  type CalloutDisplaySettings,
} from '../lib/calloutDisplaySettings'

interface Props {
  onClose: () => void
}

const FIELD_LABELS: { key: keyof CalloutDisplaySettings; label: string }[] = [
  { key: 'workType', label: 'Work Type' },
  { key: 'crew', label: 'Crew' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'date', label: 'Date' },
  { key: 'billingCode', label: 'Billing Code' },
  { key: 'notes', label: 'Notes' },
  { key: 'photosIndicator', label: 'Photos Attached Indicator' },
  { key: 'gpsCoordinates', label: 'GPS Coordinates' },
  { key: 'createdBy', label: 'Created By' },
]

/** Global, persisted preferences for which fields a Work Object's callout box
 *  shows on the Field Map — see calloutDisplaySettings.ts. Applies immediately
 *  to every callout on this device (both KmzMap and PdfPrintMode share the same
 *  storage key) and every future one, until changed again. */
export function CalloutSettingsPopover({ onClose }: Props) {
  const [settings, setSettings] = useState<CalloutDisplaySettings>(() => getCalloutDisplaySettings())

  function toggle(key: keyof CalloutDisplaySettings) {
    setSettings((s) => {
      const next = { ...s, [key]: !s[key] }
      saveCalloutDisplaySettings(next)
      return next
    })
  }

  function resetDefaults() {
    setSettings(DEFAULT_CALLOUT_DISPLAY_SETTINGS)
    saveCalloutDisplaySettings(DEFAULT_CALLOUT_DISPLAY_SETTINGS)
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className="w-72 rounded-lg border border-[#2a2a2a] bg-[#141414] shadow-xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#2a2a2a] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
            <ListChecks size={15} className="text-brand-400" />
            Callout Display Settings
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-1.5 p-3">
          <p className="mb-1 text-[11px] text-slate-500">
            Choose which fields show on every Work Object's callout box. Applies to all future callouts until changed again.
          </p>
          {FIELD_LABELS.map(({ key, label }) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-slate-300 hover:bg-white/5">
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={() => toggle(key)}
                className="accent-brand-500"
              />
              {label}
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#2a2a2a] px-3 py-2">
          <button onClick={resetDefaults} className="text-[11px] text-slate-500 hover:text-slate-300">
            Reset to default
          </button>
        </div>
      </div>
    </div>
  )
}
