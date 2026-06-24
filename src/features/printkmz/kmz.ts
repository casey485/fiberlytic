import JSZip from 'jszip'
import type { DetectedObject, PrintSession } from './types'
import { objectMeta, methodLabel, OBJECT_TYPES } from './types'

const esc = (s: string | number | undefined) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** KML color is aabbggrr; input is #rrggbb. */
function hexToKmlColor(hex: string, alpha = 'ff') {
  return `${alpha}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`
}

function extendedData(o: DetectedObject) {
  const fields: [string, string | number | undefined][] = [
    ['type', objectMeta(o.type).label],
    ['status', o.status],
    ['feeder', o.feeder],
    ['section', o.section],
    ['fiberCount', o.fiberCount],
    ['footage', o.footage],
    ['spanLength', o.spanLength],
    ['constructionMethod', methodLabel(o.constructionMethod)],
    ['roadName', o.roadName],
    ['sheet', o.sheet],
    ['productionQuantity', o.productionQuantity],
    ['billingQuantity', o.billingQuantity],
    ['crewAssignment', o.crewAssignment],
    ['photos', o.photos.length],
    ['redlines', o.redlines.length],
    ['notes', o.notes],
  ]
  const data = fields
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `          <Data name="${esc(k)}"><value>${esc(v)}</value></Data>`)
    .join('\n')
  return `        <ExtendedData>\n${data}\n        </ExtendedData>`
}

function placemark(o: DetectedObject, indent: string) {
  const meta = objectMeta(o.type)
  const geometry =
    meta.linear && o.path && o.path.length >= 2
      ? `        <LineString><tessellate>1</tessellate><coordinates>${o.path
          .map((p) => `${p.lng},${p.lat},0`)
          .join(' ')}</coordinates></LineString>`
      : `        <Point><coordinates>${o.position.lng},${o.position.lat},0</coordinates></Point>`
  const desc = [o.roadName, o.feeder && `Feeder ${o.feeder}`, o.section && `Section ${o.section}`, o.notes]
    .filter(Boolean)
    .join(' — ')
  return `${indent}<Placemark>
        <name>${esc(o.label)}</name>
        <description>${esc(desc)}</description>
        <styleUrl>#${o.type}</styleUrl>
${extendedData(o)}
${geometry}
${indent}</Placemark>`
}

function styles() {
  return OBJECT_TYPES.map((t) => {
    const color = hexToKmlColor(t.color)
    return `    <Style id="${t.type}">
      <IconStyle><color>${color}</color><scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
      <LineStyle><color>${color}</color><width>4</width></LineStyle>
    </Style>`
  }).join('\n')
}

/** Group helper: Map preserving insertion order, bucketing by a key fn. */
function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    const arr = m.get(k) ?? []
    arr.push(it)
    m.set(k, arr)
  }
  return m
}

/**
 * Build KML with nested folders:
 *   Document(Project) → Folder(Feeder) → Folder(Section) → Folder(Type) → Placemarks
 */
export function buildKml(session: PrintSession): string {
  const projectName =
    session.extraction.cover.projectName ||
    session.fileName.replace(/\.pdf$/i, '') ||
    'Fiberlytic Export'

  const byFeeder = groupBy(session.objects, (o) => o.feeder || 'Unassigned Feeder')

  const feederFolders = [...byFeeder.entries()]
    .map(([feeder, fObjs]) => {
      const bySection = groupBy(fObjs, (o) => o.section || 'Unassigned Section')
      const sectionFolders = [...bySection.entries()]
        .map(([section, sObjs]) => {
          const byType = groupBy(sObjs, (o) => o.type)
          const typeFolders = [...byType.entries()]
            .map(([type, tObjs]) => {
              const label = objectMeta(type as DetectedObject['type']).label
              const placemarks = tObjs.map((o) => placemark(o, '          ')).join('\n')
              return `        <Folder>
          <name>${esc(label)} (${tObjs.length})</name>
${placemarks}
        </Folder>`
            })
            .join('\n')
          return `      <Folder>
        <name>Section ${esc(section)}</name>
${typeFolders}
      </Folder>`
        })
        .join('\n')
      return `    <Folder>
      <name>Feeder ${esc(feeder)}</name>
${sectionFolders}
    </Folder>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(projectName)}</name>
    <description>Exported from Fiberlytic — ${session.objects.length} objects across ${byFeeder.size} feeder(s)</description>
${styles()}
${feederFolders}
  </Document>
</kml>`
}

/** Build a .kmz (zipped doc.kml) and trigger a browser download. */
export async function exportKmz(session: PrintSession): Promise<void> {
  const kml = buildKml(session)
  const zip = new JSZip()
  zip.file('doc.kml', kml)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })

  const base = (
    session.extraction.cover.projectName ||
    session.fileName.replace(/\.pdf$/i, '') ||
    'fiberlytic'
  )
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${base || 'fiberlytic'}.kmz`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
