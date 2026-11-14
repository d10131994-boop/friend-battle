import type { SceneLayout } from './sceneLayouts'

const objectModules = import.meta.glob('./assets/objects/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string,string>
const campModules = import.meta.glob('./assets/objectsCamps/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string,string>
const foregroundModules = import.meta.glob('./assets/background/*Foreground.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string,string>
const backgroundModules = import.meta.glob('./assets/background/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string,string>
const entries = (modules: Record<string,string>) => Object.entries(modules).sort(([a],[b]) => a.localeCompare(b))
export const foregrounds = entries(foregroundModules).map(([path,src]) => ({ name: path.split('/').pop() ?? '', src }))
export const backgrounds = entries(backgroundModules).filter(([path]) => !/foreground\.(png|webp|jpg|jpeg)$/i.test(path)).map(([path,src]) => ({ name: path.split('/').pop() ?? '', src }))
const objects = entries(objectModules).flatMap(([path,src]) => {
  const name = path.split('/').pop() ?? ''
  const match = /^obj[_-]?\d+[_-]size[_-]?(100|[1-9]\d?)\.(png|webp|jpg|jpeg)$/i.exec(name)
  return match ? [{ name, src, size: Number(match[1]) }] : /^obj\d+\.(png|webp|jpg|jpeg)$/i.test(name) ? [{ name, src, size: 50 }] : []
})
export const camps = entries(campModules).map(([,src]) => src)
export function random(seed: string, index: number) {
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
