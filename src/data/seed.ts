import type {
  AppData,
  Client,
  Crew,
  CrewMember,
  Employee,
  Material,
  Photo,
  Project,
  ProductionEntry,
  PnLEntry,
  PayType,
  RateCard,
  RateCardUnit,
  Invoice,
} from '../types'
import { crewLaborCost } from '../lib/laborCost'

// ---------------------------------------------------------------------------
// Seed data
//
// This builds a believable ~6-week snapshot of a fiber contractor's operations.
// Production and P&L are generated relative to "today" so the dashboard always
// shows recent activity. It runs once on first load, then is persisted to
// localStorage and never regenerated (see store/DataContext).
// ---------------------------------------------------------------------------

const isoDate = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDate(d)
}

const daysFromNow = (n: number) => daysAgo(-n)

const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min))

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// --- Static entities ---------------------------------------------------------

const member = (id: string, name: string, role: string, payType: PayType, payAmount: number): CrewMember => ({
  id,
  name,
  role,
  payType,
  payAmount,
  active: true,
})

const crews: Crew[] = [
  {
    id: 'crew-alpha', name: 'Alpha Aerial', foreman: 'Marcus Bell', specialty: 'aerial', status: 'active',
    currentProjectId: 'proj-maple', payType: 'daily', payAmount: 4200,
    members: [
      member('m-a1', 'Marcus Bell', 'Foreman', 'daily', 380),
      member('m-a2', 'Joe Park', 'Lineman', 'hourly', 36),
      member('m-a3', 'Rich Lee', 'Lineman', 'hourly', 34),
      member('m-a4', 'Tony Sims', 'Groundman', 'hourly', 24),
      member('m-a5', 'Pedro Diaz', 'Bucket Operator', 'daily', 300),
    ],
  },
  {
    id: 'crew-bravo', name: 'Bravo Underground', foreman: 'Diego Ramos', specialty: 'underground', status: 'active',
    currentProjectId: 'proj-downtown', payType: 'daily', payAmount: 5200,
    members: [
      member('m-b1', 'Diego Ramos', 'Foreman', 'daily', 400),
      member('m-b2', 'Karl Webb', 'Operator', 'hourly', 42),
      member('m-b3', 'Luis Mora', 'Laborer', 'hourly', 26),
      member('m-b4', 'Sean Doyle', 'Laborer', 'hourly', 26),
      member('m-b5', 'Owen Frost', 'Locator', 'daily', 280),
      member('m-b6', 'Hank Reyes', 'Restoration', 'hourly', 28),
    ],
  },
  {
    id: 'crew-charlie', name: 'Charlie Bore', foreman: 'Will Tran', specialty: 'directional_bore', status: 'active',
    currentProjectId: 'proj-cedar', payType: 'daily', payAmount: 6100,
    members: [
      member('m-c1', 'Will Tran', 'Foreman', 'daily', 420),
      member('m-c2', 'Brett Cole', 'Bore Operator', 'daily', 520),
      member('m-c3', 'Nate Imo', 'Locator', 'hourly', 32),
      member('m-c4', 'Cody Ash', 'Laborer', 'hourly', 25),
    ],
  },
  {
    id: 'crew-splice', name: 'Splice Team 1', foreman: 'Anita Cole', specialty: 'splicing', status: 'active',
    currentProjectId: 'proj-westside', payType: 'production', payAmount: 0.08,
    members: [
      member('m-s1', 'Anita Cole', 'Lead Splicer', 'production', 0.06),
      member('m-s2', 'Ravi Shah', 'Splicer', 'production', 0.05),
      member('m-s3', 'Mia Lund', 'Helper', 'hourly', 24),
    ],
  },
  {
    id: 'crew-delta', name: 'Delta MDU', foreman: 'Sam Okafor', specialty: 'mdu', status: 'idle',
    currentProjectId: null, payType: 'daily', payAmount: 3600,
    members: [
      member('m-d1', 'Sam Okafor', 'Foreman', 'daily', 360),
      member('m-d2', 'Gus Park', 'Installer', 'hourly', 30),
      member('m-d3', 'Ivy Cho', 'Installer', 'hourly', 30),
      member('m-d4', 'Otis Brant', 'Helper', 'hourly', 22),
    ],
  },
]

// --- Clients -----------------------------------------------------------------

const clients: Client[] = [
  { id: 'client-essentia', name: 'Essentia' },
]

// --- Projects ----------------------------------------------------------------

const projects: Project[] = [
  {
    id: 'proj-maple', name: 'Maple Grove FTTH Phase 2', client: 'Maple Grove Utilities', location: 'Maple Grove, MN',
    status: 'active', workTypes: ['aerial'], startDate: daysAgo(40), dueDate: daysFromNow(55),
    contractValue: 612000, budget: 430000, footageGoal: 48000, footageComplete: 0,
    crewIds: ['crew-alpha'], notes: 'Pole make-ready coordinated with city; 2 strand attach permits pending.',
  },
  {
    id: 'proj-downtown', name: 'Downtown Conduit Backbone', client: 'Metro Broadband', location: 'Cedar Rapids, IA',
    status: 'active', workTypes: ['underground'], startDate: daysAgo(30), dueDate: daysFromNow(70),
    contractValue: 845000, budget: 640000, footageGoal: 22000, footageComplete: 0,
    crewIds: ['crew-bravo'], notes: 'Heavy rock zone near 3rd Ave slowing trench rate.',
  },
  {
    id: 'proj-cedar', name: 'Cedar Falls Aerial Expansion', client: 'Cedar Falls Telecom', location: 'Cedar Falls, IA',
    status: 'active', workTypes: ['directional_bore'], startDate: daysAgo(22), dueDate: daysFromNow(90),
    contractValue: 980000, budget: 760000, footageGoal: 65000, footageComplete: 0,
    crewIds: ['crew-charlie'], notes: '',
  },
  {
    id: 'proj-westside', name: 'Westside Splice & Test', client: 'Metro Broadband', location: 'Cedar Rapids, IA',
    status: 'active', workTypes: ['splicing'], startDate: daysAgo(15), dueDate: daysFromNow(20),
    contractValue: 268000, budget: 195000, footageGoal: 30000, footageComplete: 0,
    crewIds: ['crew-splice'], notes: 'OTDR test reports due to client weekly.',
  },
  {
    // Essentia project — linked to rate card system
    id: 'proj-essentia', name: 'Essentia Underground Phase 1', client: 'Essentia', clientId: 'client-essentia',
    location: 'Brainerd, MN',
    status: 'active', workTypes: ['underground'], startDate: daysAgo(14), dueDate: daysFromNow(60),
    contractValue: 185000, budget: 140000, footageGoal: 15000, footageComplete: 0,
    crewIds: [], retentionPct: 0.10,
    notes: 'Rate card driven. Use Production → Rate Card Lookup to log line items.',
  },
  {
    id: 'proj-riverside', name: 'Riverside MDU Buildout', client: 'Riverside Housing Authority', location: 'Davenport, IA',
    status: 'planning', workTypes: ['mdu'], startDate: daysFromNow(10), dueDate: daysFromNow(120),
    contractValue: 412000, budget: 310000, footageGoal: 18000, footageComplete: 0,
    crewIds: [], notes: 'Awaiting riser access agreements from property manager.',
  },
  {
    id: 'proj-hillcrest', name: 'Hillcrest Directional Bore', client: 'Hillcrest Fiber Co-op', location: 'Dubuque, IA',
    status: 'complete', workTypes: ['directional_bore'], startDate: daysAgo(120), dueDate: daysAgo(20),
    contractValue: 224000, budget: 168000, footageGoal: 12000, footageComplete: 12000,
    crewIds: [], notes: 'Closed out. Final as-builts delivered.',
  },
]

// --- Rate Cards — Essentia Underground ---------------------------------------

const rateCards: RateCard[] = [
  {
    id: 'rc-essentia-ug',
    clientId: 'client-essentia',
    divisions: ['Underground'],
    name: 'Essentia Underground 2025',
    effectiveDate: '2025-01-01',
  },
]

const rateCardUnits: RateCardUnit[] = [
  { id: 'rcu-1',  rateCardId: 'rc-essentia-ug', unitCode: '1U4-1',  description: 'Place (1) 1.25" HDPE Duct',              uom: 'LF',   rate: 5.75  },
  { id: 'rcu-2',  rateCardId: 'rc-essentia-ug', unitCode: '1U4-2',  description: 'Place (2) 1.25" HDPE Ducts',             uom: 'LF',   rate: 6.00  },
  { id: 'rcu-3',  rateCardId: 'rc-essentia-ug', unitCode: '1U4-3',  description: 'Place (3) 1.25" HDPE Ducts',             uom: 'LF',   rate: 6.25  },
  { id: 'rcu-4',  rateCardId: 'rc-essentia-ug', unitCode: '2U-1',   description: 'Place (1) Fiber in Duct',                uom: 'LF',   rate: 0.60  },
  { id: 'rcu-5',  rateCardId: 'rc-essentia-ug', unitCode: '2U-2',   description: 'Place (2) Fibers in Duct',               uom: 'LF',   rate: 1.20  },
  { id: 'rcu-6',  rateCardId: 'rc-essentia-ug', unitCode: '2U-3',   description: 'Place (3) Fibers in Duct',               uom: 'LF',   rate: 1.80  },
  { id: 'rcu-7',  rateCardId: 'rc-essentia-ug', unitCode: '3U',     description: 'Install up to 24" Vault',               uom: 'EA',   rate: 120.00 },
  { id: 'rcu-8',  rateCardId: 'rc-essentia-ug', unitCode: '4U',     description: 'Install up to 36" Vault',               uom: 'EA',   rate: 165.00 },
  { id: 'rcu-9',  rateCardId: 'rc-essentia-ug', unitCode: '5U',     description: 'Install up to 48" Vault',               uom: 'EA',   rate: 325.00 },
  { id: 'rcu-10', rateCardId: 'rc-essentia-ug', unitCode: '6U',     description: 'Install Ped 11"x11" Flower Pot',        uom: 'EA',   rate: 30.00  },
  { id: 'rcu-11', rateCardId: 'rc-essentia-ug', unitCode: '8U',     description: 'Underground Cobble/Railhead Rock Adder', uom: 'LF',   rate: 11.50  },
  { id: 'rcu-12', rateCardId: 'rc-essentia-ug', unitCode: '10U',    description: 'Sidewalk/Asphalt Cut & Restoration',    uom: 'SQFT', rate: 20.00  },
  { id: 'rcu-13', rateCardId: 'rc-essentia-ug', unitCode: '3U-R',   description: 'Install up to 24" Vault in Rock',       uom: 'EA',   rate: 250.00 },
  { id: 'rcu-14', rateCardId: 'rc-essentia-ug', unitCode: '4U-R',   description: 'Install up to 36" Vault in Rock',       uom: 'EA',   rate: 350.00 },
  { id: 'rcu-15', rateCardId: 'rc-essentia-ug', unitCode: '5U-R',   description: 'Install up to 48" Vault in Rock',       uom: 'EA',   rate: 675.00 },
  { id: 'rcu-16', rateCardId: 'rc-essentia-ug', unitCode: '8U-SR',  description: 'Underground (Solid) Rock Adder',        uom: 'EA',   rate: 65.00  },
]

// --- Employees ---------------------------------------------------------------

const employees: Employee[] = [
  { id: 'emp-1', name: 'Christian Smith', role: 'Driller',  hourlyRate: 35.00, defaultCrewId: null, active: true },
  { id: 'emp-2', name: 'Chandon Seese',   role: 'Locator',  hourlyRate: 28.00, defaultCrewId: null, active: true },
  { id: 'emp-3', name: 'Skyler Tyler',    role: 'Labor',    hourlyRate: 22.00, defaultCrewId: null, active: true },
  { id: 'emp-4', name: 'Elijah Freels',   role: 'Labor',    hourlyRate: 28.00, defaultCrewId: null, active: true },
  { id: 'emp-5', name: 'Wesley Clark',    role: 'Locator',  hourlyRate: 28.00, defaultCrewId: null, active: true },
  { id: 'emp-6', name: 'Peyton McCarter', role: 'Laborer',  hourlyRate: 22.00, defaultCrewId: null, active: true },
]

// --- Materials ---------------------------------------------------------------

const materials: Material[] = [
  { id: 'mat-cable144', name: '144ct Single-Mode Fiber', sku: 'SM-144-LT', category: 'cable', unit: 'ft', quantityOnHand: 38000, reorderLevel: 20000, unitCost: 1.45, supplier: 'Corning' },
  { id: 'mat-cable96', name: '96ct Single-Mode Fiber', sku: 'SM-096-LT', category: 'cable', unit: 'ft', quantityOnHand: 12500, reorderLevel: 15000, unitCost: 1.05, supplier: 'Corning' },
  { id: 'mat-cable48', name: '48ct Single-Mode Fiber', sku: 'SM-048-LT', category: 'cable', unit: 'ft', quantityOnHand: 26000, reorderLevel: 12000, unitCost: 0.72, supplier: 'Prysmian' },
  { id: 'mat-conduit', name: 'HDPE Conduit 1.25"', sku: 'HDPE-125', category: 'conduit', unit: 'ft', quantityOnHand: 9000, reorderLevel: 10000, unitCost: 0.58, supplier: 'Dura-Line' },
  { id: 'mat-handhole', name: 'Composite Handhole 24x36', sku: 'HH-2436', category: 'hardware', unit: 'ea', quantityOnHand: 42, reorderLevel: 25, unitCost: 185, supplier: 'Oldcastle' },
  { id: 'mat-pedestal', name: 'Fiber Pedestal', sku: 'PED-STD', category: 'hardware', unit: 'ea', quantityOnHand: 18, reorderLevel: 20, unitCost: 96, supplier: 'Charles Industries' },
  { id: 'mat-closure', name: 'Splice Closure 48-port', sku: 'CLO-48', category: 'splice', unit: 'ea', quantityOnHand: 64, reorderLevel: 30, unitCost: 142, supplier: 'CommScope' },
  { id: 'mat-sleeves', name: 'Splice Sleeves (pk/100)', sku: 'SLV-100', category: 'splice', unit: 'pk', quantityOnHand: 22, reorderLevel: 15, unitCost: 18, supplier: 'AFL' },
  { id: 'mat-drop', name: 'Flat Drop Cable 1F', sku: 'DRP-1F', category: 'drop', unit: 'ft', quantityOnHand: 54000, reorderLevel: 30000, unitCost: 0.21, supplier: 'Prysmian' },
  { id: 'mat-locate', name: 'Tracer Wire 12AWG', sku: 'TRW-12', category: 'consumable', unit: 'ft', quantityOnHand: 7000, reorderLevel: 8000, unitCost: 0.09, supplier: 'Copperhead' },
]

// Per-project economics used to synthesize production + P&L.
const projectEconomics: Record<string, { revPerFt: number; dailyFootage: [number, number]; matPerFt: number; equipPerDay: number }> = {
  'proj-maple': { revPerFt: 12.75, dailyFootage: [900, 1500], matPerFt: 3.1, equipPerDay: 650 },
  'proj-downtown': { revPerFt: 38.4, dailyFootage: [300, 620], matPerFt: 9.8, equipPerDay: 1850 },
  'proj-cedar': { revPerFt: 15.1, dailyFootage: [1100, 1900], matPerFt: 3.6, equipPerDay: 1400 },
  'proj-westside': { revPerFt: 8.9, dailyFootage: [1200, 2200], matPerFt: 1.2, equipPerDay: 300 },
}

// --- Generate ~6 weeks of production + daily P&L -----------------------------

function generateActivity() {
  const production: ProductionEntry[] = []
  const pnl: PnLEntry[] = []
  const footageByProject: Record<string, number> = {}

  const activeAssignments = crews
    .filter((c) => c.currentProjectId)
    .map((c) => ({ crew: c, projectId: c.currentProjectId! }))

  let pid = 0
  let lid = 0

  for (let d = 41; d >= 0; d--) {
    const date = daysAgo(d)
    const dow = new Date(date + 'T00:00:00').getDay()
    if (dow === 0 || dow === 6) continue // skip weekends

    for (const { crew, projectId } of activeAssignments) {
      const econ = projectEconomics[projectId]
      if (!econ) continue
      // Project hasn't started yet on this date?
      const proj = projects.find((p) => p.id === projectId)!
      if (date < proj.startDate) continue

      // Occasional down day (weather, breakdown).
      if (Math.random() < 0.12) continue

      const footage = rand(econ.dailyFootage[0], econ.dailyFootage[1])
      const hours = pick([8, 8, 9, 10])
      production.push({
        id: `prod-${pid++}`,
        date,
        projectId,
        crewId: crew.id,
        footage,
        hours,
        notes: Math.random() < 0.15 ? pick(['Rock encountered', 'Rain delay AM', 'Permit hold cleared', 'Extra restoration']) : undefined,
      })
      footageByProject[projectId] = (footageByProject[projectId] || 0) + footage

      const revenue = footage * econ.revPerFt
      const laborCost = crewLaborCost(crew, hours, footage).total
      const equipmentCost = econ.equipPerDay
      const otherCost = rand(80, 320)
      pnl.push({
        id: `pnl-${lid++}`,
        date,
        projectId,
        revenue: Math.round(revenue),
        laborCost: Math.round(laborCost),
        materialCost: 0,
        equipmentCost,
        otherCost,
      })
    }
  }

  return { production, pnl, footageByProject }
}

const photos: Photo[] = [
  { id: 'photo-1', projectId: 'proj-maple', caption: 'Strand attachment complete on Birch St', category: 'progress', date: daysAgo(3), uploadedBy: 'Marcus Bell', url: 'https://picsum.photos/seed/fiber1/640/420' },
  { id: 'photo-2', projectId: 'proj-maple', caption: 'Pre-construction pole survey', category: 'before', date: daysAgo(38), uploadedBy: 'Marcus Bell', url: 'https://picsum.photos/seed/fiber2/640/420' },
  { id: 'photo-3', projectId: 'proj-downtown', caption: 'Open trench 3rd Ave — rock layer', category: 'issue', date: daysAgo(6), uploadedBy: 'Diego Ramos', url: 'https://picsum.photos/seed/fiber3/640/420' },
  { id: 'photo-4', projectId: 'proj-downtown', caption: 'Handhole set and graded', category: 'progress', date: daysAgo(2), uploadedBy: 'Diego Ramos', url: 'https://picsum.photos/seed/fiber4/640/420' },
  { id: 'photo-5', projectId: 'proj-cedar', caption: 'Bore rig setup at staging', category: 'progress', date: daysAgo(5), uploadedBy: 'Will Tran', url: 'https://picsum.photos/seed/fiber5/640/420' },
  { id: 'photo-6', projectId: 'proj-westside', caption: 'Splice closure ready for OTDR', category: 'progress', date: daysAgo(1), uploadedBy: 'Anita Cole', url: 'https://picsum.photos/seed/fiber6/640/420' },
  { id: 'photo-7', projectId: 'proj-westside', caption: 'Proper PPE on splicing van', category: 'safety', date: daysAgo(4), uploadedBy: 'Anita Cole', url: 'https://picsum.photos/seed/fiber7/640/420' },
  { id: 'photo-8', projectId: 'proj-hillcrest', caption: 'Final restoration after bore', category: 'after', date: daysAgo(22), uploadedBy: 'Will Tran', url: 'https://picsum.photos/seed/fiber8/640/420' },
]

const invoices: Invoice[] = [
  {
    id: 'inv-1', number: 'INV-1042', projectId: 'proj-maple', client: 'Maple Grove Utilities',
    issueDate: daysAgo(20), dueDate: daysFromNow(10), status: 'sent',
    lineItems: [
      { id: 'li-1', description: 'Aerial fiber placement — 14,200 ft', quantity: 14200, unitPrice: 12.75 },
      { id: 'li-2', description: 'Pole make-ready coordination', quantity: 1, unitPrice: 8500 },
    ],
  },
  {
    id: 'inv-2', number: 'INV-1043', projectId: 'proj-downtown', client: 'Metro Broadband',
    issueDate: daysAgo(35), dueDate: daysAgo(5), status: 'overdue',
    lineItems: [
      { id: 'li-3', description: 'Directional bore + conduit — 5,400 ft', quantity: 5400, unitPrice: 38.4 },
    ],
  },
  {
    id: 'inv-3', number: 'INV-1039', projectId: 'proj-hillcrest', client: 'Hillcrest Fiber Co-op',
    issueDate: daysAgo(45), dueDate: daysAgo(15), status: 'paid',
    lineItems: [
      { id: 'li-4', description: 'Directional bore — 12,000 ft', quantity: 12000, unitPrice: 16.5 },
      { id: 'li-5', description: 'As-built documentation', quantity: 1, unitPrice: 4200 },
    ],
  },
  {
    id: 'inv-4', number: 'INV-1044', projectId: 'proj-westside', client: 'Metro Broadband',
    issueDate: daysAgo(8), dueDate: daysFromNow(22), status: 'sent',
    lineItems: [
      { id: 'li-6', description: 'Fiber splicing — 480 splices', quantity: 480, unitPrice: 38 },
      { id: 'li-7', description: 'OTDR testing & reports', quantity: 1, unitPrice: 6800 },
    ],
  },
  {
    id: 'inv-5', number: 'INV-1045', projectId: 'proj-cedar', client: 'Cedar Falls Telecom',
    issueDate: daysAgo(2), dueDate: daysFromNow(28), status: 'draft',
    lineItems: [
      { id: 'li-8', description: 'Directional bore — 18,600 ft', quantity: 18600, unitPrice: 15.1 },
    ],
  },
]

export function generateSeedData(): AppData {
  const { production, pnl, footageByProject } = generateActivity()

  // Sync each project's completed footage from generated production.
  const projectsSynced = projects.map((p) => ({
    ...p,
    footageComplete: p.status === 'complete' ? p.footageGoal : Math.min(p.footageGoal, footageByProject[p.id] || 0),
  }))

  return {
    projects: projectsSynced,
    crews,
    production,
    pnl,
    materials,
    photos,
    invoices,
    clients,
    rateCards,
    rateCardUnits,
    employees,
    productionLineItems: [],
    timecards: [],
    jobExpenses: [],
    equipment: [],
    projectFiles: [],
    annotations: [],
    clockEntries: [],
    kmzUploads: [],
    mapFeatures: [],
    featureProduction: [],
    fieldMarkups: [],
    markupPhotos: [],
    markupBilling: [],
    aerialLashFiberRuns: [],
    fieldMapOverlays: [],
    favoriteUnitCodes: [],
    markupVideos: [],
    markupInspections: [],
    markupAttachments: [],
    markupHistory: [],
  }
}
