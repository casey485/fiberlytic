import JSZip from 'jszip'
import { FEATURE_STATUS_META } from '../types'
import type { MapFeature, FeatureStatus, FieldMarkup } from '../types'
import { MARKUP_COLOR_CODES } from './constructionTools'

// CSS #RRGGBB → KML AABBGGRR
function cssToKmlColor(hex: string, alpha = 'ff'): string {
  const h = hex.replace('#', '').toLowerCase()
  if (h.length !== 6) return `${alpha}10b981`
  return `${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`
}

function coordsToKml(coords: number[][]): string {
  return coords.map((c) => `${c[0]},${c[1]},0`).join(' ')
}

function geometryToKml(geometry: GeoJSON.Geometry): string {
  switch (geometry.type) {
    case 'Point': {
      const c = geometry.coordinates as number[]
      return `<Point><coordinates>${c[0]},${c[1]},0</coordinates></Point>`
    }
    case 'LineString':
      return `<LineString><tessellate>1</tessellate><coordinates>${
        coordsToKml(geometry.coordinates as number[][])
      }</coordinates></LineString>`
    case 'Polygon': {
      const rings = geometry.coordinates as number[][][]
      const outer = `<outerBoundaryIs><LinearRing><coordinates>${coordsToKml(rings[0])}</coordinates></LinearRing></outerBoundaryIs>`
      const inner = rings.slice(1).map((r) =>
        `<innerBoundaryIs><LinearRing><coordinates>${coordsToKml(r)}</coordinates></LinearRing></innerBoundaryIs>`
      ).join('')
      return `<Polygon>${outer}${inner}</Polygon>`
    }
    case 'MultiLineString':
      return `<MultiGeometry>${
        (geometry.coordinates as number[][][]).map((c) =>
          `<LineString><tessellate>1</tessellate><coordinates>${coordsToKml(c)}</coordinates></LineString>`
        ).join('')
      }</MultiGeometry>`
    case 'MultiPoint':
      return `<MultiGeometry>${
        (geometry.coordinates as number[][]).map((c) =>
          `<Point><coordinates>${c[0]},${c[1]},0</coordinates></Point>`
        ).join('')
      }</MultiGeometry>`
    case 'MultiPolygon':
      return `<MultiGeometry>${
        (geometry.coordinates as number[][][][]).map((poly) =>
          `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsToKml(poly[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
        ).join('')
      }</MultiGeometry>`
    default:
      return ''
  }
}

function x(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function exportFeaturesToKmz(features: MapFeature[], projectName = 'Export'): Promise<Blob> {
  const statusStyles = (Object.keys(FEATURE_STATUS_META) as FeatureStatus[]).map((status) => {
    const { color } = FEATURE_STATUS_META[status]
    const line = cssToKmlColor(color)
    const fill = cssToKmlColor(color, '66')
    return `  <Style id="s-${status}">
    <LineStyle><color>${line}</color><width>3</width></LineStyle>
    <PolyStyle><color>${fill}</color></PolyStyle>
    <IconStyle><color>${line}</color><scale>0.9</scale>
      <Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
    </IconStyle>
  </Style>`
  }).join('\n')

  // Group by layer → Folder
  const byLayer = new Map<string, MapFeature[]>()
  for (const f of features) {
    if (!byLayer.has(f.layerName)) byLayer.set(f.layerName, [])
    byLayer.get(f.layerName)!.push(f)
  }

  const folders = [...byLayer.entries()].map(([layerName, fs]) => {
    const placemarks = fs.map((f) => {
      let geomKml = ''
      try { geomKml = geometryToKml(JSON.parse(f.geometryGeoJson) as GeoJSON.Geometry) } catch { return '' }
      if (!geomKml) return ''

      const statusLabel = FEATURE_STATUS_META[f.status]?.label ?? f.status
      const desc = [
        f.description,
        `Status: ${statusLabel}`,
        f.calculatedLengthFt ? `Length: ${f.calculatedLengthFt.toLocaleString()} ft` : '',
        f.fiberCount ? `Fiber Count: ${f.fiberCount}` : '',
        f.feederName ? `Feeder: ${f.feederName}` : '',
        f.workType ? `Work Type: ${f.workType}` : '',
      ].filter(Boolean).join('&#10;')

      const extData = f.extendedData
        ? `<ExtendedData>${Object.entries(f.extendedData).map(([k, v]) =>
            `<Data name="${x(k)}"><value>${x(v)}</value></Data>`
          ).join('')}</ExtendedData>`
        : ''

      return `    <Placemark>
      <name>${x(f.name ?? '')}</name>
      <description>${x(desc)}</description>
      <styleUrl>#s-${f.status}</styleUrl>
      ${extData}
      ${geomKml}
    </Placemark>`
    }).filter(Boolean).join('\n')

    return `  <Folder><name>${x(layerName)}</name>\n${placemarks}\n  </Folder>`
  }).join('\n')

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${x(projectName)}</name>
${statusStyles}
${folders}
</Document>
</kml>`

  const zip = new JSZip()
  zip.file('doc.kml', kml)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz' })
}

/** Convert a FieldMarkup's geometry to KML geometry string. */
function markupGeometryToKml(m: FieldMarkup): string {
  const geo = m.geometry
  if (geo.latlngs?.length) {
    // FieldMarkup uses [lat, lng]; KML needs lng,lat
    const coords = geo.latlngs.map(([lat, lng]) => `${lng},${lat},0`).join(' ')
    if (m.tool === 'polygon' || m.tool === 'rect') {
      // Close ring for polygons
      const first = geo.latlngs[0]
      return `<Polygon><outerBoundaryIs><LinearRing><tessellate>1</tessellate><coordinates>${coords} ${geo.latlngs[0][1]},${first[0]},0</coordinates></LinearRing></outerBoundaryIs></Polygon>`
    }
    return `<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>`
  }
  if (geo.bounds) {
    const [[lat1, lng1], [lat2, lng2]] = geo.bounds
    return `<Polygon><outerBoundaryIs><LinearRing><tessellate>1</tessellate><coordinates>${lng1},${lat1},0 ${lng2},${lat1},0 ${lng2},${lat2},0 ${lng1},${lat2},0 ${lng1},${lat1},0</coordinates></LinearRing></outerBoundaryIs></Polygon>`
  }
  if (geo.center) {
    const [lat, lng] = geo.center
    return `<Point><coordinates>${lng},${lat},0</coordinates></Point>`
  }
  return ''
}

/** Export field markup drawings to a KMZ file with color-coded line styles preserved. */
export async function exportFieldMarkupsToKmz(markups: FieldMarkup[], projectName = 'Markups'): Promise<Blob> {
  // Build one Style per unique color
  const colorSet = new Set(markups.map((m) => m.color))
  const styles = [...colorSet].map((color) => {
    const kmlColor = cssToKmlColor(color)
    const id = `mc-${color.replace('#', '')}`
    return `  <Style id="${id}">
    <LineStyle><color>${kmlColor}</color><width>3</width></LineStyle>
    <PolyStyle><color>${cssToKmlColor(color, '33')}</color></PolyStyle>
    <IconStyle><color>${kmlColor}</color><scale>0.8</scale></IconStyle>
  </Style>`
  }).join('\n')

  const placemarks = markups.map((m) => {
    const geomKml = markupGeometryToKml(m)
    if (!geomKml) return ''
    const styleId = `mc-${m.color.replace('#', '')}`
    const colorPreset = m.colorCode ? MARKUP_COLOR_CODES[m.colorCode] : null

    const extEntries: string[] = []
    if (m.colorCode)   extEntries.push(`<Data name="colorCode"><value>${x(m.colorCode)}</value></Data>`)
    if (colorPreset)   extEntries.push(`<Data name="workTypeLabel"><value>${x(colorPreset.label)}</value></Data>`)
    if (m.workType)    extEntries.push(`<Data name="workType"><value>${x(m.workType)}</value></Data>`)
    if (m.assetType)   extEntries.push(`<Data name="assetType"><value>${x(m.assetType)}</value></Data>`)
    if (m.lengthFt != null) extEntries.push(`<Data name="lengthFt"><value>${m.lengthFt}</value></Data>`)
    const extData = extEntries.length ? `<ExtendedData>${extEntries.join('')}</ExtendedData>` : ''

    const name = colorPreset?.label ?? m.assetType ?? m.subtype ?? m.tool
    const desc = [
      colorPreset ? `Work Type: ${colorPreset.label}` : '',
      m.assetCategory ? `Category: ${m.assetCategory}` : '',
      m.lengthFt ? `Length: ${m.lengthFt.toLocaleString()} ft` : '',
      m.label ? `Label: ${m.label}` : '',
      m.notes ? `Notes: ${m.notes}` : '',
    ].filter(Boolean).join('&#10;')

    return `  <Placemark>
    <name>${x(name)}</name>
    <description>${x(desc)}</description>
    <styleUrl>#${styleId}</styleUrl>
    ${extData}
    ${geomKml}
  </Placemark>`
  }).filter(Boolean).join('\n')

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${x(projectName)} — Field Markups</name>
${styles}
  <Folder><name>Field Markups</name>
${placemarks}
  </Folder>
</Document>
</kml>`

  const zip = new JSZip()
  zip.file('doc.kml', kml)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz' })
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
