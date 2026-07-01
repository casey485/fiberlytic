import { useCallback, useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  X, Loader2, MapPin, AlertCircle, ChevronRight, ChevronLeft,
  Pen, Highlighter, Minus, ArrowUpRight, Route, Pentagon, Square, Circle,
  Cloud, Type, MessageSquare, MousePointer2,
  Bold, Italic, Underline, Strikethrough,
  Trash2, Eye, EyeOff, Undo2, Redo2, FileDown, Check,
} from 'lucide-react'
import { loadBlob } from '../lib/fileStore'
import type { Map as LeafletMap, Layer } from 'leaflet'
import type { AnnotationTool } from '../types'
import 'leaflet/dist/leaflet.css'

// ── KML feature types ─────────────────────────────────────────────────────────

interface KmlStyle { color: string; fillColor: string; fillOpacity: number; weight: number }

interface KmlFeature {
  id: string
  type: 'point' | 'line' | 'polygon' | 'overlay'
  name: string; description: string; folder: string
  coords: [number, number][]
  style: KmlStyle
  imageUrl?: string
  bounds?: [[number, number], [number, number]]
}
type RawFeature = Omit<KmlFeature, 'id'>

// ── Hidden-feature persistence ────────────────────────────────────────────────
const HIDDEN_KEY = 'fiberlytic:kmz-hidden:v1'

function loadHidden(fileId: string): Set<string> {
  try { const raw = localStorage.getItem(HIDDEN_KEY); if (!raw) return new Set()
    return new Set((JSON.parse(raw) as Record<string, string[]>)[fileId] ?? []) } catch { return new Set() }
}
function saveHidden(fileId: string, ids: Set<string>) {
  try { const raw = localStorage.getItem(HIDDEN_KEY)
    const all = raw ? JSON.parse(raw) as Record<string, string[]> : {}
    if (ids.size === 0) delete all[fileId]; else all[fileId] = [...ids]
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(all)) } catch { /* ignore */ }
}

// ── KMZ Annotation types & persistence ───────────────────────────────────────

interface KmzAnnotation {
  id: string
  tool: AnnotationTool
  // All coords stored as lat/lng [lat, lng].
  // line/arrow: [start, end]; rect/ellipse/cloud/highlight: [corner1, corner2]
  // pen/polyline/polygon: all vertices; text/callout/pin: [position]
  coords: [number, number][]
  text?: string
  color: string
  strokeWidth: number
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  fillColor?: string
  fillOpacity?: number
  opacity?: number
  fontSize?: number
  fontFamily?: string
  fontBold?: boolean
  fontItalic?: boolean
  fontUnderline?: boolean
  fontStrikethrough?: boolean
  visible?: boolean
  sessionId?: string
  createdAt: string
}

const ANNOT_KEY = 'fiberlytic:kmz-annotations:v2'

function loadAnnotations(fileId: string): KmzAnnotation[] {
  try { const raw = localStorage.getItem(ANNOT_KEY); if (!raw) return []
    return (JSON.parse(raw) as Record<string, KmzAnnotation[]>)[fileId] ?? [] } catch { return [] }
}
function persistAnnotations(fileId: string, anns: KmzAnnotation[]) {
  try { const raw = localStorage.getItem(ANNOT_KEY)
    const all = raw ? JSON.parse(raw) as Record<string, KmzAnnotation[]> : {}
    if (anns.length === 0) delete all[fileId]; else all[fileId] = anns
    localStorage.setItem(ANNOT_KEY, JSON.stringify(all)) } catch { /* ignore */ }
}

// ── Feature notes (click-to-edit notes on imported KML features) ──────────────

const NOTES_KEY = 'fiberlytic:kmz-feature-notes:v1'

interface FeatureNote {
  note: string
  status: 'none' | 'in-progress' | 'complete'
  updatedAt: string
  centroid?: [number, number]
  boxW?: number
  boxH?: number
}

function loadFeatureNotes(fileId: string): Record<string, FeatureNote> {
  try { const raw = localStorage.getItem(NOTES_KEY); if (!raw) return {}
    return (JSON.parse(raw) as Record<string, Record<string, FeatureNote>>)[fileId] ?? {} } catch { return {} }
}
function saveFeatureNote(fileId: string, featureId: string, data: FeatureNote | null) {
  try { const raw = localStorage.getItem(NOTES_KEY)
    const all = raw ? JSON.parse(raw) as Record<string, Record<string, FeatureNote>> : {}
    if (!all[fileId]) all[fileId] = {}
    if (data) all[fileId][featureId] = data; else delete all[fileId][featureId]
    localStorage.setItem(NOTES_KEY, JSON.stringify(all)) } catch { /* ignore */ }
}

function getCentroid(f: KmlFeature): [number, number] {
  if (f.coords.length === 0) return [0, 0]
  if (f.type === 'point') return f.coords[0]
  if (f.type === 'line') return f.coords[Math.floor(f.coords.length / 2)]
  const lat = f.coords.reduce((s, c) => s + c[0], 0) / f.coords.length
  const lng = f.coords.reduce((s, c) => s + c[1], 0) / f.coords.length
  return [lat, lng]
}

function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

// ── SVG rendering helpers (mirrors RedlineEditor) ─────────────────────────────

function ptsToPath(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  return `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(([x, y]) => `L ${x} ${y}`).join(' ')
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx*dx + dy*dy)
  if (len < 1) return `${x2},${y2}`
  const ux = dx/len, uy = dy/len, px = -uy, py = ux, sz = Math.max(size, 14)
  return `${x2-ux*sz+px*sz*.45},${y2-uy*sz+py*sz*.45} ${x2},${y2} ${x2-ux*sz-px*sz*.45},${y2-uy*sz-py*sz*.45}`
}

function dashArray(style: string | undefined, sw: number): string | undefined {
  if (style === 'dashed') return `${sw * 5} ${sw * 3}`
  if (style === 'dotted') return `${sw} ${sw * 2}`
  return undefined
}

type ShapeData = { tool: AnnotationTool; color: string; strokeWidth: number } & Partial<KmzAnnotation> & {
  x1?: number; y1?: number; x2?: number; y2?: number; points?: [number,number][]
}

function renderShapeContent(s: ShapeData): React.ReactNode {
  const { tool, color, strokeWidth: sw } = s
  const op = s.opacity ?? 1
  const da = dashArray(s.lineStyle, sw)
  const common = { stroke: color, strokeWidth: sw, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeDasharray: da }
  switch (tool) {
    case 'pen':
      return <path d={ptsToPath(s.points ?? [])} {...common} strokeDasharray={undefined} opacity={op} />
    case 'line':
      return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} opacity={op} />
    case 'arrow':
      return <g opacity={op}><line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} /><polygon points={arrowHead(s.x1??0,s.y1??0,s.x2??0,s.y2??0,sw*3.5)} fill={color} stroke="none" /></g>
    case 'rect': {
      const x = Math.min(s.x1??0,s.x2??0), y = Math.min(s.y1??0,s.y2??0)
      return <rect x={x} y={y} width={Math.abs((s.x2??0)-(s.x1??0))} height={Math.abs((s.y2??0)-(s.y1??0))} {...common} fill={s.fillColor??'none'} fillOpacity={s.fillOpacity??1} opacity={op} />
    }
    case 'ellipse': {
      const cx = ((s.x1??0)+(s.x2??0))/2, cy = ((s.y1??0)+(s.y2??0))/2
      return <ellipse cx={cx} cy={cy} rx={Math.abs((s.x2??0)-(s.x1??0))/2} ry={Math.abs((s.y2??0)-(s.y1??0))/2} {...common} fill={s.fillColor??'none'} fillOpacity={s.fillOpacity??1} opacity={op} />
    }
    case 'highlight': {
      const x = Math.min(s.x1??0,s.x2??0), y = Math.min(s.y1??0,s.y2??0)
      return <rect x={x} y={y} width={Math.abs((s.x2??0)-(s.x1??0))} height={Math.abs((s.y2??0)-(s.y1??0))} fill={color} fillOpacity={s.fillOpacity??0.35} stroke="none" opacity={op} />
    }
    case 'cloud': {
      const x = Math.min(s.x1??0,s.x2??0), y = Math.min(s.y1??0,s.y2??0)
      return <rect x={x} y={y} width={Math.abs((s.x2??0)-(s.x1??0))} height={Math.abs((s.y2??0)-(s.y1??0))} fill={s.fillColor??'none'} fillOpacity={s.fillOpacity??0.08} stroke={color} strokeWidth={sw} strokeDasharray="10 5" rx={10} strokeLinecap="round" opacity={op} />
    }
    case 'text': {
      const td = [s.fontUnderline&&'underline',s.fontStrikethrough&&'line-through'].filter(Boolean).join(' ')||'none'
      return <text x={s.x1} y={s.y1} fill={color} fontSize={s.fontSize??sw*5} fontFamily={s.fontFamily??'Arial,sans-serif'} fontWeight={s.fontBold?'bold':'normal'} fontStyle={s.fontItalic?'italic':'normal'} textDecoration={td} dominantBaseline="hanging" opacity={op}>{s.text}</text>
    }
    case 'callout': {
      if (!s.text) return null
      const fs = s.fontSize??16, ff = s.fontFamily??'Arial,sans-serif', pad = 8
      const estW = Math.max(s.text.length*fs*0.58+pad*2,80)
      const td = [s.fontUnderline&&'underline',s.fontStrikethrough&&'line-through'].filter(Boolean).join(' ')||'none'
      return <g opacity={s.opacity??1}><rect x={(s.x1??0)-pad} y={(s.y1??0)-pad} width={estW} height={fs*1.7} fill={s.fillColor??'#ffffff'} fillOpacity={s.fillOpacity??0.92} stroke={color} strokeWidth={sw} rx={4} /><text x={s.x1} y={(s.y1??0)+fs*0.72} fill={color} fontSize={fs} fontFamily={ff} fontWeight={s.fontBold?'bold':'normal'} fontStyle={s.fontItalic?'italic':'normal'} textDecoration={td}>{s.text}</text></g>
    }
    case 'polyline':
      return <path d={ptsToPath(s.points??[])} {...common} opacity={op} />
    case 'polygon': {
      const pts = s.points??[]; if (pts.length < 2) return null
      const d = `M ${pts[0][0]} ${pts[0][1]} `+pts.slice(1).map(([x,y])=>`L ${x} ${y}`).join(' ')+' Z'
      return <path d={d} stroke={color} strokeWidth={sw} fill={s.fillColor??'none'} fillOpacity={s.fillOpacity??0.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={da} opacity={op} />
    }
    case 'pin': {
      const cx = s.x1??0, cy = s.y1??0
      return <g opacity={op}><line x1={cx} y1={cy-5} x2={cx} y2={cy-20} stroke={color} strokeWidth={Math.max(sw,1.5)} strokeLinecap="round"/><circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={1.5}/>{s.text&&<text x={cx+11} y={cy+4} fill={color} fontSize={s.fontSize??12} fontFamily={s.fontFamily??'Arial,sans-serif'} fontWeight="bold">{s.text}</text>}</g>
    }
    default: return null
  }
}

function shapeBounds(s: ShapeData): { x: number; y: number; w: number; h: number } | null {
  const pad = 6
  if (s.tool === 'pin' && s.x1 !== undefined && s.y1 !== undefined) return { x: s.x1-16, y: s.y1-28, w: 100, h: 40 }
  if (s.x1!==undefined && s.x2!==undefined && s.y1!==undefined && s.y2!==undefined) {
    const x = Math.min(s.x1,s.x2), y = Math.min(s.y1,s.y2)
    return { x:x-pad, y:y-pad, w:Math.abs(s.x2-s.x1)+pad*2, h:Math.abs(s.y2-s.y1)+pad*2 }
  }
  if (s.points && s.points.length > 0) {
    const xs = s.points.map(p=>p[0]), ys = s.points.map(p=>p[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x:x-pad, y:y-pad, w:Math.max(...xs)-x+pad*2, h:Math.max(...ys)-y+pad*2 }
  }
  return null
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function allEls(root: Element|Document, tag: string): Element[] { return Array.from(root.getElementsByTagNameNS('*', tag)) }
function deepText(parent: Element, tag: string): string { return allEls(parent,tag)[0]?.textContent?.trim()??'' }
function kmlColor(raw?: string|null, fallback='#10b981'): string {
  if (!raw) return fallback; const c = raw.replace(/\s/g,'')
  if (c.length===8) return `#${c.slice(6,8)}${c.slice(4,6)}${c.slice(2,4)}`
  if (c.length===6) return `#${c}`; return fallback
}
function parseKmlCoords(raw: string): [number,number][] {
  return raw.replace(/\s*,\s*/g,',').trim().split(/\s+/).map(t=>{const p=t.split(',').map(Number);return p.length>=2&&!isNaN(p[0])&&!isNaN(p[1])?[p[1],p[0]] as [number,number]:null}).filter((c): c is [number,number]=>c!==null)
}
function parseGxCoord(raw: string): [number,number]|null { const p=raw.trim().split(/\s+/).map(Number); return p.length>=2&&!isNaN(p[0])&&!isNaN(p[1])?[p[1],p[0]]:null }
function containerName(node: Element): string {
  const nameEl=node.getElementsByTagNameNS('*','name')[0]; if(!nameEl) return ''
  if(nameEl.parentElement===node) return nameEl.textContent?.trim()??''
  let p=nameEl.parentElement; while(p&&p!==node){if(['Folder','Document','Placemark'].includes(p.localName)) return ''; p=p.parentElement}
  return nameEl.textContent?.trim()??''
}
function folderPath(el: Element): string {
  const parts: string[]=[]; let node: Element|null=el.parentElement
  while(node){const ln=node.localName;if(ln==='Folder'||(ln==='Document'&&node.parentElement?.localName!=='kml')){const n=containerName(node);if(n)parts.unshift(n)}node=node.parentElement}
  return parts.join(' › ')
}
interface RawStyle{color:string;fillColor:string;fillOpacity:number;weight:number}
const DEFAULT_STYLE: RawStyle={color:'#10b981',fillColor:'#10b981',fillOpacity:0.2,weight:2}
function styleFromEl(el: Element): RawStyle {
  const lineEl=allEls(el,'LineStyle')[0],polyEl=allEls(el,'PolyStyle')[0],iconEl=allEls(el,'IconStyle')[0]
  const lineColor=lineEl?deepText(lineEl,'color'):'',polyColor=polyEl?deepText(polyEl,'color'):'',iconColor=iconEl?deepText(iconEl,'color'):''
  const fillOff=polyEl?deepText(polyEl,'fill')==='0':false
  return{color:kmlColor(lineColor||polyColor||iconColor),fillColor:kmlColor(polyColor||lineColor),fillOpacity:fillOff?0:0.25,weight:Math.max(1,parseFloat(lineEl?deepText(lineEl,'width'):'')||2)}
}
function buildStyleMap(doc: Document): Map<string,RawStyle> {
  const map=new Map<string,RawStyle>()
  allEls(doc,'Style').forEach(el=>{const id=el.getAttribute('id');if(id)map.set(`#${id}`,styleFromEl(el))})
  allEls(doc,'StyleMap').forEach(sm=>{const id=sm.getAttribute('id');if(!id)return;let resolved: RawStyle|undefined;allEls(sm,'Pair').forEach(pair=>{if(deepText(pair,'key')==='normal'){const url=deepText(pair,'styleUrl');resolved=map.get(url)??resolved}});if(!resolved){const firstUrl=deepText(allEls(sm,'Pair')[0]??sm,'styleUrl');resolved=map.get(firstUrl)}if(resolved)map.set(`#${id}`,resolved)})
  return map
}
function resolveStyle(pm: Element,styleMap: Map<string,RawStyle>): RawStyle {
  const styleUrl=deepText(pm,'styleUrl');if(styleUrl&&styleMap.has(styleUrl))return styleMap.get(styleUrl)!
  const inline=Array.from(pm.children).find(c=>c.localName==='Style');if(inline)return styleFromEl(inline);return DEFAULT_STYLE
}

async function extractFromDoc(doc: Document, zipFiles: JSZip['files']|null, visitedKml: Set<string>): Promise<RawFeature[]> {
  const out: RawFeature[]=[]; const styleMap=buildStyleMap(doc)
  for(const pm of allEls(doc,'Placemark')){
    const nameEl=Array.from(pm.children).find(c=>c.localName==='name')??pm.getElementsByTagNameNS('*','name')[0]
    const name=nameEl?.textContent?.trim()||pm.getAttribute('id')||'Unnamed'
    const rawDesc=pm.getElementsByTagNameNS('*','description')[0]?.textContent?.trim()??''
    const descText=rawDesc.replace(/<[^>]+>/g,' ').replace(/\s{2,}/g,' ').trim()
    const extParts: string[]=[]
    for(const sd of Array.from(pm.getElementsByTagNameNS('*','SimpleData'))){const k=sd.getAttribute('name');const v=sd.textContent?.trim();if(k&&v)extParts.push(`${k}: ${v}`)}
    for(const d of Array.from(pm.getElementsByTagNameNS('*','Data'))){const k=d.getAttribute('name');const v=d.getElementsByTagNameNS('*','value')[0]?.textContent?.trim();if(k&&v)extParts.push(`${k}: ${v}`)}
    const description=descText||extParts.join(' | '); const folder=folderPath(pm); const style=resolveStyle(pm,styleMap)
    for(const ptEl of allEls(pm,'Point')){const coords=parseKmlCoords(deepText(ptEl,'coordinates'));if(coords.length>0)out.push({type:'point',name,description,folder,coords:[coords[0]],style})}
    for(const lsEl of allEls(pm,'LineString')){const coords=parseKmlCoords(deepText(lsEl,'coordinates'));if(coords.length>1)out.push({type:'line',name,description,folder,coords,style})}
    for(const lrEl of allEls(pm,'LinearRing')){if(lrEl.closest?.('Polygon')||lrEl.parentElement?.localName==='outerBoundaryIs'||lrEl.parentElement?.localName==='innerBoundaryIs')continue;const coords=parseKmlCoords(deepText(lrEl,'coordinates'));if(coords.length>2)out.push({type:'polygon',name,description,folder,coords,style})}
    for(const polyEl of allEls(pm,'Polygon')){const outerEl=allEls(polyEl,'outerBoundaryIs')[0];const coords=parseKmlCoords(outerEl?deepText(outerEl,'coordinates'):deepText(polyEl,'coordinates'));if(coords.length>2)out.push({type:'polygon',name,description,folder,coords,style})}
    for(const trackEl of allEls(pm,'Track')){const coords=allEls(trackEl,'coord').map(ce=>parseGxCoord(ce.textContent??'')).filter((c): c is [number,number]=>c!==null);if(coords.length>1)out.push({type:'line',name,description,folder,coords,style})}
    for(const mtEl of allEls(pm,'MultiTrack')){for(const trackEl of allEls(mtEl,'Track')){const coords=allEls(trackEl,'coord').map(ce=>parseGxCoord(ce.textContent??'')).filter((c): c is [number,number]=>c!==null);if(coords.length>1)out.push({type:'line',name,description,folder,coords,style})}}
  }
  for(const ovEl of allEls(doc,'GroundOverlay')){
    const nameEl2=Array.from(ovEl.children).find(c=>c.localName==='name')??ovEl.getElementsByTagNameNS('*','name')[0]
    const name=nameEl2?.textContent?.trim()||'Overlay'; const folder=folderPath(ovEl); const href=deepText(ovEl,'href')
    const llbEl=allEls(ovEl,'LatLonBox')[0]??allEls(ovEl,'LatLonQuad')[0]; if(!llbEl)continue
    let north: number,south: number,east: number,west: number
    if(llbEl.localName==='LatLonBox'){north=parseFloat(deepText(llbEl,'north'));south=parseFloat(deepText(llbEl,'south'));east=parseFloat(deepText(llbEl,'east'));west=parseFloat(deepText(llbEl,'west'))}
    else{const pts=parseKmlCoords(deepText(llbEl,'coordinates'));if(pts.length<4)continue;const lats=pts.map(p=>p[0]);const lngs=pts.map(p=>p[1]);south=Math.min(...lats);north=Math.max(...lats);west=Math.min(...lngs);east=Math.max(...lngs)}
    if([north,south,east,west].some(isNaN))continue
    let imageUrl: string|undefined
    if(zipFiles&&href){const cands=[href,href.replace(/^files\//,''),`files/${href}`,`files/${href.split('/').pop()}`, ...Object.keys(zipFiles).filter(k=>k.endsWith('/'+(href.split('/').pop()??'')))]
      for(const path of cands){const entry=zipFiles[path];if(entry&&!entry.dir){const b64=await entry.async('base64');const ext=path.toLowerCase().split('.').pop()??'jpg';imageUrl=`data:${ext==='png'?'image/png':ext==='gif'?'image/gif':'image/jpeg'};base64,${b64}`;break}}}
    out.push({type:'overlay',name,description:'',folder,coords:[[south,west],[north,east]],style:DEFAULT_STYLE,imageUrl,bounds:[[south,west],[north,east]]})
  }
  if(zipFiles){for(const nlEl of allEls(doc,'NetworkLink')){const href=deepText(nlEl,'href');if(!href||href.startsWith('http://')||href.startsWith('https://')||visitedKml.has(href))continue;for(const path of[href,`files/${href}`,href.replace(/^files\//,'')]){const entry=zipFiles[path];if(entry&&!entry.dir){visitedKml.add(href);const nested=await extractFromDoc(parseKml(await entry.async('text')),zipFiles,visitedKml);out.push(...nested);break}}}}
  return out
}

function parseKml(text: string): Document {
  let doc=new DOMParser().parseFromString(text,'text/xml')
  if(doc.getElementsByTagName('parsererror').length>0) doc=new DOMParser().parseFromString(text,'text/html')
  return doc
}

interface LoadResult{features: KmlFeature[];diagLines: string[]}

async function loadFeatures(dataUrl: string, fileName: string): Promise<LoadResult> {
  const isKmz=/\.kmz$/i.test(fileName); const diagLines: string[]=[]
  if(isKmz){let zip: JSZip|null=null;try{zip=await JSZip.loadAsync(await(await fetch(dataUrl)).arrayBuffer())}catch(e){diagLines.push(`ZIP error: ${e}`)}
    if(zip){diagLines.push(`ZIP contents: ${Object.keys(zip.files).sort().join(', ')}`)
      const kmlEntries=Object.values(zip.files).filter(f=>!f.dir&&/\.kml$/i.test(f.name)).sort((a,b)=>a.name==='doc.kml'?-1:b.name==='doc.kml'?1:a.name.localeCompare(b.name))
      const visitedKml=new Set(kmlEntries.map(e=>e.name)); const raw: RawFeature[]=[]
      for(const entry of kmlEntries){const kmlText=await entry.async('text');diagLines.push(`\n── ${entry.name} (first 600 chars) ──\n${kmlText.slice(0,600)}`);const doc=parseKml(kmlText);diagLines.push(`Elements: Placemark=${doc.getElementsByTagNameNS('*','Placemark').length} Folder=${doc.getElementsByTagNameNS('*','Folder').length} Document=${doc.getElementsByTagNameNS('*','Document').length} NetworkLink=${doc.getElementsByTagNameNS('*','NetworkLink').length}`);const found=await extractFromDoc(doc,zip.files,visitedKml);diagLines.push(`Features extracted: ${found.length}`);raw.push(...found)}
      return{features:raw.map((f,i)=>({...f,id:`f${i}`})),diagLines}}}
  const text=await(await fetch(dataUrl)).text();diagLines.push(`Plain KML (first 600 chars):\n${text.slice(0,600)}`)
  return{features:(await extractFromDoc(parseKml(text),null,new Set())).map((f,i)=>({...f,id:`f${i}`})),diagLines}
}

// ── Constants ─────────────────────────────────────────────────────────────────

type KmzTool = 'select' | AnnotationTool

const DRAW_TOOLS: {id: AnnotationTool; label: string; icon: React.ReactNode}[] = [
  {id:'pen',       label:'Freehand',  icon:<Pen size={14}/>},
  {id:'highlight', label:'Highlight', icon:<Highlighter size={14}/>},
  {id:'line',      label:'Line',      icon:<Minus size={14}/>},
  {id:'arrow',     label:'Arrow',     icon:<ArrowUpRight size={14}/>},
  {id:'polyline',  label:'Multiline', icon:<Route size={14}/>},
  {id:'polygon',   label:'Polygon',   icon:<Pentagon size={14}/>},
  {id:'rect',      label:'Rectangle', icon:<Square size={14}/>},
  {id:'ellipse',   label:'Ellipse',   icon:<Circle size={14}/>},
  {id:'cloud',     label:'Cloud',     icon:<Cloud size={14}/>},
  {id:'text',      label:'Text',      icon:<Type size={14}/>},
  {id:'callout',   label:'Callout',   icon:<MessageSquare size={14}/>},
  {id:'pin',       label:'Pin',       icon:<MapPin size={14}/>},
]

const COLORS = ['#000000','#374151','#6b7280','#9ca3af','#d1d5db','#f9fafb','#7c1d1d','#b91c1c','#c2410c','#15803d','#0f766e','#1d4ed8','#7e22ce','#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#a855f7','#ec4899']

const WIDTHS = [{value:1,label:'Hair'},{value:2,label:'Thin'},{value:4,label:'Med'},{value:8,label:'Thick'}]
const LINE_STYLES = [{value:'solid',label:'—'},{value:'dashed',label:'- -'},{value:'dotted',label:'···'}] as const
const FONT_FAMILIES = [
  {label:'Arial',    value:'Arial, sans-serif'},
  {label:'Helvetica',value:'Helvetica, sans-serif'},
  {label:'Times',    value:'Times New Roman, serif'},
  {label:'Courier',  value:'Courier New, monospace'},
]
const FONT_SIZES = [8,10,12,14,16,18,24,32,48]
const TEXT_TOOLS: AnnotationTool[] = ['text','callout','pin']
const FILL_TOOLS: AnnotationTool[] = ['rect','ellipse','cloud','highlight','polygon']
const LINE_STYLE_TOOLS: AnnotationTool[] = ['line','arrow','rect','ellipse','cloud','polyline','polygon']

const SL = 'mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500'
const activeBtn = 'bg-emerald-700 text-white'
const inactiveBtn = 'text-slate-400 hover:bg-white/8 hover:text-slate-200'

type TextInputState = {visible: false}|{visible: true; screenX: number; screenY: number; latLng: [number,number]}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props{fileId: string; fileName: string; onClose: ()=>void}
type LeafletModule = typeof import('leaflet')

export function KmzViewer({fileId, fileName, onClose}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef       = useRef<SVGSVGElement>(null)
  const mapRef       = useRef<LeafletMap|null>(null)
  const leafletRef   = useRef<LeafletModule|null>(null)
  const kmlLayerMap  = useRef<Map<string,Layer>>(new Map())

  // Map state
  const [status,        setStatus]        = useState<'loading'|'ready'|'error'>('loading')
  const [errorMsg,      setErrorMsg]      = useState('')
  const [features,      setFeatures]      = useState<KmlFeature[]>([])
  const [diagLines,     setDiagLines]     = useState<string[]>([])
  const [showDiag,      setShowDiag]      = useState(false)
  const [panelOpen,     setPanelOpen]     = useState(true)
  const [activeFeature, setActiveFeature] = useState<KmlFeature|null>(null)
  const [hiddenIds,     setHiddenIds]     = useState<Set<string>>(new Set())
  const [mapViewVer,    setMapViewVer]    = useState(0) // increments on pan/zoom

  // Annotation state
  const [annotations,    setAnnotations]    = useState<KmzAnnotation[]>([])
  const [showAnnotTab,   setShowAnnotTab]   = useState(true)
  const [selectedAnnotId, setSelectedAnnotId] = useState<string|null>(null)

  // Tool & style state (mirrors PDF editor)
  const [tool,             setTool]             = useState<KmzTool>('select')
  const [color,            setColor]            = useState('#ef4444')
  const [width,            setWidth]            = useState(2)
  const [lineStyle,        setLineStyle]        = useState<'solid'|'dashed'|'dotted'>('solid')
  const [fontSize,         setFontSize]         = useState(16)
  const [fontFamily,       setFontFamily]       = useState('Arial, sans-serif')
  const [fontBold,         setFontBold]         = useState(false)
  const [fontItalic,       setFontItalic]       = useState(false)
  const [fontUnderline,    setFontUnderline]    = useState(false)
  const [fontStrikethrough,setFontStrikethrough]= useState(false)
  const [fillColor,        setFillColor]        = useState('#ffffff')
  const [fillOpacity,      setFillOpacity]      = useState(0.35)
  const [shapeOpacity,     setShapeOpacity]     = useState(1)

  // Draw state (pixel coords — converted to lat/lng on commit)
  const [drawing,      setDrawing]      = useState(false)
  const [penPts,       setPenPts]       = useState<[number,number][]>([]) // pixel
  const [draft,        setDraft]        = useState<{x1:number;y1:number;x2:number;y2:number}|null>(null) // pixel
  const [multiPts,     setMultiPts]     = useState<[number,number][]>([]) // lat/lng stored as user clicks
  const [multiPxPts,   setMultiPxPts]   = useState<[number,number][]>([]) // pixel for preview rendering
  const [multiPreviewPx, setMultiPreviewPx] = useState<[number,number]|null>(null) // pixel
  const lastClickRef = useRef<{time:number;x:number;y:number}|null>(null)
  const [textInput,    setTextInput]    = useState<TextInputState>({visible:false})
  const textRef = useRef<HTMLInputElement>(null)

  // Undo/redo
  const undoStackRef = useRef<KmzAnnotation[][]>([])
  const redoStackRef = useRef<KmzAnnotation[][]>([])
  const [canUndo,setCanUndo] = useState(false)
  const [canRedo,setCanRedo] = useState(false)
  const sessionId = useRef(Date.now().toString(36))

  // Export
  const [exporting, setExporting] = useState(false)

  // Feature info panel (click on imported KML line/polygon/point)
  const [selectedFeature, setSelectedFeature] = useState<KmlFeature | null>(null)
  const [featureNotes, setFeatureNotes] = useState<Record<string, FeatureNote>>({})
  const [noteText, setNoteText] = useState('')
  const [noteStatus, setNoteStatus] = useState<'none'|'in-progress'|'complete'>('none')
  const [noteSaved, setNoteSaved] = useState(false)
  const [editingCalloutId, setEditingCalloutId] = useState<string|null>(null)
  const [editingCalloutText, setEditingCalloutText] = useState('')
  const [noteUndoVisible, setNoteUndoVisible] = useState(false)
  const noteUndoRef  = useRef<{featureId: string; note: FeatureNote} | null>(null)
  const noteUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [clickPopup, setClickPopup] = useState<{feature: KmlFeature; x: number; y: number} | null>(null)

  const selectedAnnot = annotations.find(a => a.id === selectedAnnotId) ?? null

  // ── Coordinate conversion ────────────────────────────────────────────────────
  // pixel on SVG overlay → lat/lng
  const toLatLng = useCallback((clientX: number, clientY: number): [number,number] => {
    const map = mapRef.current; const el = containerRef.current; if(!map||!el) return [0,0]
    const rect = el.getBoundingClientRect()
    const ll = map.containerPointToLatLng([clientX-rect.left, clientY-rect.top])
    return [ll.lat, ll.lng]
  }, [])

  // lat/lng → pixel on SVG overlay (depends on mapViewVer to force re-projection)
  function latlngToPixel(ll: [number,number]): [number,number] {
    const map = mapRef.current; if(!map) return [0,0]
    const pt = map.latLngToContainerPoint(ll)
    return [pt.x, pt.y]
  }

  // Convert KmzAnnotation to pixel ShapeData for SVG rendering
  function annToShapeData(ann: KmzAnnotation): ShapeData {
    const base: ShapeData = {
      tool: ann.tool, color: ann.color, strokeWidth: ann.strokeWidth,
      lineStyle: ann.lineStyle, fillColor: ann.fillColor, fillOpacity: ann.fillOpacity,
      opacity: ann.opacity, fontSize: ann.fontSize, fontFamily: ann.fontFamily,
      fontBold: ann.fontBold, fontItalic: ann.fontItalic,
      fontUnderline: ann.fontUnderline, fontStrikethrough: ann.fontStrikethrough,
      text: ann.text,
    }
    if (ann.tool === 'text' || ann.tool === 'callout' || ann.tool === 'pin') {
      if (ann.coords.length === 0) return base
      const [x,y] = latlngToPixel(ann.coords[0])
      return {...base, x1:x, y1:y}
    }
    if (['line','arrow','rect','ellipse','cloud','highlight'].includes(ann.tool)) {
      if (ann.coords.length < 2) return base
      const [x1,y1] = latlngToPixel(ann.coords[0])
      const [x2,y2] = latlngToPixel(ann.coords[1])
      return {...base, x1, y1, x2, y2}
    }
    if (['pen','polyline','polygon'].includes(ann.tool)) {
      return {...base, points: ann.coords.map(c => latlngToPixel(c))}
    }
    return base
  }

  // ── Undo/redo ────────────────────────────────────────────────────────────────
  function saveUndo(current: KmzAnnotation[]) {
    undoStackRef.current = [...undoStackRef.current, [...current]].slice(-30)
    redoStackRef.current = []; setCanUndo(true); setCanRedo(false)
  }
  function doUndo() {
    if (!undoStackRef.current.length) return
    const prev = undoStackRef.current.pop()!
    redoStackRef.current.push([...annotations]); setAnnotations(prev)
    setSelectedAnnotId(null); setCanUndo(undoStackRef.current.length>0); setCanRedo(true)
  }
  function doRedo() {
    if (!redoStackRef.current.length) return
    const next = redoStackRef.current.pop()!
    undoStackRef.current.push([...annotations]); setAnnotations(next)
    setSelectedAnnotId(null); setCanUndo(true); setCanRedo(redoStackRef.current.length>0)
  }

  // ── Annotation CRUD ─────────────────────────────────────────────────────────
  type StyleExtras = { color: string; strokeWidth: number } & Partial<Omit<KmzAnnotation, 'id'|'tool'|'coords'|'createdAt'|'color'|'strokeWidth'>>

  function currentStyleProps(): StyleExtras {
    const base: StyleExtras = {
      color, strokeWidth: width,
      lineStyle: lineStyle !== 'solid' ? lineStyle : undefined,
      opacity: shapeOpacity < 0.99 ? shapeOpacity : undefined,
      sessionId: sessionId.current,
    }
    if (TEXT_TOOLS.includes(tool as AnnotationTool)) {
      return {...base, fontSize, fontFamily,
        fontBold: fontBold||undefined, fontItalic: fontItalic||undefined,
        fontUnderline: fontUnderline||undefined, fontStrikethrough: fontStrikethrough||undefined,
        fillColor: tool==='callout' ? fillColor : undefined,
        fillOpacity: tool==='callout' ? fillOpacity : undefined,
      }
    }
    if (FILL_TOOLS.includes(tool as AnnotationTool)) {
      return {...base,
        fillColor: tool==='highlight' ? undefined : (fillColor||undefined),
        fillOpacity,
      }
    }
    return base
  }

  function patchAnnot(id: string, changes: Partial<KmzAnnotation>) {
    setAnnotations(prev => prev.map(a => a.id===id ? {...a,...changes} : a))
  }

  function deleteAnnot(id: string) {
    saveUndo(annotations)
    setAnnotations(prev => prev.filter(a => a.id!==id))
    if (selectedAnnotId===id) setSelectedAnnotId(null)
  }

  // Sync sidebar controls when selection changes
  useEffect(() => {
    if (!selectedAnnot) return
    setColor(selectedAnnot.color); setWidth(selectedAnnot.strokeWidth)
    if (selectedAnnot.lineStyle) setLineStyle(selectedAnnot.lineStyle)
    if (selectedAnnot.opacity) setShapeOpacity(selectedAnnot.opacity)
    if (selectedAnnot.fontSize) setFontSize(selectedAnnot.fontSize)
    if (selectedAnnot.fontFamily) setFontFamily(selectedAnnot.fontFamily)
    setFontBold(!!selectedAnnot.fontBold); setFontItalic(!!selectedAnnot.fontItalic)
    setFontUnderline(!!selectedAnnot.fontUnderline); setFontStrikethrough(!!selectedAnnot.fontStrikethrough)
    if (selectedAnnot.fillColor) setFillColor(selectedAnnot.fillColor)
    if (selectedAnnot.fillOpacity !== undefined) setFillOpacity(selectedAnnot.fillOpacity)
  }, [selectedAnnotId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear selection + multi-pts when tool changes
  useEffect(() => { if (tool !== 'select') setSelectedAnnotId(null); setMultiPts([]); setMultiPxPts([]); setMultiPreviewPx(null) }, [tool])

  // ── Persistence ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setAnnotations(loadAnnotations(fileId))
    setHiddenIds(loadHidden(fileId))
    setFeatureNotes(loadFeatureNotes(fileId))
  }, [fileId])
  useEffect(() => { persistAnnotations(fileId, annotations) }, [fileId, annotations])
  useEffect(() => {
    saveHidden(fileId, hiddenIds)
    const map = mapRef.current; if (!map) return
    kmlLayerMap.current.forEach((layer, id) => {
      if (hiddenIds.has(id)) map.removeLayer(layer); else layer.addTo(map)
    })
  }, [fileId, hiddenIds])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key==='Escape') { setMultiPts([]); setMultiPxPts([]); setMultiPreviewPx(null); setTextInput({visible:false}); if(drawMode()==='none') onClose() }
      if ((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey) { e.preventDefault(); doUndo() }
      if ((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.key==='z'&&e.shiftKey))) { e.preventDefault(); doRedo() }
      if (e.key==='Delete'&&selectedAnnotId) deleteAnnot(selectedAnnotId)
    }
    window.addEventListener('keydown', h)
    return ()=>window.removeEventListener('keydown', h)
  })

  function drawMode() { return tool !== 'select' ? tool : 'none' }

  // ── Finish multi-point shape ─────────────────────────────────────────────────
  function finishMultiPt() {
    const minPts = tool==='polygon' ? 3 : 2
    if (multiPts.length < minPts) { setMultiPts([]); setMultiPxPts([]); setMultiPreviewPx(null); return }
    saveUndo(annotations)
    const coords = tool==='polygon' ? [...multiPts, multiPts[0]] : multiPts
    setAnnotations(prev => [...prev, {id:genId(), tool:tool as AnnotationTool, coords, ...currentStyleProps(), createdAt:new Date().toISOString()}])
    setMultiPts([]); setMultiPxPts([]); setMultiPreviewPx(null); lastClickRef.current=null
  }

  // ── Text commit ──────────────────────────────────────────────────────────────
  function commitText() {
    if (!textInput.visible) return
    const val = textRef.current?.value.trim()
    if (val) {
      saveUndo(annotations)
      setAnnotations(prev => [...prev, {id:genId(), tool:tool as AnnotationTool, coords:[textInput.latLng], text:val, ...currentStyleProps(), createdAt:new Date().toISOString()}])
    }
    setTextInput({visible:false})
  }

  // ── SVG pointer handlers ─────────────────────────────────────────────────────
  function getSvgXY(e: React.PointerEvent<SVGSVGElement>): [number,number] {
    const el = containerRef.current; if(!el) return [0,0]
    const rect = el.getBoundingClientRect()
    return [e.clientX-rect.left, e.clientY-rect.top]
  }

  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (textInput.visible) { commitText(); return }
    const [px, py] = getSvgXY(e)

    // Multi-point tools
    if (tool==='polyline' || tool==='polygon') {
      const now = Date.now(), last = lastClickRef.current
      const isDouble = !!last && now-last.time<350 && Math.abs(px-last.x)<10 && Math.abs(py-last.y)<10
      lastClickRef.current = {time:now, x:px, y:py}
      if (isDouble) { finishMultiPt(); return }
      const ll = toLatLng(e.clientX, e.clientY)
      setMultiPts(pts => [...pts, ll])
      setMultiPxPts(pts => [...pts, [px, py]])
      return
    }

    // Text / callout
    if (tool==='text' || tool==='callout') {
      const el = containerRef.current!.getBoundingClientRect()
      setTextInput({visible:true, screenX:e.clientX-el.left, screenY:e.clientY-el.top, latLng:toLatLng(e.clientX,e.clientY)})
      setTimeout(()=>textRef.current?.focus(),20)
      return
    }

    // Pin
    if (tool==='pin') {
      saveUndo(annotations)
      const ll = toLatLng(e.clientX, e.clientY)
      setAnnotations(prev => [...prev, {id:genId(), tool:'pin', coords:[ll], ...currentStyleProps(), createdAt:new Date().toISOString()}])
      return
    }

    // Drag-to-draw tools
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrawing(true)
    if (tool==='pen') setPenPts([[px,py]])
    else setDraft({x1:px, y1:py, x2:px, y2:py})
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const [px, py] = getSvgXY(e)
    if (tool==='polyline' || tool==='polygon') { setMultiPreviewPx([px,py]); return }
    if (!drawing) return
    if (tool==='pen') setPenPts(pts => [...pts, [px,py]])
    else setDraft(d => d ? {...d, x2:px, y2:py} : null)
  }

  function onSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!drawing) return
    setDrawing(false)
    const [px, py] = getSvgXY(e)
    if (tool==='pen') {
      if (penPts.length > 2) {
        saveUndo(annotations)
        const coords = penPts.map(([x,y]) => {
          const ll = mapRef.current?.containerPointToLatLng([x,y])
          return ll ? [ll.lat,ll.lng] as [number,number] : [0,0] as [number,number]
        })
        setAnnotations(prev => [...prev, {id:genId(), tool:'pen', coords, ...currentStyleProps(), createdAt:new Date().toISOString()}])
      }
      setPenPts([])
    } else if (draft) {
      const fin = {...draft, x2:px, y2:py}
      const dx = Math.abs(fin.x2-fin.x1), dy = Math.abs(fin.y2-fin.y1)
      if (dx>4 || dy>4) {
        const ll1 = mapRef.current?.containerPointToLatLng([fin.x1,fin.y1])
        const ll2 = mapRef.current?.containerPointToLatLng([fin.x2,fin.y2])
        if (ll1 && ll2) {
          saveUndo(annotations)
          setAnnotations(prev => [...prev, {
            id:genId(), tool:tool as AnnotationTool,
            coords:[[ll1.lat,ll1.lng],[ll2.lat,ll2.lng]],
            ...currentStyleProps(), createdAt:new Date().toISOString(),
          }])
        }
      }
      setDraft(null)
    }
  }

  // ── Map init + KML layer loading ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const dataUrl = await loadBlob(fileId); if(!dataUrl) throw new Error('File not found.')
        if(cancelled) return
        const {features:parsed, diagLines:diag} = await loadFeatures(dataUrl, fileName)
        if(cancelled) return
        setDiagLines(diag)
        if(parsed.length===0) throw new Error('No map features found.')
        setFeatures(parsed); setStatus('ready')

        requestAnimationFrame(()=>{
          if(cancelled||!containerRef.current||mapRef.current) return
          import('leaflet').then(L=>{
            if(cancelled||!containerRef.current) return
            leafletRef.current = L
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (L.Icon.Default.prototype as any)._getIconUrl
            L.Icon.Default.mergeOptions({iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'})

            const map = L.map(containerRef.current!,{zoomControl:true,doubleClickZoom:false})
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:21}).addTo(map)
            mapRef.current = map

            // Force SVG re-projection on every map move/zoom
            map.on('move zoom', () => setMapViewVer(v=>v+1))

            const allCoords: [number,number][] = []
            const initialHidden = loadHidden(fileId)

            for(const f of parsed){
              let layer: Layer
              if(f.type==='point'){
                layer=L.circleMarker(f.coords[0],{radius:6,color:f.style.color,fillColor:f.style.fillColor,fillOpacity:0.8,weight:2})
              } else if(f.type==='line'){
                layer=L.polyline(f.coords,{color:f.style.color,weight:f.style.weight,opacity:0.9})
              } else if(f.type==='polygon'){
                layer=L.polygon(f.coords,{color:f.style.color,fillColor:f.style.fillColor,fillOpacity:f.style.fillOpacity,weight:f.style.weight})
              } else if(f.type==='overlay'&&f.imageUrl&&f.bounds){
                layer=L.imageOverlay(f.imageUrl,f.bounds,{opacity:0.85})
              } else { continue }

              // Click shows the choice popup (View Info / Add Note)
              if ('on' in layer) {
                (layer as {on:(ev:string,fn:(e:unknown)=>void)=>void}).on('click', (e) => {
                  if ((e as {originalEvent?:{stopPropagation?:()=>void}}).originalEvent?.stopPropagation) {
                    (e as {originalEvent:{stopPropagation:()=>void}}).originalEvent.stopPropagation()
                  }
                  const pt = (e as {containerPoint:{x:number;y:number}}).containerPoint
                  setClickPopup({ feature: f, x: pt.x, y: pt.y })
                })
              }

              kmlLayerMap.current.set(f.id, layer)
              if(!initialHidden.has(f.id)) layer.addTo(map)
              allCoords.push(...f.coords)
            }

            if(allCoords.length>0) map.fitBounds(allCoords,{padding:[40,40],maxZoom:17})
          })
        })
      } catch(err){
        if(!cancelled){setErrorMsg(err instanceof Error?err.message:'Failed to load.');setStatus('error')}
      }
    }

    run()
    const layerMap = kmlLayerMap.current
    return ()=>{
      cancelled=true; mapRef.current?.remove(); mapRef.current=null
      layerMap.clear()
    }
  }, [fileId, fileName])

  // ── Fly to feature / annotation ──────────────────────────────────────────────
  // Save note for selected feature
  function saveNote() {
    if (!selectedFeature) return
    const data: FeatureNote = { note: noteText.trim(), status: noteStatus, updatedAt: new Date().toISOString() }
    saveFeatureNote(fileId, selectedFeature.id, data.note || data.status !== 'none' ? data : null)
    setFeatureNotes(loadFeatureNotes(fileId))
    setNoteSaved(true)
    setTimeout(() => setNoteSaved(false), 2000)
  }

  // Delete a callout note with 5-second undo
  function deleteCalloutNote(featureId: string, note: FeatureNote) {
    noteUndoRef.current = { featureId, note }
    if (noteUndoTimer.current) clearTimeout(noteUndoTimer.current)
    saveFeatureNote(fileId, featureId, null)
    setFeatureNotes(loadFeatureNotes(fileId))
    setEditingCalloutId(null)
    setNoteUndoVisible(true)
    noteUndoTimer.current = setTimeout(() => {
      setNoteUndoVisible(false)
      noteUndoRef.current = null
    }, 5000)
  }

  function undoNoteDelete() {
    const entry = noteUndoRef.current
    if (!entry) return
    saveFeatureNote(fileId, entry.featureId, entry.note)
    setFeatureNotes(loadFeatureNotes(fileId))
    setNoteUndoVisible(false)
    noteUndoRef.current = null
    if (noteUndoTimer.current) clearTimeout(noteUndoTimer.current)
  }

  const flyTo = (f: KmlFeature) => {
    setActiveFeature(f); const map=mapRef.current; if(!map||f.coords.length===0) return
    if(f.type==='point') map.flyTo(f.coords[0],17,{duration:0.8})
    else map.flyToBounds(f.coords,{padding:[60,60],maxZoom:19,duration:0.8})
  }

  const flyToAnnot = (ann: KmzAnnotation) => {
    const map=mapRef.current; if(!map||ann.coords.length===0) return
    if(ann.coords.length===1) map.flyTo(ann.coords[0],17,{duration:0.8})
    else map.flyToBounds(ann.coords,{padding:[60,60],maxZoom:19,duration:0.8})
  }

  // ── PDF Export ───────────────────────────────────────────────────────────────
  async function exportToPdf() {
    const el=containerRef.current; if(!el||exporting) return
    setExporting(true)
    try {
      const [{default:html2canvas},{jsPDF}]=await Promise.all([import('html2canvas'),import('jspdf')])
      const canvas=await html2canvas(el,{useCORS:true,allowTaint:false,logging:false,backgroundColor:'#1a1a1a',scale:window.devicePixelRatio??1})
      const mapImgData=canvas.toDataURL('image/png'),mapW=canvas.width,mapH=canvas.height
      const landscape=mapW>=mapH
      const pdf=new jsPDF({orientation:landscape?'landscape':'portrait',unit:'pt',format:'letter'})
      const pageW=pdf.internal.pageSize.getWidth(),pageH=pdf.internal.pageSize.getHeight(),margin=36
      pdf.setFont('helvetica','bold');pdf.setFontSize(13);pdf.text(fileName,margin,margin+13)
      pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(120,120,120)
      pdf.text(`Fiberlytic Redline Export  ·  ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`,margin,margin+26)
      pdf.setTextColor(0,0,0)
      const headerBottom=margin+40,availW=pageW-margin*2,availH=pageH-headerBottom-margin
      const imgRatio=mapW/mapH,boxRatio=availW/availH
      let imgW: number,imgH: number
      if(imgRatio>boxRatio){imgW=availW;imgH=availW/imgRatio}else{imgH=availH;imgW=availH*imgRatio}
      pdf.addImage(mapImgData,'PNG',margin+(availW-imgW)/2,headerBottom,imgW,imgH)
      if(annotations.length>0){
        pdf.addPage()
        pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.text('Redline Notes',margin,margin+11)
        pdf.setFont('helvetica','normal');pdf.setFontSize(9);let y=margin+28
        annotations.forEach((ann,i)=>{
          const label=ann.text||'(unlabeled)'
          pdf.setFillColor(ann.color);pdf.rect(margin,y-6,7,7,'F');pdf.setFillColor(0,0,0)
          pdf.text(`${i+1}.  [${ann.tool}]  ${label}`,margin+12,y);y+=14
          if(y>pageH-margin){pdf.addPage();y=margin+14}
        })
      }
      pdf.save(`${fileName.replace(/\.(kmz|kml)$/i,'')}_redline.pdf`)
    } catch(err){console.error('PDF export error',err);alert('Export failed — please try again.')}
    finally{setExporting(false)}
  }

  // ── Sidebar data ─────────────────────────────────────────────────────────────
  const groups = features.reduce<Map<string,KmlFeature[]>>((acc,f)=>{
    const key=f.folder||'(root)'; if(!acc.has(key))acc.set(key,[]); acc.get(key)!.push(f); return acc
  }, new Map())

  const counts={
    line:features.filter(f=>f.type==='line').length,
    point:features.filter(f=>f.type==='point').length,
    polygon:features.filter(f=>f.type==='polygon').length,
    overlay:features.filter(f=>f.type==='overlay').length,
  }

  const annotsByDate = annotations.reduce<Map<string,KmzAnnotation[]>>((acc,a)=>{
    const label=new Date(a.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
    if(!acc.has(label))acc.set(label,[]); acc.get(label)!.push(a); return acc
  }, new Map())

  // ── Derived UI flags ─────────────────────────────────────────────────────────
  const isDrawTool   = tool !== 'select'
  const isTextTool   = TEXT_TOOLS.includes(tool as AnnotationTool)
  const isFillTool   = FILL_TOOLS.includes(tool as AnnotationTool)
  const isLineTool   = LINE_STYLE_TOOLS.includes(tool as AnnotationTool)
  const isMultiMode  = tool==='polyline' || tool==='polygon'
  const isSelecting  = tool==='select'

  // Draft pixel ShapeData for live preview
  const draftShapeData: ShapeData|null = draft ? {
    tool: tool as AnnotationTool, color, strokeWidth: width,
    lineStyle: lineStyle!=='solid'?lineStyle:undefined,
    x1:draft.x1, y1:draft.y1, x2:draft.x2, y2:draft.y2,
    fillColor: isFillTool&&tool!=='highlight' ? fillColor : undefined,
    fillOpacity: isFillTool ? fillOpacity : undefined,
    opacity: shapeOpacity<0.99?shapeOpacity:undefined,
  } : null

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0d0d0d]">

      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#2a2a2a] bg-[#141414] px-4">
        <div className="flex items-center gap-2">
          <MapPin size={15} className="text-emerald-400" />
          <span className="text-sm font-semibold text-slate-200">{fileName}</span>
          {status==='ready' && (
            <span className="ml-2 text-xs text-slate-500">
              {[counts.line>0&&`${counts.line}L`,counts.point>0&&`${counts.point}P`,counts.polygon>0&&`${counts.polygon}Poly`,counts.overlay>0&&`${counts.overlay}Img`].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {status==='ready' && (
            <button onClick={exportToPdf} disabled={exporting} title="Export as PDF"
              className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-emerald-400 border border-emerald-800/60 hover:bg-emerald-900/30 transition disabled:opacity-40">
              <FileDown size={13}/>{exporting?'Exporting…':'Export PDF'}
            </button>
          )}
          {diagLines.length>0 && (
            <button onClick={()=>setShowDiag(v=>!v)} title="Diagnostic info"
              className="rounded px-2 py-1 text-[10px] font-mono text-slate-500 hover:bg-white/8 hover:text-slate-300 transition border border-[#2a2a2a]">?</button>
          )}
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-white/8 hover:text-slate-200 transition"><X size={18}/></button>
        </div>
      </div>

      {/* Diagnostic panel */}
      {showDiag && (
        <div className="shrink-0 max-h-64 overflow-y-auto border-b border-[#2a2a2a] bg-[#0a0a0a] p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-400">KMZ Diagnostic</p>
          <pre className="whitespace-pre-wrap text-[10px] font-mono text-slate-400 leading-relaxed">{diagLines.join('\n')}</pre>
        </div>
      )}

      {/* Multi-point instruction bar */}
      {isMultiMode && status==='ready' && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-blue-900/40 bg-blue-950/40 px-4 py-1.5 text-xs text-blue-300">
          <span>
            {multiPts.length===0
              ? `Click to start your ${tool}`
              : `${multiPts.length} point${multiPts.length>1?'s':''} — click to add more · double-click or press Enter to finish`}
          </span>
          {multiPts.length>=2 && (
            <button onClick={finishMultiPt} className="rounded bg-blue-700 px-2.5 py-1 text-white font-medium hover:bg-blue-600">
              <Check size={11} className="inline mr-1"/>Finish
            </button>
          )}
          {multiPts.length>0 && (
            <button onClick={()=>{setMultiPts([]);setMultiPxPts([]);setMultiPreviewPx(null)}} className="text-blue-400 hover:text-blue-200">Cancel</button>
          )}
        </div>
      )}

      {/* Body */}
      <div className="relative flex flex-1 overflow-hidden">

        {/* Map + SVG overlay */}
        <div className="relative flex-1">
          {status==='loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 size={32} className="animate-spin text-emerald-500"/>
              <p className="text-sm">Loading {fileName}…</p>
            </div>
          )}
          {status==='error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
              <AlertCircle size={32} className="text-rose-500"/>
              <p className="text-sm font-medium text-slate-300">Could not display this file</p>
              <p className="text-xs text-slate-500 max-w-sm">{errorMsg}</p>
            </div>
          )}

          {/* Feature info + notes panel */}
          {selectedFeature && (
            <div className="absolute bottom-0 left-0 right-0 z-[500] border-t border-[#2a2a2a] bg-[#141414]/95 backdrop-blur-sm shadow-2xl"
              style={{maxHeight:'50%',display:'flex',flexDirection:'column'}}>
              {/* Panel header */}
              <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-[#2a2a2a]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      selectedFeature.type==='line'    ? 'bg-blue-900/50 text-blue-300' :
                      selectedFeature.type==='polygon' ? 'bg-emerald-900/50 text-emerald-300' :
                      selectedFeature.type==='point'   ? 'bg-amber-900/50 text-amber-300' :
                                                         'bg-slate-800 text-slate-400'
                    }`}>{selectedFeature.type}</span>
                    {featureNotes[selectedFeature.id] && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        featureNotes[selectedFeature.id].status==='complete'    ? 'bg-emerald-900/50 text-emerald-300' :
                        featureNotes[selectedFeature.id].status==='in-progress' ? 'bg-amber-900/50 text-amber-300' :
                                                                                  'bg-slate-800 text-slate-500'
                      }`}>{featureNotes[selectedFeature.id].status.replace('-',' ')}</span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-100 truncate">{selectedFeature.name}</p>
                  {selectedFeature.description && (
                    <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{selectedFeature.description}</p>
                  )}
                </div>
                <button onClick={()=>setSelectedFeature(null)} className="shrink-0 rounded p-1 text-slate-500 hover:text-slate-200 transition mt-0.5">
                  <X size={14}/>
                </button>
              </div>

              {/* Notes body */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {/* Status */}
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Work Status</p>
                  <div className="flex gap-1.5">
                    {([
                      {val:'none'        as const, label:'Not Started', cls:'text-slate-400 bg-slate-800/60 hover:bg-slate-700/60'},
                      {val:'in-progress' as const, label:'In Progress',  cls:'text-amber-300 bg-amber-900/40 hover:bg-amber-900/60'},
                      {val:'complete'    as const, label:'Complete',     cls:'text-emerald-300 bg-emerald-900/40 hover:bg-emerald-900/60'},
                    ]).map(s=>(
                      <button key={s.val} onClick={()=>{setNoteStatus(s.val);setNoteSaved(false)}}
                        className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ring-2 ${noteStatus===s.val?'ring-white/30':'ring-transparent'} ${s.cls}`}>
                        {s.val==='complete'?'✓ ':''}{s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes textarea */}
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Field Notes</p>
                  <textarea
                    value={noteText}
                    onChange={e=>{setNoteText(e.target.value);setNoteSaved(false)}}
                    placeholder="Add notes about completed work, conditions, footage, issues…"
                    rows={4}
                    className="w-full resize-none rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none leading-relaxed"
                  />
                </div>

                {/* Timestamp of last save */}
                {featureNotes[selectedFeature.id]?.updatedAt && (
                  <p className="text-[10px] text-slate-600">
                    Last updated {new Date(featureNotes[selectedFeature.id].updatedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
                  </p>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex shrink-0 items-center justify-between border-t border-[#2a2a2a] px-4 py-2.5">
                <button
                  onClick={()=>{setNoteText('');setNoteStatus('none');saveFeatureNote(fileId,selectedFeature.id,null);setFeatureNotes(loadFeatureNotes(fileId));setNoteSaved(false)}}
                  className="text-xs text-slate-600 hover:text-rose-400 transition">
                  Clear notes
                </button>
                <button onClick={saveNote}
                  className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition ${
                    noteSaved ? 'bg-emerald-700 text-white' : 'bg-emerald-600 text-white hover:bg-emerald-500'
                  }`}>
                  {noteSaved ? <><Check size={11}/>Saved</> : 'Save Notes'}
                </button>
              </div>
            </div>
          )}

          {/* Leaflet map container */}
          <div ref={containerRef} className="relative h-full w-full" style={{visibility:status==='ready'?'visible':'hidden'}}>

            {/* SVG annotation overlay */}
            {status==='ready' && (
              <svg
                ref={svgRef}
                style={{
                  position:'absolute', inset:0, width:'100%', height:'100%',
                  zIndex:1000,
                  pointerEvents: isSelecting ? 'none' : 'all',
                  cursor: isSelecting ? undefined : (isTextTool&&tool!=='pin' ? 'text' : 'crosshair'),
                  touchAction:'none',
                }}
                data-view-ver={mapViewVer}
                onPointerDown={isDrawTool ? onSvgPointerDown : undefined}
                onPointerMove={isDrawTool ? onSvgPointerMove : undefined}
                onPointerUp={isDrawTool ? onSvgPointerUp : undefined}
                onPointerLeave={isDrawTool ? onSvgPointerUp : undefined}
              >
                {/* Committed annotations */}
                {annotations.filter(a=>a.visible!==false).map(ann => {
                  const sd = annToShapeData(ann)
                  const content = renderShapeContent(sd)
                  const isSelected = ann.id===selectedAnnotId
                  const bounds = isSelected ? shapeBounds(sd) : null
                  return (
                    <g key={ann.id}
                       style={{pointerEvents: isSelecting ? 'all' : 'none', cursor: isSelecting ? 'pointer' : undefined}}
                       onClick={isSelecting ? (e)=>{e.stopPropagation();setSelectedAnnotId(ann.id)} : undefined}
                       onMouseDown={isSelecting ? (e)=>e.stopPropagation() : undefined}
                    >
                      {content}
                      {isSelected && bounds && (
                        <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h}
                          fill="none" stroke="#10b981" strokeWidth={2} strokeDasharray="6 3" rx={3} pointerEvents="none"/>
                      )}
                    </g>
                  )
                })}

                {/* Pen preview */}
                {drawing && tool==='pen' && penPts.length>1 && (
                  <path d={ptsToPath(penPts)} stroke={color} strokeWidth={width} fill="none"
                    strokeLinecap="round" strokeLinejoin="round" opacity={shapeOpacity}/>
                )}

                {/* Drag-to-draw draft */}
                {draftShapeData && renderShapeContent(draftShapeData)}

                {/* Multi-point preview */}
                {isMultiMode && multiPxPts.length>0 && (
                  <g>
                    <path d={ptsToPath(multiPreviewPx ? [...multiPxPts,multiPreviewPx] : multiPxPts)}
                      stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round"
                      strokeDasharray={dashArray(lineStyle!=='solid'?lineStyle:'dashed',width)??"6 3"} opacity={0.75}/>
                    {tool==='polygon' && multiPreviewPx && multiPxPts.length>=2 && (
                      <line x1={multiPreviewPx[0]} y1={multiPreviewPx[1]} x2={multiPxPts[0][0]} y2={multiPxPts[0][1]}
                        stroke={color} strokeWidth={width} strokeDasharray="4 4" opacity={0.4}/>
                    )}
                    {multiPxPts.map(([x,y],i)=>(
                      <circle key={i} cx={x} cy={y} r={3} fill={color} stroke="white" strokeWidth={1}/>
                    ))}
                  </g>
                )}
              </svg>
            )}
          </div>{/* end Leaflet container */}

            {/* Choice popup — appears when clicking a KML feature */}
            {clickPopup && status === 'ready' && (() => {
              const f = clickPopup.feature
              const hasNote = !!(featureNotes[f.id]?.note || featureNotes[f.id]?.status !== 'none')
              return (
                <>
                  {/* Transparent dismiss layer */}
                  <div style={{ position:'absolute', inset:0, zIndex:610 }} onClick={() => setClickPopup(null)}/>
                  <div
                    style={{
                      position:'absolute', left: clickPopup.x + 8, top: clickPopup.y - 20,
                      zIndex:620, background:'#1a1a1a', border:'1px solid #374151',
                      borderRadius:8, padding:'8px 10px', boxShadow:'0 6px 24px rgba(0,0,0,0.8)',
                      minWidth:160, pointerEvents:'all',
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <p style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:180 }}>
                      {f.name || f.type}
                    </p>
                    <div style={{ display:'flex', gap:6 }}>
                      <button
                        onClick={() => {
                          setSelectedFeature(f)
                          const existing = loadFeatureNotes(fileId)[f.id]
                          setNoteText(existing?.note ?? '')
                          setNoteStatus(existing?.status ?? 'none')
                          setNoteSaved(false)
                          setClickPopup(null)
                        }}
                        style={{ flex:1, padding:'5px 0', fontSize:11, fontWeight:600, color:'#94a3b8', background:'#262626', border:'1px solid #374151', borderRadius:5, cursor:'pointer' }}
                      >View Info</button>
                      <button
                        onClick={() => {
                          if (!featureNotes[f.id]) {
                            const ll = mapRef.current?.containerPointToLatLng([clickPopup.x, clickPopup.y])
                            const centroid: [number,number] | undefined = ll ? [ll.lat, ll.lng] : undefined
                            const empty: FeatureNote = { note:'', status:'none', updatedAt: new Date().toISOString(), centroid }
                            saveFeatureNote(fileId, f.id, empty)
                            setFeatureNotes(loadFeatureNotes(fileId))
                          }
                          setEditingCalloutId(f.id)
                          setEditingCalloutText(featureNotes[f.id]?.note ?? '')
                          setClickPopup(null)
                        }}
                        style={{ flex:1, padding:'5px 0', fontSize:11, fontWeight:600, color:'#10b981', background:'#052e16', border:'1px solid #166534', borderRadius:5, cursor:'pointer' }}
                      >{hasNote ? 'Edit Note' : 'Add Note'}</button>
                    </div>
                  </div>
                </>
              )
            })()}

            {/* Resizable note panels — fixed pixel size, hidden below zoom 12 to avoid looking huge */}
            {status === 'ready' && (mapRef.current?.getZoom() ?? 0) >= 12 && features.filter(f => {
              const n = featureNotes[f.id]; return n && f.coords.length > 0
            }).map(f => {
              const note = featureNotes[f.id]
              const [cx, cy] = latlngToPixel(note.centroid ?? getCentroid(f))
              const panelW = note.boxW ?? 220
              const panelH = note.boxH ?? 110
              const borderColor = note.status === 'complete' ? '#34d399' : note.status === 'in-progress' ? '#fbbf24' : '#64748b'
              const isEditing = editingCalloutId === f.id
              return (
                <div key={f.id}>
                  {/* Anchor dot at the feature centroid */}
                  <div style={{
                    position:'absolute', left: cx - 5, top: cy - 5,
                    width:10, height:10, borderRadius:'50%',
                    background: borderColor, border:'2px solid #141414',
                    pointerEvents:'none', zIndex:598,
                  }}/>

                  {/* Resizable note panel */}
                  <div
                    style={{
                      position:'absolute',
                      left: cx - panelW / 2,
                      top: cy - panelH - 18,
                      width: panelW, height: panelH,
                      minWidth:160, minHeight:80,
                      resize:'both', overflow:'hidden',
                      background:'rgba(14,14,14,0.97)',
                      border:`1.5px solid ${borderColor}`,
                      borderRadius:6,
                      boxShadow:'0 4px 20px rgba(0,0,0,0.75)',
                      backdropFilter:'blur(8px)',
                      pointerEvents:'all', zIndex:600,
                      display:'flex', flexDirection:'column',
                    }}
                    onClick={e => e.stopPropagation()}
                    onMouseUp={e => {
                      const el = e.currentTarget
                      const w = el.offsetWidth, h = el.offsetHeight
                      if (w !== panelW || h !== panelH) {
                        saveFeatureNote(fileId, f.id, { ...note, boxW: w, boxH: h })
                        setFeatureNotes(loadFeatureNotes(fileId))
                      }
                    }}
                  >
                    {/* Header */}
                    <div style={{
                      display:'flex', alignItems:'center', gap:5, padding:'4px 7px 4px 8px',
                      borderBottom:`1px solid ${borderColor}33`, flexShrink:0,
                      background:'rgba(255,255,255,0.03)',
                    }}>
                      <span style={{ width:7, height:7, borderRadius:'50%', background:borderColor, flexShrink:0 }}/>
                      <span style={{ flex:1, fontSize:10, fontWeight:600, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {f.name || f.type}
                      </span>
                      {isEditing ? (
                        <button
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            const trimmed = editingCalloutText.trim()
                            const updated: FeatureNote = { ...note, note: trimmed, updatedAt: new Date().toISOString() }
                            saveFeatureNote(fileId, f.id, trimmed || note.status !== 'none' ? updated : null)
                            setFeatureNotes(loadFeatureNotes(fileId))
                            setEditingCalloutId(null)
                          }}
                          style={{ fontSize:10, fontWeight:700, color:'#10b981', background:'none', border:'none', cursor:'pointer', padding:'0 2px', flexShrink:0 }}
                        >Save</button>
                      ) : (
                        <button
                          onClick={() => { setSelectedFeature(f); setNoteText(note.note); setNoteStatus(note.status); setNoteSaved(false) }}
                          style={{ fontSize:10, color:'#4b5563', background:'none', border:'none', cursor:'pointer', padding:'0 2px', flexShrink:0 }}
                          title="View full info"
                        >⋯</button>
                      )}
                      <button
                        onClick={() => deleteCalloutNote(f.id, note)}
                        style={{ fontSize:14, lineHeight:1, color:'#4b5563', background:'none', border:'none', cursor:'pointer', padding:'0 1px', flexShrink:0 }}
                        title="Delete note"
                      >×</button>
                    </div>

                    {/* Body — textarea in edit mode, scrollable text in view mode */}
                    {isEditing ? (
                      <textarea
                        autoFocus
                        value={editingCalloutText}
                        onChange={e => setEditingCalloutText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setEditingCalloutId(null)
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            const trimmed = editingCalloutText.trim()
                            const updated: FeatureNote = { ...note, note: trimmed, updatedAt: new Date().toISOString() }
                            saveFeatureNote(fileId, f.id, trimmed || note.status !== 'none' ? updated : null)
                            setFeatureNotes(loadFeatureNotes(fileId))
                            setEditingCalloutId(null)
                          }
                        }}
                        placeholder="Type your note here…"
                        style={{
                          flex:1, width:'100%', background:'transparent', border:'none', outline:'none',
                          color:'#e2e8f0', fontSize:12, lineHeight:1.5, resize:'none',
                          fontFamily:'inherit', padding:'6px 8px', display:'block',
                        }}
                      />
                    ) : (
                      <div
                        onClick={() => { setEditingCalloutId(f.id); setEditingCalloutText(note.note) }}
                        style={{
                          flex:1, padding:'6px 8px', overflowY:'auto', cursor:'text',
                          color: note.note ? '#cbd5e1' : '#374151',
                          fontSize:12, lineHeight:1.5,
                          whiteSpace:'pre-wrap', wordBreak:'break-word',
                          fontStyle: note.note ? 'normal' : 'italic',
                        }}
                      >
                        {note.note || 'Click to add a note…'}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Undo toast — 5 s after a note is deleted */}
            {noteUndoVisible && (
              <div style={{
                position:'absolute', bottom:20, left:'50%', transform:'translateX(-50%)',
                zIndex:700, display:'flex', alignItems:'center', gap:10,
                background:'#1e1e1e', border:'1px solid #374151', borderRadius:8,
                padding:'8px 14px', boxShadow:'0 4px 20px rgba(0,0,0,0.6)',
                pointerEvents:'all',
              }}>
                <span style={{ fontSize:12, color:'#94a3b8' }}>Note deleted</span>
                <button onClick={undoNoteDelete}
                  style={{ fontSize:12, fontWeight:700, color:'#10b981', background:'none', border:'none', cursor:'pointer', padding:0 }}>
                  Undo
                </button>
              </div>
            )}

            {/* Text input popup */}
            {textInput.visible && (
              <div className="absolute z-[1100] flex flex-col gap-1.5 rounded-md border border-emerald-500 bg-[#141414] p-2.5 shadow-xl"
                style={{left:textInput.screenX+12, top:textInput.screenY-12, minWidth:200}}>
                <p className="text-[10px] text-slate-400">{tool==='callout'?'Callout text':'Label'}</p>
                <input ref={textRef} autoFocus placeholder="Type then press Enter"
                  className="w-full rounded bg-[#0d0d0d] px-2 py-1 text-sm text-slate-200 outline-none ring-1 ring-[#2a2a2a] focus:ring-emerald-500"
                  onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitText()}if(e.key==='Escape')setTextInput({visible:false})}}
                  onBlur={commitText}
                />
                <div className="flex gap-1">
                  <button onClick={commitText} className="flex-1 rounded bg-emerald-700 py-0.5 text-xs font-medium text-white hover:bg-emerald-600 transition">Place</button>
                  <button onClick={()=>setTextInput({visible:false})} className="flex-1 rounded bg-white/8 py-0.5 text-xs text-slate-400 hover:text-slate-200 transition">Cancel</button>
                </div>
              </div>
            )}
        </div>

        {/* Sidebar */}
        {status==='ready' && (
          <div className="flex flex-col border-l border-[#2a2a2a] bg-[#141414] overflow-hidden transition-all duration-200"
            style={{width: panelOpen ? 268 : 0}}>

            {/* Tab switcher */}
            <div className="flex shrink-0 border-b border-[#2a2a2a]">
              <button onClick={()=>setShowAnnotTab(true)}
                className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-widest transition ${showAnnotTab?'text-emerald-400 border-b border-emerald-500':'text-slate-500 hover:text-slate-300'}`}>
                ✏ Redline{annotations.length>0&&` (${annotations.length})`}
              </button>
              <button onClick={()=>setShowAnnotTab(false)}
                className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-widest transition ${!showAnnotTab?'text-emerald-400 border-b border-emerald-500':'text-slate-500 hover:text-slate-300'}`}>
                Layers
              </button>
            </div>

            {/* ── LAYERS TAB ── */}
            {!showAnnotTab && (
              <div className="flex-1 overflow-y-auto">
                {[...groups.entries()].map(([folder,items])=>(
                  <div key={folder} className="mb-1">
                    <p className="px-3 pt-2 pb-0.5 text-[9px] font-semibold uppercase tracking-widest text-slate-600">{folder}</p>
                    {items.map(f=>{
                      const hidden=hiddenIds.has(f.id)
                      return(
                        <div key={f.id}
                          className={`group flex items-center justify-between border-b border-[#1e1e1e] transition ${activeFeature?.id===f.id?'bg-emerald-900/20':''} ${hidden?'opacity-40':''}`}>
                          <button className="flex flex-1 items-center gap-2 px-3 py-2 text-left" onClick={()=>flyTo(f)}>
                            <span className="relative shrink-0">
                              <span className="block h-2.5 w-2.5 rounded-sm" style={{background:f.style.color}}/>
                              {featureNotes[f.id] && (
                                <span className={`absolute -right-1 -top-1 h-2 w-2 rounded-full border border-[#141414] ${featureNotes[f.id].status==='complete'?'bg-emerald-400':featureNotes[f.id].status==='in-progress'?'bg-amber-400':'bg-slate-500'}`}/>
                              )}
                            </span>
                            <span className="min-w-0 truncate text-[11px] text-slate-300">{f.name}</span>
                          </button>
                          <button onClick={()=>setHiddenIds(prev=>{const n=new Set(prev);hidden?n.delete(f.id):n.add(f.id);return n})}
                            className="shrink-0 p-1.5 pr-3 text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition" title={hidden?'Show':'Hide'}>
                            {hidden?<Eye size={11}/>:<EyeOff size={11}/>}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}
                {hiddenIds.size>0 && (
                  <button onClick={()=>setHiddenIds(new Set())} className="w-full py-2 text-[11px] text-slate-600 hover:text-emerald-400 transition">
                    Restore {hiddenIds.size} hidden feature{hiddenIds.size!==1?'s':''}
                  </button>
                )}
              </div>
            )}

            {/* ── REDLINE TAB ── */}
            {showAnnotTab && (
              <div className="flex flex-col flex-1 overflow-hidden">

                {/* Select + Draw tools */}
                <div className="shrink-0 border-b border-[#2a2a2a] p-3">
                  <p className={SL}>Tool</p>
                  {/* Select button */}
                  <button onClick={()=>setTool('select')}
                    className={`mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition ${isSelecting?activeBtn:inactiveBtn}`}>
                    <MousePointer2 size={13}/> Select / Edit
                  </button>
                  {/* Draw tool grid */}
                  <div className="grid grid-cols-3 gap-1">
                    {DRAW_TOOLS.map(t=>(
                      <button key={t.id} title={t.label} onClick={()=>setTool(t.id)}
                        className={`flex flex-col items-center gap-0.5 rounded-md px-1 py-2 text-[10px] font-medium transition ${tool===t.id?activeBtn:inactiveBtn}`}>
                        {t.icon}<span className="leading-none">{t.label.split(' ')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color palette */}
                <div className="shrink-0 border-b border-[#2a2a2a] p-3">
                  <p className={SL}>Color</p>
                  <div className="grid grid-cols-7 gap-1">
                    {COLORS.map(c=>(
                      <button key={c} title={c} onClick={()=>{setColor(c);if(selectedAnnotId)patchAnnot(selectedAnnotId,{color:c})}}
                        style={{backgroundColor:c,outline:(c==='#f9fafb'||c==='#d1d5db')?'1px solid #475569':undefined}}
                        className={`h-5 w-5 rounded-sm transition-transform ${color===c?'scale-125 ring-2 ring-white ring-offset-[#141414] ring-offset-1':'hover:scale-110 opacity-80 hover:opacity-100'}`}/>
                    ))}
                  </div>
                </div>

                {/* Stroke + line style */}
                {(isDrawTool&&!isTextTool)||(selectedAnnot&&!TEXT_TOOLS.includes(selectedAnnot.tool)) ? (
                  <div className="shrink-0 border-b border-[#2a2a2a] p-3 space-y-3">
                    {/* Width */}
                    <div>
                      <p className={SL}>Stroke</p>
                      <div className="flex gap-1">
                        {WIDTHS.map(w=>(
                          <button key={w.value} title={w.label} onClick={()=>{setWidth(w.value);if(selectedAnnotId)patchAnnot(selectedAnnotId,{strokeWidth:w.value})}}
                            className={`flex flex-1 items-center justify-center rounded-md py-2 transition ${width===w.value?activeBtn:inactiveBtn}`}>
                            <div className="rounded-full bg-current" style={{width:Math.min(w.value*3,20),height:Math.min(w.value*3,20)}}/>
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Line style */}
                    {(isLineTool||(selectedAnnot&&LINE_STYLE_TOOLS.includes(selectedAnnot.tool))) && (
                      <div>
                        <p className={SL}>Line Style</p>
                        <div className="flex gap-1">
                          {LINE_STYLES.map(ls=>(
                            <button key={ls.value} title={ls.value} onClick={()=>{setLineStyle(ls.value as 'solid'|'dashed'|'dotted');if(selectedAnnotId)patchAnnot(selectedAnnotId,{lineStyle:ls.value!=='solid'?ls.value as 'dashed'|'dotted':undefined})}}
                              className={`flex flex-1 items-center justify-center rounded-md py-1.5 font-mono text-xs transition ${lineStyle===ls.value?activeBtn:inactiveBtn}`}>
                              {ls.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Properties panel */}
                {(selectedAnnot || (isDrawTool && (isTextTool || isFillTool))) && (
                  <div className="shrink-0 border-b border-[#2a2a2a] p-3">

                    {/* Selected header */}
                    {selectedAnnot && (
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold capitalize text-slate-300">{selectedAnnot.tool} selected</p>
                        <button onClick={()=>deleteAnnot(selectedAnnotId!)}
                          className="flex items-center gap-1 rounded bg-rose-900/40 px-2 py-0.5 text-[10px] font-medium text-rose-400 hover:bg-rose-900/60">
                          <Trash2 size={10}/> Delete
                        </button>
                      </div>
                    )}

                    {/* Pin label */}
                    {selectedAnnot?.tool==='pin' && (
                      <div className="mb-3">
                        <p className={SL}>Label</p>
                        <input type="text" value={selectedAnnot.text??''} onChange={e=>patchAnnot(selectedAnnotId!,{text:e.target.value})}
                          placeholder="Pin label…"
                          className="h-7 w-full rounded border border-[#2a2a2a] bg-[#0d0d0d] px-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"/>
                      </div>
                    )}

                    {/* Text style */}
                    {((isTextTool&&tool!=='pin')||(selectedAnnot&&TEXT_TOOLS.includes(selectedAnnot.tool)&&selectedAnnot.tool!=='pin')) && (
                      <>
                        <p className={SL}>Text Style</p>
                        <select value={fontFamily} onChange={e=>{setFontFamily(e.target.value);if(selectedAnnotId)patchAnnot(selectedAnnotId,{fontFamily:e.target.value})}}
                          className="mb-1.5 h-7 w-full rounded border border-[#2a2a2a] bg-[#0d0d0d] px-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none">
                          {FONT_FAMILIES.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        <select value={fontSize} onChange={e=>{setFontSize(Number(e.target.value));if(selectedAnnotId)patchAnnot(selectedAnnotId,{fontSize:Number(e.target.value)})}}
                          className="mb-2 h-7 w-full rounded border border-[#2a2a2a] bg-[#0d0d0d] px-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none">
                          {FONT_SIZES.map(s=><option key={s} value={s}>{s}pt</option>)}
                        </select>
                        <div className="flex gap-1">
                          {([
                            {icon:<Bold size={11}/>,    active:fontBold,          fn:()=>{const v=!fontBold;setFontBold(v);if(selectedAnnotId)patchAnnot(selectedAnnotId,{fontBold:v||undefined})},         title:'Bold'},
                            {icon:<Italic size={11}/>,  active:fontItalic,        fn:()=>{const v=!fontItalic;setFontItalic(v);if(selectedAnnotId)patchAnnot(selectedAnnotId,{fontItalic:v||undefined})},     title:'Italic'},
                            {icon:<Underline size={11}/>,active:fontUnderline,   fn:()=>{const v=!fontUnderline;setFontUnderline(v);if(selectedAnnotId)patchAnnot(selectedAnnotId,{fontUnderline:v||undefined})},title:'Underline'},
                            {icon:<Strikethrough size={11}/>,active:fontStrikethrough,fn:()=>{const v=!fontStrikethrough;setFontStrikethrough(v);if(selectedAnnotId)patchAnnot(selectedAnnotId,{fontStrikethrough:v||undefined})},title:'Strikethrough'},
                          ] as const).map(({icon,active,fn,title})=>(
                            <button key={title} title={title} onClick={fn}
                              className={`flex flex-1 items-center justify-center rounded py-1.5 transition ${active?activeBtn:inactiveBtn}`}>
                              {icon}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Fill */}
                    {(isFillTool||(selectedAnnot&&FILL_TOOLS.includes(selectedAnnot.tool))) && (
                      <div className="mt-3">
                        <p className={SL}>Fill</p>
                        {(tool!=='highlight'&&selectedAnnot?.tool!=='highlight') && (
                          <label className="mb-2 flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                            <span className="relative flex h-7 w-7 shrink-0 overflow-hidden rounded border border-[#2a2a2a]" style={{background:fillColor}}>
                              <input type="color" value={fillColor} onChange={e=>{setFillColor(e.target.value);if(selectedAnnotId)patchAnnot(selectedAnnotId,{fillColor:e.target.value})}}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/>
                            </span>
                            Fill color
                          </label>
                        )}
                        <label className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="w-12 shrink-0">Opacity</span>
                          <input type="range" min="0" max="100" value={Math.round(fillOpacity*100)}
                            onChange={e=>{const v=Number(e.target.value)/100;setFillOpacity(v);if(selectedAnnotId)patchAnnot(selectedAnnotId,{fillOpacity:v})}}
                            className="h-1.5 flex-1 cursor-pointer accent-emerald-600"/>
                          <span className="w-8 text-right">{Math.round(fillOpacity*100)}%</span>
                        </label>
                      </div>
                    )}

                    {/* Shape opacity */}
                    {(isDrawTool||selectedAnnot)&&tool!=='pen' && (
                      <div className="mt-3">
                        <p className={SL}>Opacity</p>
                        <label className="flex items-center gap-2 text-xs text-slate-500">
                          <input type="range" min="10" max="100" value={Math.round(shapeOpacity*100)}
                            onChange={e=>{const v=Number(e.target.value)/100;setShapeOpacity(v);if(selectedAnnotId)patchAnnot(selectedAnnotId,{opacity:v})}}
                            className="h-1.5 flex-1 cursor-pointer accent-emerald-600"/>
                          <span className="w-8 text-right">{Math.round(shapeOpacity*100)}%</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* Annotation list */}
                <div className="flex-1 overflow-y-auto">
                  {/* Undo/redo */}
                  {annotations.length>0 && (
                    <div className="flex items-center gap-1 border-b border-[#1e1e1e] px-3 py-1.5">
                      <button onClick={doUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
                        className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-500 hover:text-slate-200 disabled:opacity-30 transition">
                        <Undo2 size={11}/> Undo
                      </button>
                      <button onClick={doRedo} disabled={!canRedo} title="Redo"
                        className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-500 hover:text-slate-200 disabled:opacity-30 transition">
                        <Redo2 size={11}/> Redo
                      </button>
                    </div>
                  )}

                  {annotations.length===0 ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                      <Pen size={22} className="text-slate-600"/>
                      <p className="text-xs text-slate-500">No redline marks yet.</p>
                      <p className="text-[11px] text-slate-600">Pick a tool and draw on the map.</p>
                    </div>
                  ) : (
                    [...annotsByDate.entries()].reverse().map(([dateStr,group])=>(
                      <div key={dateStr}>
                        <p className="px-3 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-600">{dateStr}</p>
                        {[...group].reverse().map(ann=>(
                          <div key={ann.id}
                            className={`group flex items-center border-b border-[#1e1e1e] hover:bg-white/5 transition ${selectedAnnotId===ann.id?'bg-emerald-900/20':''} ${ann.visible===false?'opacity-40':''}`}>
                            <button className="flex flex-1 items-center gap-2 px-3 py-2 text-left"
                              onClick={()=>{setTool('select');setSelectedAnnotId(ann.id);flyToAnnot(ann)}}>
                              <span className="h-3 w-3 shrink-0 rounded-sm" style={{background:ann.color}}/>
                              <div className="min-w-0">
                                <p className={`truncate text-xs font-medium ${selectedAnnotId===ann.id?'text-emerald-300':'text-slate-300'}`}>
                                  {ann.text||<em className="text-slate-500 font-normal">{ann.tool}</em>}
                                </p>
                              </div>
                            </button>
                            <button title={ann.visible===false?'Show':'Hide'}
                              onClick={()=>patchAnnot(ann.id,{visible:ann.visible===false?undefined:false})}
                              className="shrink-0 rounded p-1 text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition">
                              {ann.visible===false?<Eye size={11}/>:<EyeOff size={11}/>}
                            </button>
                            <button title="Delete" onClick={()=>deleteAnnot(ann.id)}
                              className="shrink-0 rounded p-1 pr-2 text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition">
                              <Trash2 size={11}/>
                            </button>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                  {annotations.length>0 && (
                    <button onClick={()=>{if(confirm('Delete all redline marks for this file?')){saveUndo(annotations);setAnnotations([])}}}
                      className="w-full py-2 text-[11px] text-slate-600 hover:text-rose-400 transition">
                      Clear all marks
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sidebar toggle */}
        {status==='ready' && (
          <button onClick={()=>setPanelOpen(v=>!v)}
            className="absolute top-1/2 z-10 -translate-y-1/2 rounded-l-md border border-r-0 border-[#2a2a2a] bg-[#141414] p-1 text-slate-500 hover:text-slate-300 transition"
            style={{right: panelOpen?268:0}}>
            {panelOpen?<ChevronRight size={14}/>:<ChevronLeft size={14}/>}
          </button>
        )}
      </div>
    </div>
  )
}
