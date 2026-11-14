import { useMemo } from 'react'
import { SCENE_LAYOUTS } from './sceneLayouts'
import type { SceneLayout, ScenePoint } from './sceneLayouts'
export { SCENE_LAYOUTS } from './sceneLayouts'
export type { SceneLayout, ScenePoint } from './sceneLayouts'

type SceneProps = { seed: string; backgroundId?: string; layouts?: SceneLayout[]; objectCount?: number; showPoints?: boolean }
const objectModules = import.meta.glob('./assets/objects/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string,string>
const campModules = import.meta.glob('./assets/objectsCamps/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string,string>
const backgroundModules = import.meta.glob('./assets/background/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string,string>
const entries = (modules: Record<string,string>) => Object.entries(modules).sort(([a],[b]) => a.localeCompare(b))
const backgrounds = entries(backgroundModules).map(([path,src]) => ({ name: path.split('/').pop() ?? '', src }))
const objects = entries(objectModules).flatMap(([path,src]) => {
  const name = path.split('/').pop() ?? ''
  const match = /^obj[_-]?\d+[_-]size[_-]?(100|[1-9]\d?)\.(png|webp|jpg|jpeg)$/i.exec(name)
  return match ? [{ name, src, size: Number(match[1]) }] : /^obj\d+\.(png|webp|jpg|jpeg)$/i.test(name) ? [{ name, src, size: 50 }] : []
})
const camps = entries(campModules).map(([,src]) => src)
function random(seed: string, index: number) {
  let n = 2166136261
  for (const c of seed + ':' + index) { n ^= c.charCodeAt(0); n = Math.imul(n, 16777619) }
  return (n >>> 0) / 4294967296
}
const shuffled = <T,>(items: T[], seed: string, offset: number) =>
  items.map((value,i) => ({value, order: random(seed, offset+i)})).sort((a,b)=>a.order-b.order).map(item=>item.value)
export const sceneObjectCount = objects.length
export const sceneBackgroundNames = backgrounds.map(b => b.name)
export function generateScene(seed: string, layout: SceneLayout, count?: number) {
  const target = Math.max(7, Math.min(12, count ?? 7 + Math.floor(random(seed, 11)*6)))
  const points = shuffled(layout.points, seed, 100)
  const assets = shuffled(objects, seed, 200)
  // Maximum-cardinality bipartite matching: narrow points cannot be starved by earlier choices.
  const assigned = new Map<number, number>()
  function match(pointIndex: number, visited: Set<number>): boolean {
    const p = points[pointIndex]
    for (let i=0; i<assets.length; i++) {
      if (visited.has(i) || assets[i].size < p.minSize || assets[i].size > p.maxSize) continue
      visited.add(i)
      const owner = assigned.get(i)
      if (owner === undefined || match(owner, visited)) { assigned.set(i,pointIndex); return true }
    }
    return false
  }
  for (let i=0;i<points.length;i++) match(i,new Set())
  return [...assigned].slice(0,target).map(([assetIndex,pointIndex]) => ({ asset: assets[assetIndex], point: points[pointIndex] }))
}
export function RoundScene({seed, backgroundId, layouts = SCENE_LAYOUTS, objectCount, showPoints = false}: SceneProps) {
  const selected = backgroundId ? layouts.find(l=>l.id===backgroundId) : layouts[Math.floor(random(seed,1)*layouts.length)]
  const layout = selected ?? layouts[0]
  const composition = useMemo(()=>layout ? generateScene(seed,layout,objectCount):[],[seed,layout,objectCount])
  const background = backgrounds.find(b=>b.name.toLowerCase().startsWith(layout?.id.toLowerCase() ?? '---')) ?? backgrounds[0]
  const camp = camps[Math.floor(random(seed,501)*camps.length)]
  return <div className="rps-round-scene" aria-hidden="true">
    <div className="rps-scene-background" style={background ? {backgroundImage:`url("${background.src}")`}:undefined}/>
    {composition.map(({asset,point})=><img key={asset.name} className="rps-scene-object" src={asset.src} alt="" draggable={false}
      style={{left:`${point.x}%`,top:`${point.y}%`,zIndex:point.layer,
        width:`${Math.round((15 + asset.size*.19)*point.depthScale)}%`,
        transform:`translate(-50%,-50%) rotate(${point.rotate}deg)`}}/>)}
    {camp && layout && <div className="rps-scene-campfire" style={{left:`${layout.campfire.x}%`,top:`${layout.campfire.y}%`,transform:`translate(-50%,-50%) scale(${layout.campfire.scale})`}}><img src={camp} alt="" draggable={false}/></div>}
    {showPoints && layout?.points.map(p=><div key={p.id} className="rps-scene-point" style={{left:`${p.x}%`,top:`${p.y}%`}}>{p.id}</div>)}
  </div>
}

type ResultProps = { title: string; tone: 'win' | 'loss'; leftName: string; leftScore: number; rightName: string; rightScore: number }

export function CaveResultScene({ title, tone, leftName, leftScore, rightName, rightScore }: ResultProps) {
  return <div className="rps-cave-scene">
    <svg className="rps-cave-art" viewBox="0 0 360 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id="caveRock" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#c6b59a"/><stop offset="1" stopColor="#8f806d"/></linearGradient></defs>
      <path d="M0 0 H360 V700 H0Z" fill="#d9d0bd"/>
      <path d="M0 0 L80 24 L102 70 L75 112 L93 170 L45 226 L70 288 L22 350 L48 414 L0 480Z M360 0 L280 18 L260 72 L288 126 L250 184 L301 246 L273 309 L338 375 L310 452 L360 510Z" fill="#b3a188" stroke="#665548" strokeWidth="7" strokeLinejoin="round"/>
      <path d="M0 480 Q50 430 100 475 L126 700 H0Z M360 480 Q315 435 260 480 L236 700 H360Z" fill="#a28d73" stroke="#665548" strokeWidth="7"/>
      <path d="M75 415 Q67 210 180 180 Q293 210 285 415 Q252 470 180 468 Q108 470 75 415Z" fill="#473d36" stroke="#665548" strokeWidth="12"/>
      <path d="M95 415 Q96 240 180 220 Q264 240 265 415 Q225 448 180 446 Q135 448 95 415Z" fill="#171b1d"/>
      <g fill="none" stroke="#78624e" strokeWidth="5" strokeLinecap="round"><path d="M24 90 L62 115 L39 151 M321 75 L292 111 L326 143 M18 540 L60 520 L48 568 M338 540 L302 522 L320 568"/></g>
      <g fill="#8f6b4d" stroke="#594638" strokeWidth="4"><path d="M24 320 L58 304 L75 333 L50 351Z"/><path d="M300 340 L331 316 L346 350 L321 367Z"/><path d="M145 95 L161 80 L178 104 L157 119Z"/><path d="M220 570 L242 550 L260 578 L237 596Z"/></g>
      <g fill="#b58a55" opacity=".8"><path d="M20 190 l24 -18 8 25 -20 14Z"/><path d="M315 205 l22 -14 8 23 -21 13Z"/></g>
    </svg>
    <div className={`rps-cave-title ${tone}`}>{title}</div>
    <div className="rps-cave-sign left"><span>{leftName}</span><strong>{leftScore}</strong></div>
    <div className="rps-cave-sign right"><span>{rightName}</span><strong>{rightScore}</strong></div>
  </div>
}
