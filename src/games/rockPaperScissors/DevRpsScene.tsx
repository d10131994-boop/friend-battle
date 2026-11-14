import { useState } from 'react'
import { RoundScene, SCENE_LAYOUTS, sceneObjectCount, sceneBackgroundNames } from './RpsScenes'
import type { SceneLayout, ScenePoint } from './RpsScenes'
import './rockPaperScissors.css'

const style = `
.dev-rps {min-height:100svh;padding:16px;background:#eee9dc;color:#292820;font-family:system-ui,sans-serif}
.dev-rps__layout {display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:18px}
.dev-rps__panel {width:min(100%,340px);display:grid;gap:10px}
.dev-rps__stage {position:relative;width:min(100%,360px);aspect-ratio:360/700;overflow:hidden;border:6px solid white;border-radius:16px;touch-action:none}
.dev-rps button,.dev-rps select,.dev-rps input {padding:7px;border:1px solid #8b806e;border-radius:7px}
.dev-rps label {display:grid;gap:3px;font-size:13px}
.dev-rps__fields {display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dev-rps__handle {position:absolute;z-index:30;transform:translate(-50%,-50%);width:25px;height:25px;border-radius:50%;border:2px solid white;background:#ae5635;color:white;font-size:12px;font-weight:bold;cursor:grab;touch-action:none}
.dev-rps__handle.selected {background:#285eb8}
.dev-rps pre {white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;font-size:11px}
`
const clamp = (n:number,min:number,max:number)=>Math.max(min,Math.min(max,n))
export default function DevRpsScene() {
  const [layouts,setLayouts] = useState<SceneLayout[]>(()=>structuredClone(SCENE_LAYOUTS))
  const [backgroundId,setBackgroundId] = useState(SCENE_LAYOUTS[0].id)
  const [seed,setSeed] = useState('preview-initial')
  const [count,setCount] = useState(9)
  const [showPoints,setShowPoints] = useState(true)
  const [selected,setSelected] = useState(1)
  const layout = layouts.find(l=>l.id===backgroundId) ?? layouts[0]
  const point = layout.points.find(p=>p.id===selected) ?? layout.points[0]
  const updatePoint = (patch: Partial<ScenePoint>)=>setLayouts(current=>current.map(l=>l.id!==backgroundId?l:{...l,points:l.points.map(p=>p.id===selected?{...p,...patch}:p)}))
  const updateCamp = (patch: Partial<SceneLayout['campfire']>)=>setLayouts(current=>current.map(l=>l.id!==backgroundId?l:{...l,campfire:{...l.campfire,...patch}}))
  const exportConfig = JSON.stringify(layout,null,2)
  const onDrag = (event: React.PointerEvent<HTMLButtonElement>, id:number)=>{
    const stage=event.currentTarget.parentElement?.getBoundingClientRect()
    if(!stage)return
    setSelected(id)
    const x=clamp(Math.round((event.clientX-stage.left)/stage.width*100),0,100)
    const y=clamp(Math.round((event.clientY-stage.top)/stage.height*100),0,100)
    setLayouts(current=>current.map(l=>l.id!==backgroundId?l:{...l,points:l.points.map(p=>p.id===id?{...p,x,y}:p)}))
  }
  return <main className="dev-rps">
    <style>{style}</style>
    <h1>RPS — редактор сцены</h1>
    <div className="dev-rps__layout">
      <section className="dev-rps__stage" aria-label="Редактор расположения объектов">
        <RoundScene seed={seed} backgroundId={backgroundId} layouts={layouts} objectCount={count} showPoints={false}/>
        {showPoints && layout.points.map(p=><button key={p.id} type="button" className={`dev-rps__handle ${selected===p.id?'selected':''}`}
          style={{left:`${p.x}%`,top:`${p.y}%`}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);onDrag(e,p.id)}}
          onPointerMove={e=>{if(e.buttons)onDrag(e,p.id)}} onClick={()=>setSelected(p.id)} title={`Точка ${p.id}`}>{p.id}</button>)}
      </section>
      <section className="dev-rps__panel">
        <label>Фон<select value={backgroundId} onChange={e=>{setBackgroundId(e.target.value);setSelected(1)}}>
          {layouts.map(l=><option key={l.id} value={l.id}>{l.label} ({l.id})</option>)}
        </select></label>
        <label>Количество объектов: {count}<input type="range" min="7" max="12" value={count} onChange={e=>setCount(Number(e.target.value))}/></label>
        <button onClick={()=>setSeed(`preview-${Date.now()}-${Math.random()}`)}>Другая композиция</button>
        <label><input type="checkbox" checked={showPoints} onChange={e=>setShowPoints(e.target.checked)}/> Показывать точки</label>
        <label>Точка<select value={selected} onChange={e=>setSelected(Number(e.target.value))}>{layout.points.map(p=><option key={p.id} value={p.id}>Точка {p.id}</option>)}</select></label>
        <div className="dev-rps__fields">
          {(['x','y','minSize','maxSize','depthScale','rotate','layer'] as const).map(key=><label key={key}>{key}<input type="number" step={key==='depthScale'?.05:1} value={point[key]}
            onChange={e=>updatePoint({[key]:Number(e.target.value)})}/></label>)}
        </div>
        <strong>Костёр</strong>
        <div className="dev-rps__fields">
          {(['x','y','scale'] as const).map(key=><label key={key}>{key}<input type="number" step={key==='scale'?.05:1} value={layout.campfire[key]}
            onChange={e=>updateCamp({[key]:Number(e.target.value)})}/></label>)}
        </div>
        <button onClick={()=>void navigator.clipboard.writeText(exportConfig)}>Копировать конфигурацию фона</button>
        <button onClick={()=>setLayouts(structuredClone(SCENE_LAYOUTS))}>Сбросить настройки</button>
        <p>Объектов с распознанным размером: {sceneObjectCount}. Файлов фона: {sceneBackgroundNames.length}. Изменения сохраняются только в этом предпросмотре — скопируй конфигурацию для переноса в код.</p>
        <pre>{exportConfig}</pre>
      </section>
    </div>
  </main>
}
