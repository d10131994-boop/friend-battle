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

const props = [
  { x: 34, y: 31, rotate: -18, kind: 0 },
  { x: 66, y: 30, rotate: 24, kind: 1 },
  { x: 29, y: 49, rotate: 13, kind: 2 },
  { x: 71, y: 51, rotate: -28, kind: 3 },
  { x: 36, y: 69, rotate: 8, kind: 4 },
  { x: 64, y: 70, rotate: -9, kind: 5 },
  { x: 50, y: 20, rotate: 32, kind: 6 },
  { x: 51, y: 81, rotate: -14, kind: 7 },
]

function CampObject({ kind }: { kind: number }) {
  const outline = '#514139'
  const common = { stroke: outline, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }

  switch (kind) {
    // A metal camping bottle: cap, narrow neck, shoulders and rounded body.
    case 0:
      return <g {...common}>
        <path d="M-7 -22 H7 V-15 L11 -10 Q17 -5 17 3 V17 Q17 23 10 23 H-10 Q-17 23 -17 17 V3 Q-17 -5 -11 -10 L-7 -15Z" fill="#78929a"/>
        <path d="M-7 -22 V-27 H7 V-22Z" fill="#b9a17d"/>
        <path d="M-6 -15 H6 M-12 3 Q0 8 12 3" fill="none" stroke="#d4c5a6" strokeWidth="2"/>
        <path d="M-12 13 Q0 17 12 13" fill="none" stroke="#526e76" strokeWidth="2"/>
      </g>
    // A cowboy hat with a broad brim and a pinched crown.
    case 1:
      return <g {...common}>
        <path d="M-25 9 Q-17 2 -8 5 L-5 -12 Q0 -20 6 -12 L11 4 Q19 0 26 8 Q15 16 0 15 Q-15 16 -25 9Z" fill="#b58b5c"/>
        <path d="M-8 4 Q0 8 11 4 L6 -12 Q0 -18 -5 -12Z" fill="#c7a071"/>
        <path d="M-8 2 Q1 7 10 2" fill="none" stroke="#6d503d" strokeWidth="3"/>
        <path d="M-20 9 Q0 14 21 9" fill="none" stroke="#e0bd86" strokeWidth="2"/>
      </g>
    // An axe: long wooden handle and a distinct metal blade.
    case 2:
      return <g {...common}>
        <path d="M-3 -20 L4 -18 L8 19 Q5 24 0 21 L-7 -16Z" fill="#9a704c"/>
        <path d="M-3 -18 Q-13 -24 -21 -17 L-24 -5 Q-13 -7 -7 1 L1 -5 L5 -15Z" fill="#aeb5ad"/>
        <path d="M-18 -16 L-22 -8 M-4 -15 L1 -10" fill="none" stroke="#e0e0d3" strokeWidth="2"/>
      </g>
    // A cut tree stump with bark and visible growth rings.
    case 3:
      return <g {...common}>
        <path d="M-18 -12 L18 -12 L15 17 Q0 23 -15 17Z" fill="#916747"/>
        <path d="M-18 -12 Q-9 -20 2 -17 Q13 -20 18 -12 Q12 -4 0 -5 Q-11 -4 -18 -12Z" fill="#c5a77c"/>
        <path d="M-8 -12 Q-2 -16 5 -12 Q9 -9 2 -8 Q-5 -7 -5 -11" fill="none" stroke="#8b6848" strokeWidth="2"/>
        <path d="M-11 -3 L-8 14 M11 -4 L8 15" fill="none" stroke="#684b38" strokeWidth="2"/>
      </g>
    // A sturdy leather boot with a tall shaft, ankle and toe.
    case 4:
      return <g {...common}>
        <path d="M-12 -22 L4 -22 L5 -2 Q7 5 17 8 Q25 11 23 19 Q20 23 10 22 L-20 22 Q-25 19 -21 13 L-12 5Z" fill="#a66f4d"/>
        <path d="M-12 -15 L3 -15 M-11 -8 L4 -8 M-10 -1 L5 -1" fill="none" stroke="#e0b38a" strokeWidth="2"/>
        <path d="M-20 15 Q-2 18 22 15" fill="none" stroke="#594638" strokeWidth="3"/>
        <path d="M7 7 L13 11" fill="none" stroke="#594638" strokeWidth="2"/>
      </g>
    // A camping lantern with a handle, cap, glass chamber and base.
    case 5:
      return <g {...common}>
        <path d="M-10 -17 Q-10 -29 0 -29 Q10 -29 10 -17" fill="none" strokeWidth="3"/>
        <path d="M-13 -17 H13 L17 -10 L13 15 H-13 L-17 -10Z" fill="#9b7955"/>
        <path d="M-11 -10 H11 L9 11 H-9Z" fill="#e3c27b"/>
        <path d="M0 -7 Q-7 1 0 8 Q7 1 0 -7Z" fill="#d98d4e" stroke="#9b6542" strokeWidth="1.5"/>
        <path d="M-17 -10 H17 M-13 15 H13 L16 20 H-16Z" fill="#88715a"/>
        <path d="M-10 -15 V14 M10 -15 V14" fill="none" stroke="#514139" strokeWidth="2"/>
      </g>
    // A hiking backpack with shoulder straps, flap and front pocket.
    case 6:
      return <g {...common}>
        <path d="M-13 -14 Q-13 -24 0 -24 Q13 -24 13 -14 L19 -7 L18 18 Q0 25 -18 18 L-19 -7Z" fill="#71836c"/>
        <path d="M-13 -13 Q0 -21 13 -13 L15 -4 H-15Z" fill="#9ba889"/>
        <path d="M-13 1 Q0 -3 13 1 L13 15 Q0 19 -13 15Z" fill="#899b7d"/>
        <path d="M-19 -5 Q-27 2 -20 15 M19 -5 Q27 2 20 15" fill="none" stroke="#514139" strokeWidth="3"/>
        <path d="M-5 -3 V4 H5 V-3 M-5 4 Q0 8 5 4" fill="none" stroke="#514139" strokeWidth="2"/>
      </g>
    // A large recognizable boulder, with a lit upper face and cracks.
    default:
      return <g {...common}>
        <path d="M-22 12 L-19 -5 L-8 -19 L8 -22 L20 -9 L23 8 L11 19 L-10 20Z" fill="#8c9280"/>
        <path d="M-19 -5 L-8 -19 L8 -22 L2 -7 L-8 2Z" fill="#b3b49d"/>
        <path d="M2 -7 L20 -9 L23 8 L9 13Z" fill="#777f70"/>
        <path d="M-8 2 L2 -7 L9 13 L-10 20Z" fill="#9da18a"/>
        <path d="M-8 -19 L-5 -5 L-13 3 M2 -7 L-1 4 L9 13" fill="none" stroke="#626b5d" strokeWidth="2"/>
      </g>
  }
}

export function RoundScene({ seed }: SceneProps) {
  const objects = useMemo(() => props
    .map((item, index) => ({ ...item, x: item.x + (seededNumber(seed, index) - .5) * 7, y: item.y + (seededNumber(seed, index + 20) - .5) * 6, rotate: item.rotate + (seededNumber(seed, index + 40) - .5) * 30 }))
    .sort((a, b) => seededNumber(seed, a.kind + 60) - seededNumber(seed, b.kind + 60))
    .slice(0, 6), [seed])

  return <div className="rps-round-scene" aria-hidden="true">
    <svg viewBox="0 0 360 700" preserveAspectRatio="xMidYMid slice">
      <path d="M0 0 H360 V700 H0Z" fill="#e6e5d8"/>
      <path d="M0 0 Q75 40 140 18 T360 24 V700 Q265 670 180 690 T0 675Z" fill="#d8dfcf"/>
      <g opacity=".42" fill="none" stroke="#a6ad98" strokeWidth="2"><path d="M10 120 Q70 90 110 130 T210 112 M240 90 Q285 65 345 105 M12 570 Q80 540 130 575 T245 560 M240 620 Q290 590 350 620"/></g>
      {objects.map((item) => <g key={item.kind} transform={`translate(${item.x * 3.6} ${item.y * 7}) rotate(${item.rotate}) scale(.8)`}><CampObject kind={item.kind}/></g>)}
      <g transform="translate(180 350)" stroke="#594237" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M-52 12 L-30 -8 L8 8 L44 -7 L59 14 L17 27 L-28 23Z" fill="#8e7358"/>
        <path d="M-43 -4 L35 17 M-32 20 L42 -4" fill="none" stroke="#6b4b39" strokeWidth="9"/>
        <path d="M-17 8 Q-38 -20 -18 -43 Q-22 -16 0 -38 Q-4 -13 17 -35 Q11 -10 30 3 Q8 -3 4 20Z" fill="#d28b54"/>
        <path d="M-5 5 Q-17 -12 -5 -27 Q-5 -10 8 -23 Q7 -7 19 4 Q5 -1 5 13Z" fill="#e2b56e"/>
        <path d="M-5 -7 Q-10 -16 -3 -22" fill="none" stroke="#f0d59a" strokeWidth="4"/>
      </g>
    </svg>
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
