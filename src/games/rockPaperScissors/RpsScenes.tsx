import { useMemo } from 'react'

type SceneProps = { seed: string }

function seededNumber(seed: string, index: number) {
  let value = 2166136261
  const source = `${seed}:${index}`
  for (let i = 0; i < source.length; i += 1) {
    value ^= source.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0) / 4294967295
}

type LayoutSlot = { x: number; y: number; rotate: number; scale: number }

const objectAssetModules = import.meta.glob('./assets/objects/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const campfireAssetModules = import.meta.glob('./assets/objectsCamps/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const backgroundAssetModules = import.meta.glob('./assets/background/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

type ImageAsset = { name: string; src: string }
const objectAssets: ImageAsset[] = Object.entries(objectAssetModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, src]) => ({ name: path.split('/').pop() ?? path, src }))
const campfireAssets: ImageAsset[] = Object.entries(campfireAssetModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, src]) => ({ name: path.split('/').pop() ?? path, src }))
const backgroundAsset = Object.entries(backgroundAssetModules)
  .sort(([a], [b]) => a.localeCompare(b))[0]?.[1]

const objectLayouts: LayoutSlot[][] = [
  [{x:30,y:25,rotate:-12,scale:.78},{x:70,y:25,rotate:18,scale:1.12},{x:23,y:47,rotate:8,scale:.92},{x:77,y:48,rotate:-20,scale:1.16},{x:32,y:76,rotate:12,scale:1.02},{x:68,y:76,rotate:-8,scale:1.24}],
  [{x:23,y:21,rotate:-20,scale:1.08},{x:74,y:30,rotate:16,scale:.76},{x:29,y:43,rotate:10,scale:1.2},{x:78,y:59,rotate:-15,scale:.92},{x:26,y:77,rotate:18,scale:.84},{x:72,y:82,rotate:-8,scale:1.1}],
  [{x:20,y:25,rotate:-14,scale:1.16},{x:80,y:24,rotate:20,scale:.78},{x:20,y:49,rotate:12,scale:.94},{x:80,y:52,rotate:-22,scale:1.12},{x:20,y:77,rotate:8,scale:1.04},{x:80,y:78,rotate:-12,scale:.88}],
  [{x:27,y:21,rotate:15,scale:.78},{x:73,y:29,rotate:-12,scale:1.24},{x:19,y:48,rotate:-18,scale:1.04},{x:74,y:57,rotate:22,scale:.84},{x:35,y:79,rotate:8,scale:1.18},{x:81,y:81,rotate:-10,scale:.94}],
  [{x:15,y:23,rotate:-12,scale:1.26},{x:85,y:23,rotate:14,scale:1.2},{x:14,y:53,rotate:18,scale:1.04},{x:86,y:54,rotate:-16,scale:1.12},{x:20,y:83,rotate:-8,scale:1.22},{x:80,y:83,rotate:12,scale:1.16}],
  [{x:20,y:30,rotate:-16,scale:.86},{x:43,y:19,rotate:10,scale:1.08},{x:75,y:28,rotate:18,scale:1.18},{x:22,y:75,rotate:12,scale:1.14},{x:52,y:84,rotate:-10,scale:.82},{x:80,y:72,rotate:-18,scale:1.04}],
]

function pickSeeded<T>(items: T[], seed: string, offset: number): T | undefined {
  if (!items.length) return undefined
  return items[Math.floor(seededNumber(seed, offset) * items.length)]
}

function SceneBackground() {
  return <div
    data-scene-layer="background"
    className="rps-scene-background"
    style={backgroundAsset ? { backgroundImage: `url("${backgroundAsset}")` } : undefined}
  />
}

function CampfireLayer({ seed }: SceneProps) {
  const campfire = pickSeeded(campfireAssets, seed, 501)
  if (campfire) {
    return <div data-scene-layer="campfires" className="rps-scene-campfire">
      <img src={campfire.src} alt="" draggable={false}/>
    </div>
  }
  return <svg data-scene-layer="campfires" className="rps-scene-campfire-fallback" viewBox="0 0 120 100" aria-hidden="true">
    <g transform="translate(60 55)" stroke="#594237" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-52 12 L-30 -8 L8 8 L44 -7 L59 14 L17 27 L-28 23Z" fill="#8e7358"/>
      <path d="M-43 -4 L35 17 M-32 20 L42 -4" fill="none" stroke="#6b4b39" strokeWidth="9"/>
      <path d="M-17 8 Q-38 -20 -18 -43 Q-22 -16 0 -38 Q-4 -13 17 -35 Q11 -10 30 3 Q8 -3 4 20Z" fill="#d28b54"/>
      <path d="M-5 5 Q-17 -12 -5 -27 Q-5 -10 8 -23 Q7 -7 19 4 Q5 -1 5 13Z" fill="#e2b56e"/>
    </g>
  </svg>
}

export function RoundScene({ seed }: SceneProps) {
  const composition = useMemo(() => {
    const layoutIndex = Math.floor(seededNumber(seed, 100) * objectLayouts.length)
    const shuffled = objectAssets
      .map((asset, index) => ({ asset, order: seededNumber(seed, 200 + index) }))
      .sort((a, b) => a.order - b.order)
      .slice(0, Math.min(6, objectAssets.length))
    return objectLayouts[layoutIndex].slice(0, shuffled.length).map((slot, index) => ({
      ...slot,
      asset: shuffled[index].asset,
      rotate: slot.rotate + (seededNumber(seed, 300 + index) - .5) * 16,
      scale: slot.scale * (.94 + seededNumber(seed, 400 + index) * .12),
    }))
  }, [seed])

  return <div className="rps-round-scene" aria-hidden="true">
    <SceneBackground />
    <div data-scene-layer="environment-objects" className="rps-scene-objects">
      {composition.map((item) => <img
        key={item.asset.name}
        className="rps-scene-object"
        src={item.asset.src}
        alt=""
        draggable={false}
        style={{
          left: `${item.x}%`,
          top: `${item.y}%`,
          transform: `translate(-50%, -50%) rotate(${item.rotate}deg) scale(${item.scale})`,
        }}
      />)}
    </div>
    <CampfireLayer seed={seed}/>
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
