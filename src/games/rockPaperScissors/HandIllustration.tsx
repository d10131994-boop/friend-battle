import type { RockPaperScissorsChoice } from './types'

type Props = {
  side?: 'player' | 'opponent'
  setNumber?: number | null
  choice: RockPaperScissorsChoice
  className?: string
  label?: string
}

type HandSet = Record<RockPaperScissorsChoice, string>
const playerModules = import.meta.glob('./assets/handsPlayer/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const opponentModules = import.meta.glob('./assets/handsOpponent/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

function collectSets(modules: Record<string, string>): Map<number, HandSet> {
  const partial = new Map<number, Partial<HandSet>>()
  for (const [path, url] of Object.entries(modules)) {
    const filename = path.split('/').pop() ?? ''
    const match = /^(rock|papper|scissors)([0-9]+)\.(png|webp|jpg|jpeg)$/i.exec(filename)
    if (!match) continue
    const choice = match[1].toLowerCase() === 'papper' ? 'paper' : match[1].toLowerCase() as RockPaperScissorsChoice
    const number = Number(match[2])
    if (!Number.isSafeInteger(number)) continue
    const set = partial.get(number) ?? {}
    set[choice] = url
    partial.set(number, set)
  }
  const complete = new Map<number, HandSet>()
  for (const [number, set] of partial) {
    if (set.rock && set.paper && set.scissors) complete.set(number, set as HandSet)
  }
  return complete
}

const handSets = {
  player: collectSets(playerModules),
  opponent: collectSets(opponentModules),
}
export function chooseHandSet(side: 'player' | 'opponent'): number | null {
  const numbers = [...handSets[side].keys()]
  return numbers.length ? numbers[Math.floor(Math.random() * numbers.length)] : null
}

export function HandIllustration({ choice, className = '', label, side = 'player', setNumber }: Props) {
  const image = setNumber == null ? undefined : handSets[side].get(setNumber)?.[choice]
  if (image) return <img className={className} src={image} alt={label ?? (choice === 'rock' ? 'Камень' : choice === 'scissors' ? 'Ножницы' : 'Бумага')} draggable={false} />
  return <FallbackHandIllustration choice={choice} className={className} label={label} />
}

function FallbackHandIllustration({ choice, className = '', label }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 300 190"
      role="img"
      aria-label={label ?? (choice === 'rock' ? 'Камень' : choice === 'scissors' ? 'Ножницы' : 'Бумага')}
    >
      <g stroke="#47332F" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        {choice === 'rock' && (
          <>
            <path fill="#F5BC94" d="M-12 76 L78 76 Q99 77 117 62 Q132 49 148 55 L165 63 Q180 57 194 68 L214 86 Q230 93 235 111 L238 126 Q239 144 221 154 Q203 164 181 156 L151 148 Q128 152 108 141 L82 127 L-12 127 Z" />
            <path fill="#E99C75" d="M91 112 Q108 97 125 108 Q143 119 135 139 L116 151 Q98 143 87 128 Z" />
            <path fill="none" strokeWidth="5" d="M145 59 Q137 76 153 91 M170 65 Q163 83 179 98 M196 73 Q189 91 204 107 M216 91 Q210 108 222 122" />
            <path fill="#F7C5A1" strokeWidth="3" d="M143 60 Q151 53 158 61 Q165 70 157 78 Q148 84 141 75 Z M169 68 Q178 61 185 70 Q192 79 184 87 Q175 93 168 84 Z M196 79 Q205 73 212 82 Q218 91 210 99 Q201 104 195 95 Z" />
            <path fill="none" strokeWidth="5" d="M94 125 Q108 133 121 128" />
          </>
        )}

        {choice === 'paper' && (
          <>
            <path fill="#F5BC94" d="M-12 78 L83 78 Q102 75 119 72 L151 72 Q169 73 177 88 L183 106 L204 108 L229 108 Q246 108 247 123 Q248 139 230 140 L185 139 L181 149 L215 154 Q232 157 226 171 Q220 184 204 177 L163 164 Q142 170 122 160 L87 143 L-12 143 Z" />
            <path fill="#F5BC94" d="M126 82 L224 34 Q241 25 250 39 Q260 54 244 63 L169 108 Z" />
            <path fill="#F5BC94" d="M151 96 L256 78 Q274 75 278 90 Q281 106 264 110 L179 124 Z" />
            <path fill="#F5BC94" d="M158 119 L251 120 Q270 121 267 137 Q263 152 246 148 L176 143 Z" />
            <path fill="#F5BC94" d="M143 137 L219 155 Q237 160 230 175 Q223 188 207 180 L139 160 Z" />
            <path fill="#E99C75" d="M84 117 Q102 100 121 112 Q139 124 126 145 L105 154 Q87 143 78 130 Z" />
            <path fill="none" strokeWidth="4" d="M235 40 Q245 35 250 45 M262 85 Q272 84 274 94 M252 128 Q260 129 259 138 M215 160 Q225 163 220 173 M151 116 Q164 126 181 127" />
            <path fill="#F7C5A1" strokeWidth="3" d="M229 34 Q240 26 247 37 L243 52 L230 57 Z M259 78 Q270 73 276 84 L270 99 L256 101 Z M251 120 Q262 116 267 128 L258 140 L245 136 Z M216 155 Q228 153 232 165 L221 177 L208 169 Z" />
          </>
        )}

        {choice === 'scissors' && (
          <>
            <path fill="#F5BC94" d="M-12 78 L83 78 Q102 75 119 72 L151 72 Q169 73 177 88 L183 106 L204 108 L229 108 Q246 108 247 123 Q248 139 230 140 L185 139 L181 149 L215 154 Q232 157 226 171 Q220 184 204 177 L163 164 Q142 170 122 160 L87 143 L-12 143 Z" />
            <path fill="#F5BC94" d="M128 91 L224 25 Q241 14 251 28 Q262 43 246 54 L163 112 Z" />
            <path fill="#F5BC94" d="M146 109 L248 125 Q267 128 263 144 Q258 160 241 155 L169 135 Z" />
            <path fill="#E99C75" d="M84 117 Q102 100 121 112 Q139 124 126 145 L105 154 Q87 143 78 130 Z" />
            <path fill="none" strokeWidth="4" d="M232 27 Q244 19 251 31 M246 128 Q258 128 259 140 M151 119 Q166 129 181 131" />
            <path fill="#F7C5A1" strokeWidth="3" d="M229 22 Q241 14 249 26 L241 41 L227 44 Z M249 124 Q261 122 266 135 L256 148 L243 143 Z" />
            <path fill="none" strokeWidth="5" d="M94 125 Q108 133 121 128" />
          </>
        )}
      </g>
    </svg>
  )
}

type ChoiceIconProps = {
  choice: RockPaperScissorsChoice
  className?: string
}

export function ChoiceIcon({ choice, className = '' }: ChoiceIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label={choice === 'rock' ? 'Камень' : choice === 'scissors' ? 'Ножницы' : 'Бумага'}
    >
      {choice === 'rock' && (
        <path
          d="M10 44 L8 30 L19 13 L35 8 L51 18 L57 36 L48 53 L24 57 Z"
          fill="#8795A7"
          stroke="#43536A"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      )}
      {choice === 'scissors' && (
        <g fill="none" stroke="#3C5578" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="15" cy="47" r="8" fill="#D9E8FA" />
          <circle cx="31" cy="51" r="8" fill="#D9E8FA" />
          <path d="M21 42 L51 11 M36 45 L13 15 M27 34 L53 54" />
          <path d="M51 11 L57 8 L55 16 Z" fill="#E45D66" stroke="#3C5578" strokeWidth="3" />
          <path d="M13 15 L8 9 L17 10 Z" fill="#E45D66" stroke="#3C5578" strokeWidth="3" />
        </g>
      )}
      {choice === 'paper' && (
        <g stroke="#3C5578" strokeWidth="3.5" strokeLinejoin="round">
          <path d="M15 7 H40 L53 20 V57 H15 Z" fill="#FFFFFF" />
          <path d="M40 7 V20 H53" fill="#D7E8FC" />
          <path d="M23 31 H44 M23 40 H44 M23 49 H38" fill="none" strokeLinecap="round" />
        </g>
      )}
    </svg>
  )
}
