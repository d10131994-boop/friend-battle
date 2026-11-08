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
  const stroke = '#514139'
  const fill = ['#9b927d', '#b6a17d', '#819078', '#b17e64', '#a69b83', '#8e9b83', '#b18b70', '#9b8c79'][kind]
  switch (kind) {
    case 0: return <path d="M-18 2 L-5 -15 L8 -8 L18 8 L4 18 L-12 12Z" fill={fill} stroke={stroke} strokeWidth="3" strokeLinejoin="round"/>
    case 1: return <g stroke={stroke} strokeWidth="3" strokeLinecap="round"><path d="M-19 5 Q-5 -8 18 4 L11 13 Q-5 8 -19 5Z" fill={fill}/><path d="M-9 -10 L10 14 M4 -14 L-12 12" fill="none"/></g>
    case 2: return <g stroke={stroke} strokeWidth="3" strokeLinejoin="round"><path d="M-16 12 L-12 -10 L4 -18 L17 -5 L11 14Z" fill={fill}/><path d="M-12 -10 L11 14 M4 -18 L-2 5" fill="none"/></g>
    case 3: return <g stroke={stroke} strokeWidth="3" strokeLinecap="round"><path d="M-17 9 Q-4 -17 17 -7 L10 13 Q-1 5 -17 9Z" fill={fill}/><path d="M-5 -2 L12 6" fill="none"/></g>
    case 4: return <g stroke={stroke} strokeWidth="3" strokeLinejoin="round"><path d="M-18 12 L-12 -12 L2 -3 L17 -17 L12 14Z" fill={fill}/><path d="M-12 -12 L12 14" fill="none"/></g>
    case 5: return <g stroke={stroke} strokeWidth="3" strokeLinecap="round"><path d="M-18 7 Q-6 -15 2 -3 Q15 -20 19 7 L8 15 L-12 13Z" fill={fill}/><path d="M-4 -3 L-9 13 M8 -4 L12 12" fill="none"/></g>
    case 6: return <g stroke={stroke} strokeWidth="3" strokeLinejoin="round"><path d="M-18 8 L-9 -13 L5 -8 L18 10 L3 16Z" fill={fill}/><path d="M-9 -13 L3 16 M5 -8 L-18 8" fill="none"/></g>
    default: return <g stroke={stroke} strokeWidth="3" strokeLinecap="round"><path d="M-18 8 L-4 -10 L17 -5 L10 13Z" fill={fill}/><path d="M-12 -2 L14 5 M-2 -11 L2 15" fill="none"/></g>
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
