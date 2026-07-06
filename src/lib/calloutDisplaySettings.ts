// ---------------------------------------------------------------------------
// Global, persisted preferences for which fields a Work Object's callout box
// shows. Deliberately its own tiny localStorage store rather than part of
// AppData/DataContext — this is view-state, not domain data (same reasoning
// as workObjectPanelPosition.ts). One flat object, not per-markup: the user
// picks a layout once and every future callout follows it until changed again.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'fiberlytic:calloutDisplaySettings:v1'

export interface CalloutDisplaySettings {
  workType: boolean
  crew: boolean
  quantity: boolean
  date: boolean
  billingCode: boolean
  notes: boolean
  photosIndicator: boolean
  gpsCoordinates: boolean
  createdBy: boolean
}

// Matches today's callout content exactly (minus the removed Status line) so
// existing users see no visual change until they opt into the new fields.
export const DEFAULT_CALLOUT_DISPLAY_SETTINGS: CalloutDisplaySettings = {
  workType: true,
  crew: true,
  quantity: true,
  date: true,
  billingCode: true,
  notes: false,
  photosIndicator: false,
  gpsCoordinates: false,
  createdBy: false,
}

export function getCalloutDisplaySettings(): CalloutDisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CALLOUT_DISPLAY_SETTINGS
    return { ...DEFAULT_CALLOUT_DISPLAY_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_CALLOUT_DISPLAY_SETTINGS
  }
}

export function saveCalloutDisplaySettings(settings: CalloutDisplaySettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // storage full/unavailable — non-fatal, preference just won't persist
  }
}
