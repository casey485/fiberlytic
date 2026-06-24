import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AppData,
  Client,
  Crew,
  Employee,
  Equipment,
  Invoice,
  JobExpense,
  Material,
  Photo,
  ProductionEntry,
  ProductionLineItem,
  PnLEntry,
  Project,
  RateCard,
  RateCardUnit,
  Timecard,
} from '../types'
import { generateSeedData } from '../data/seed'
import { crewLaborCost } from '../lib/laborCost'
import { revenuePerFoot } from '../lib/analytics'

const STORAGE_KEY = 'fiberlytic:data:v1'

/** Bring older saved data up to the current shape. */
function migrateData(raw: AppData): AppData {
  const crews = (raw.crews ?? []).map((c) => ({
    ...c,
    payType: c.payType ?? 'daily',
    payAmount: c.payAmount ?? c.dayRate ?? 0,
    members: c.members ?? [],
  }))
  const employees = (raw.employees ?? []).map((e) => ({
    ...e,
    isForeman: e.isForeman ?? false,
  }))
  // Build lookup sets so we can validate P&L entries against existing production
  const productionIds = new Set((raw.production ?? []).map((e) => e.id))
  const productionDateProject = new Set((raw.production ?? []).map((e) => `${e.date}|${e.projectId}`))

  // Materials are customer-provided — zero historical material costs.
  // Also drop any P&L entry whose production entry was deleted (orphan cleanup).
  const pnl = (raw.pnl ?? [])
    .map((e) => ({ ...e, materialCost: 0 }))
    .filter((e) => {
      if (e.productionEntryId) return productionIds.has(e.productionEntryId)
      // Legacy entries have no productionEntryId — keep only if a production entry
      // still exists for the same date + project
      return productionDateProject.has(`${e.date}|${e.projectId}`)
    })
  // Ensure DRILL CREW 1 exists — create it if no crew with "drill" in the name is found
  let drillCrew = crews.find((c) => c.name.trim().toLowerCase().includes('drill'))
  if (!drillCrew) {
    drillCrew = {
      id: 'crew-drill-1',
      name: 'DRILL CREW 1',
      foreman: '',
      specialty: 'directional_bore' as const,
      status: 'active' as const,
      currentProjectId: (raw.projects ?? [])[0]?.id ?? null,
      payType: 'daily' as const,
      payAmount: 0,
      members: [],
    }
    crews.push(drillCrew)
  }

  // One-time seed: inject week-of-06/16/2026 expenses for Drill Crew 1
  const alreadySeeded = (raw.jobExpenses ?? []).some(
    (e) => e.vendor === 'Vermeer Heartland' && e.amount === 299.19,
  )
  let jobExpenses = raw.jobExpenses ?? []
  if (!alreadySeeded) {
    const drillProjectId =
      drillCrew.currentProjectId ??
      [...(raw.production ?? [])]
        .filter((e) => e.crewId === drillCrew!.id)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.projectId ??
      (raw.projects ?? [])[0]?.id ??
      ''
    const seedRows = [
      { date: '2026-06-16', vendor: 'Expedia',          description: 'La Quinta Inn — 2 rooms x 1 night (Smith/Seese)', amount: 227.76 },
      { date: '2026-06-16', vendor: 'Airbnb',            description: 'Oak Ridge rental — 2 nights (06/17-06/19)',       amount: 328.70 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount:  17.06 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount:  13.61 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount: 100.00 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount:  51.29 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount:  93.12 },
      { date: '2026-06-17', vendor: 'Home Depot',        description: 'Tools & Materials (BoA)',                         amount: 269.28 },
      { date: '2026-06-17', vendor: 'Home Depot',        description: 'Rayam Receipt (replaces $200 BoA line)',          amount: 195.68 },
      { date: '2026-06-18', vendor: 'Petros Marathon',   description: 'Fuel (prepay)',                                   amount: 100.00 },
      { date: '2026-06-19', vendor: 'RaceWay',           description: 'Fuel + supplies',                                 amount: 107.10 },
      { date: '2026-06-19', vendor: 'Vermeer Heartland', description: 'Drill parts (Sub Saver + Quicklock)',             amount: 299.19 },
    ]
    jobExpenses = [
      ...jobExpenses,
      ...seedRows.map((r, i) => ({
        id: `seed-dc1-${i}`,
        date: r.date,
        jobId: drillProjectId,
        crewId: drillCrew!.id,
        vendor: r.vendor,
        location: r.vendor,
        description: r.description,
        amount: r.amount,
      })),
    ]
  }

  // One-time seed: week of 06/20/2026 + 06/24/2026 expenses for Drill Crew 1
  const alreadySeeded2 = (raw.jobExpenses ?? []).some(
    (e) => e.vendor === 'Kent Kwik Stop' && e.amount === 160.11,
  )
  if (!alreadySeeded2) {
    const drillProjectId =
      drillCrew.currentProjectId ??
      [...(raw.production ?? [])]
        .filter((e) => e.crewId === drillCrew!.id)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.projectId ??
      (raw.projects ?? [])[0]?.id ??
      ''
    const seedRows2 = [
      { date: '2026-06-20', vendor: 'Kent Kwik Stop',     location: 'Kent Kwik Stop, Ardmore',               description: 'Diesel - 30.4 gal',                               amount: 160.11 },
      { date: '2026-06-22', vendor: 'Coldwater Chevron',  location: 'Coldwater Chevron, Anniston AL',         description: 'Fuel - Diesel prepaid',                           amount: 100.41 },
      { date: '2026-06-22', vendor: 'C&G Market',         location: 'C&G Market, Oak Ridge TN',               description: 'Fuel - Prepaid',                                  amount: 160.00 },
      { date: '2026-06-22', vendor: 'Med Center Chevron', location: 'Med Center Chevron, Birmingham AL',       description: 'Diesel - Prepaid',                                amount: 160.00 },
      { date: '2026-06-22', vendor: 'Home Depot',         location: 'Home Depot, Oak Ridge',                   description: 'Safety glasses + tinted (PPE)',                   amount:  31.76 },
      { date: '2026-06-24', vendor: 'Vermeer Heartland',  location: 'Vermeer Heartland, Knoxville TN',         description: 'HY-Power 68 HYD Chemical (2x) - Drill parts',    amount: 335.72 },
    ]
    jobExpenses = [
      ...jobExpenses,
      ...seedRows2.map((r, i) => ({
        id: `seed-dc2-${i}`,
        date: r.date,
        jobId: drillProjectId,
        crewId: drillCrew!.id,
        vendor: r.vendor,
        location: r.location,
        description: r.description,
        amount: r.amount,
      })),
    ]
  }

  return {
    ...raw,
    crews,
    employees,
    pnl,
    clients: raw.clients ?? [],
    rateCards: raw.rateCards ?? [],
    rateCardUnits: raw.rateCardUnits ?? [],
    productionLineItems: raw.productionLineItems ?? [],
    timecards: raw.timecards ?? [],
    jobExpenses,
    equipment: raw.equipment ?? [],
  }
}

function loadData(): AppData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return migrateData(JSON.parse(stored) as AppData)
  } catch {
    // corrupt storage — fall through to a fresh seed
  }
  return generateSeedData()
}

/** Minimal id generator — fine for a single-user local prototype. */
let counter = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`

export type LineItemInput = Omit<ProductionLineItem, 'id' | 'productionEntryId'>

interface DataContextValue {
  data: AppData
  // Projects
  addProject: (p: Omit<Project, 'id'>) => Project
  updateProject: (id: string, patch: Partial<Project>) => void
  deleteProject: (id: string) => void
  // Crews
  addCrew: (c: Omit<Crew, 'id'>) => Crew
  updateCrew: (id: string, patch: Partial<Crew>) => void
  deleteCrew: (id: string) => void
  // Production (also rolls up footage + a P&L line)
  addProduction: (e: Omit<ProductionEntry, 'id'>, lineItems?: LineItemInput[]) => void
  deleteProduction: (id: string) => void
  // Materials
  addMaterial: (m: Omit<Material, 'id'>) => void
  updateMaterial: (id: string, patch: Partial<Material>) => void
  deleteMaterial: (id: string) => void
  // Photos
  addPhoto: (p: Omit<Photo, 'id'>) => void
  deletePhoto: (id: string) => void
  // Invoices
  addInvoice: (i: Omit<Invoice, 'id'>) => void
  updateInvoice: (id: string, patch: Partial<Invoice>) => void
  deleteInvoice: (id: string) => void
  // Clients
  addClient: (c: Omit<Client, 'id'>) => Client
  updateClient: (id: string, patch: Partial<Client>) => void
  deleteClient: (id: string) => void
  // Rate cards
  addRateCard: (rc: Omit<RateCard, 'id'>) => RateCard
  updateRateCard: (id: string, patch: Partial<RateCard>) => void
  deleteRateCard: (id: string) => void
  // Rate card units
  addRateCardUnit: (u: Omit<RateCardUnit, 'id'>) => RateCardUnit
  updateRateCardUnit: (id: string, patch: Partial<RateCardUnit>) => void
  deleteRateCardUnit: (id: string) => void
  // Employees
  addEmployee: (e: Omit<Employee, 'id'>) => Employee
  updateEmployee: (id: string, patch: Partial<Employee>) => void
  deleteEmployee: (id: string) => void
  // Timecards
  addTimecard: (t: Omit<Timecard, 'id'>) => void
  deleteTimecard: (id: string) => void
  // Crew day entry — creates a ProductionEntry + Timecards for each employee in one shot
  addCrewDayEntry: (params: {
    date: string
    projectId: string
    crewId: string
    footage: number
    notes?: string
    employees: { employeeId: string; hours: number }[]
    equipmentIds?: string[]
  }) => void
  deleteCrewDayEntry: (productionEntryId: string) => void
  // Job expenses
  addJobExpense: (e: Omit<JobExpense, 'id'>) => void
  deleteJobExpense: (id: string) => void
  // Equipment
  addEquipment: (e: Omit<Equipment, 'id'>) => Equipment
  updateEquipment: (id: string, patch: Partial<Equipment>) => void
  deleteEquipment: (id: string) => void
  // Misc
  resetData: () => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(loadData)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // storage full / unavailable — non-fatal for a prototype
    }
  }, [data])

  const value = useMemo<DataContextValue>(() => {
    const recomputeFootage = (projects: Project[], production: ProductionEntry[]) =>
      projects.map((p) => {
        if (p.status === 'complete') return p
        const total = production
          .filter((e) => e.projectId === p.id)
          .reduce((sum, e) => sum + e.footage, 0)
        return { ...p, footageComplete: Math.min(p.footageGoal, total) }
      })

    return {
      data,

      addProject(p) {
        const project: Project = { ...p, id: newId('proj') }
        setData((d) => ({ ...d, projects: [...d.projects, project] }))
        return project
      },
      updateProject(id, patch) {
        setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
      },
      deleteProject(id) {
        setData((d) => ({
          ...d,
          projects: d.projects.filter((p) => p.id !== id),
          production: d.production.filter((e) => e.projectId !== id),
          pnl: d.pnl.filter((e) => e.projectId !== id),
          timecards: d.timecards.filter((t) => t.jobId !== id),
          jobExpenses: d.jobExpenses.filter((e) => e.jobId !== id),
          crews: d.crews.map((c) => (c.currentProjectId === id ? { ...c, currentProjectId: null, status: 'idle' } : c)),
        }))
      },

      addCrew(c) {
        const crew: Crew = { ...c, id: newId('crew') }
        setData((d) => ({ ...d, crews: [...d.crews, crew] }))
        return crew
      },
      updateCrew(id, patch) {
        setData((d) => ({ ...d, crews: d.crews.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
      },
      deleteCrew(id) {
        setData((d) => ({ ...d, crews: d.crews.filter((c) => c.id !== id) }))
      },

      addProduction(e, lineItems) {
        const entry: ProductionEntry = { ...e, id: newId('prod') }
        setData((d) => {
          const crew = d.crews.find((c) => c.id === entry.crewId)
          const project = d.projects.find((p) => p.id === entry.projectId)
          const production = [...d.production, entry]

          // If line items provided, revenue = sum of extended totals; else use footage * rate
          const hasLineItems = lineItems && lineItems.length > 0
          const revenueFromItems = hasLineItems
            ? lineItems.reduce((s, li) => s + li.extendedTotal, 0)
            : null

          const laborCost = crewLaborCost(crew, entry.hours, entry.footage).total
          const revenue = revenueFromItems ?? (project ? entry.footage * revenuePerFoot(project) : entry.footage * 12)

          // Sum daily cost of all active equipment assigned to this crew (monthly / 21 working days)
          const equipmentCost = Math.round(
            d.equipment
              .filter((eq) => eq.active && eq.crewId === entry.crewId)
              .reduce((s, eq) => s + eq.monthlyCost / 21, 0)
          )

          const pnlLine: PnLEntry = {
            id: newId('pnl'),
            date: entry.date,
            projectId: entry.projectId,
            revenue: Math.round(revenue),
            laborCost,
            materialCost: 0,
            equipmentCost,
            otherCost: 0,
            productionEntryId: entry.id,
          }

          const newLineItems: ProductionLineItem[] = hasLineItems
            ? lineItems.map((li) => ({ ...li, id: newId('pli'), productionEntryId: entry.id }))
            : []

          return {
            ...d,
            production,
            pnl: [...d.pnl, pnlLine],
            productionLineItems: [...d.productionLineItems, ...newLineItems],
            projects: recomputeFootage(d.projects, production),
          }
        })
      },
      deleteProduction(id) {
        setData((d) => {
          const entry = d.production.find((e) => e.id === id)
          const production = d.production.filter((e) => e.id !== id)
          const pnl = d.pnl.filter((e) => {
            if (e.productionEntryId) return e.productionEntryId !== id
            // Legacy entries have no productionEntryId — match by date + project
            return !(entry && e.date === entry.date && e.projectId === entry.projectId)
          })
          return {
            ...d,
            production,
            pnl,
            productionLineItems: d.productionLineItems.filter((li) => li.productionEntryId !== id),
            projects: recomputeFootage(d.projects, production),
          }
        })
      },

      addMaterial(m) {
        setData((d) => ({ ...d, materials: [...d.materials, { ...m, id: newId('mat') }] }))
      },
      updateMaterial(id, patch) {
        setData((d) => ({ ...d, materials: d.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
      },
      deleteMaterial(id) {
        setData((d) => ({ ...d, materials: d.materials.filter((m) => m.id !== id) }))
      },

      addPhoto(p) {
        setData((d) => ({ ...d, photos: [{ ...p, id: newId('photo') }, ...d.photos] }))
      },
      deletePhoto(id) {
        setData((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }))
      },

      addInvoice(i) {
        setData((d) => ({ ...d, invoices: [{ ...i, id: newId('inv') }, ...d.invoices] }))
      },
      updateInvoice(id, patch) {
        setData((d) => ({ ...d, invoices: d.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
      },
      deleteInvoice(id) {
        setData((d) => ({ ...d, invoices: d.invoices.filter((i) => i.id !== id) }))
      },

      // --- Clients ---
      addClient(c) {
        const client: Client = { ...c, id: newId('cli') }
        setData((d) => ({ ...d, clients: [...d.clients, client] }))
        return client
      },
      updateClient(id, patch) {
        setData((d) => ({ ...d, clients: d.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
      },
      deleteClient(id) {
        setData((d) => ({ ...d, clients: d.clients.filter((c) => c.id !== id) }))
      },

      // --- Rate cards ---
      addRateCard(rc) {
        const card: RateCard = { ...rc, id: newId('rc') }
        setData((d) => ({ ...d, rateCards: [...d.rateCards, card] }))
        return card
      },
      updateRateCard(id, patch) {
        setData((d) => ({ ...d, rateCards: d.rateCards.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
      },
      deleteRateCard(id) {
        setData((d) => ({
          ...d,
          rateCards: d.rateCards.filter((r) => r.id !== id),
          rateCardUnits: d.rateCardUnits.filter((u) => u.rateCardId !== id),
        }))
      },

      // --- Rate card units ---
      addRateCardUnit(u) {
        const unit: RateCardUnit = { ...u, id: newId('rcu') }
        setData((d) => ({ ...d, rateCardUnits: [...d.rateCardUnits, unit] }))
        return unit
      },
      updateRateCardUnit(id, patch) {
        setData((d) => ({ ...d, rateCardUnits: d.rateCardUnits.map((u) => (u.id === id ? { ...u, ...patch } : u)) }))
      },
      deleteRateCardUnit(id) {
        setData((d) => ({ ...d, rateCardUnits: d.rateCardUnits.filter((u) => u.id !== id) }))
      },

      // --- Employees ---
      addEmployee(e) {
        const emp: Employee = { ...e, id: newId('emp') }
        setData((d) => ({ ...d, employees: [...d.employees, emp] }))
        return emp
      },
      updateEmployee(id, patch) {
        setData((d) => ({ ...d, employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
      },
      deleteEmployee(id) {
        setData((d) => ({ ...d, employees: d.employees.filter((e) => e.id !== id) }))
      },

      // --- Timecards ---
      addTimecard(t) {
        setData((d) => ({ ...d, timecards: [...d.timecards, { ...t, id: newId('tc') }] }))
      },
      deleteTimecard(id) {
        setData((d) => ({ ...d, timecards: d.timecards.filter((t) => t.id !== id) }))
      },

      // --- Crew day entry ---
      addCrewDayEntry({ date, projectId, crewId, footage, notes, employees: empEntries, equipmentIds }) {
        setData((d) => {
          const totalHours = empEntries.reduce((s, e) => s + e.hours, 0)
          const entry: ProductionEntry = {
            id: newId('prod'),
            date,
            projectId,
            crewId,
            footage,
            hours: totalHours,
            notes,
            equipmentIds,
          }
          const production = [...d.production, entry]

          const totalLaborCost = empEntries.reduce((s, e) => {
            const emp = d.employees.find((em) => em.id === e.employeeId)
            return s + (emp ? Math.round(e.hours * emp.hourlyRate * 100) / 100 : 0)
          }, 0)

          const project = d.projects.find((p) => p.id === projectId)
          const revenue = project ? footage * revenuePerFoot(project) : footage * 12

          const equipmentCost = Math.round(
            d.equipment
              .filter((eq) => eq.active && eq.crewId === crewId)
              .reduce((s, eq) => s + eq.monthlyCost / 21, 0)
          )

          const pnlLine: PnLEntry = {
            id: newId('pnl'),
            date,
            projectId,
            revenue: Math.round(revenue),
            laborCost: Math.round(totalLaborCost),
            materialCost: 0,
            equipmentCost,
            otherCost: 0,
            productionEntryId: entry.id,
          }

          const timecards: Timecard[] = empEntries.map((e) => {
            const emp = d.employees.find((em) => em.id === e.employeeId)
            const rate = emp?.hourlyRate ?? 0
            const laborCost = Math.round(e.hours * rate * 100) / 100
            const startMins = 7 * 60
            const endMins = startMins + Math.round(e.hours * 60)
            const clockIn = '07:00'
            const clockOut = `${String(Math.floor(endMins / 60) % 24).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`
            return {
              id: newId('tc'),
              employeeId: e.employeeId,
              date,
              jobId: projectId,
              clockIn,
              clockOut,
              hours: e.hours,
              rateSnapshot: rate,
              laborCost,
              productionEntryId: entry.id,
            }
          })

          return {
            ...d,
            production,
            pnl: [...d.pnl, pnlLine],
            timecards: [...d.timecards, ...timecards],
            projects: recomputeFootage(d.projects, production),
          }
        })
      },
      deleteCrewDayEntry(productionEntryId) {
        setData((d) => {
          const production = d.production.filter((e) => e.id !== productionEntryId)
          return {
            ...d,
            production,
            pnl: d.pnl.filter((e) => e.productionEntryId !== productionEntryId),
            productionLineItems: d.productionLineItems.filter((li) => li.productionEntryId !== productionEntryId),
            timecards: d.timecards.filter((t) => t.productionEntryId !== productionEntryId),
            projects: recomputeFootage(d.projects, production),
          }
        })
      },

      // --- Job expenses ---
      addJobExpense(e) {
        setData((d) => ({ ...d, jobExpenses: [...d.jobExpenses, { ...e, id: newId('exp') }] }))
      },
      deleteJobExpense(id) {
        setData((d) => ({ ...d, jobExpenses: d.jobExpenses.filter((e) => e.id !== id) }))
      },

      // --- Equipment ---
      addEquipment(e) {
        const eq: Equipment = { ...e, id: newId('eq') }
        setData((d) => ({ ...d, equipment: [...d.equipment, eq] }))
        return eq
      },
      updateEquipment(id, patch) {
        setData((d) => ({ ...d, equipment: d.equipment.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
      },
      deleteEquipment(id) {
        setData((d) => ({ ...d, equipment: d.equipment.filter((e) => e.id !== id) }))
      },

      resetData() {
        setData(generateSeedData())
      },
    }
  }, [data])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a DataProvider')
  return ctx
}
