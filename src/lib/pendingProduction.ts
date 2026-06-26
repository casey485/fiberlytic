/**
 * Describes a production entry that has been filled out in the form but
 * not yet committed to the store — it's held in React Router location.state
 * until the crew completes and saves their redline markup.
 */

import type { LineItemInput } from '../store/DataContext'

/** A pending photo to be saved when the production entry is committed. */
export interface PendingPhoto {
  key: string
  /** Compressed JPEG data URL — will be stored in IndexedDB on commit. */
  preview: string
  caption: string
}

export interface PendingSimple {
  type: 'simple'
  date: string
  projectId: string
  crewId: string
  footage: number
  hours: number
  notes?: string
  lineItems: LineItemInput[]
  photos: PendingPhoto[]
}

export interface PendingCrewDay {
  type: 'crewDay'
  date: string
  projectId: string
  crewId: string
  footage: number
  notes?: string
  employees: { employeeId: string; hours: number }[]
  equipmentIds?: string[]
  photos: PendingPhoto[]
}

export type PendingProduction = PendingSimple | PendingCrewDay

/** Shape of the location.state object passed to the redline route. */
export interface RedlineLocationState {
  pending: PendingProduction
}
