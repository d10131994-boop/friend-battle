import type { RockPaperScissorsChoice } from './types'

type Props = {
  choice: RockPaperScissorsChoice
  className?: string
  label?: string
}

export function HandIllustration({ choice, className = '', label }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 280 190"
      role="img"
      aria-label={label ?? (choice === 'rock' ? 'Камень' : choice === 'scissors' ? 'Ножницы' : 'Бумага')}
    >
      <g stroke="#47332F" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        {choice === 'rock' && (
          <>
            <path fill="#F5BC94" d="M-8 112 L78 112 Q94 108 108 91 L127 69 Q137 58 149 65 L163 74 Q175 69 186 78 L198 90 Q211 91 219 104 L225 119 Q233 140 219 154 Q205 170 180 166 L128 158 L82 151 L-8 151 Z" />
            <path fill="#E99C75" d="M110 101 Q128 87 144 93 Q158 98 168 112 L180 130 Q183 140 173 146 Q162 151 151 140 L127 122 Q116 116 104 124 Z" />
            <path fill="none" d="M145 72 Q158 88 166 105 M178 82 Q189 98 194 113 M199 98 Q211 113 212 128" />
            <path fill="#F7C5A1" strokeWidth="4" d="M151 78 Q158 70 166 78 Q173 86 166 94 Q157 100 150 91 Z M184 91 Q192 84 199 93 Q205 102 197 109 Q188 114 182 104 Z" />
            <path fill="#F7C5A1" strokeWidth="4" d="M205 111 Q214 106 220 115 Q225 124 217 130 Q208 135 202 126 Z" />
            <path fill="none" strokeWidth="5" d="M91 135 Q107 141 121 138" />
          </>
        )}
        {choice === 'paper' && (
          <>
            <path fill="#F5BC94" d="M-8 119 L86 119 Q101 111 114 105 L130 99 Q145 96 158 104 L178 112 L198 116 L219 117 Q239 119 239 137 Q238 154 219 155 L183 154 L158 165 Q132 177 106 164 L82 151 L-8 151 Z" />
            <path fill="#F5BC94" d="M106 110 L113 39 Q115 20 129 20 Q144 20 144 40 L143 103 Z" />
            <path fill="#F5BC94" d="M139 105 L148 18 Q150 1 164 3 Q180 5 177 23 L172 111 Z" />
            <path fill="#F5BC94" d="M170 111 L185 31 Q189 13 203 18 Q218 23 212 41 L199 120 Z" />
            <path fill="#F5BC94" d="M197 122 L218 65 Q225 48 239 56 Q253 64 244 80 L226 135 Z" />
            <path fill="#E99C75" d="M91 124 Q107 110 126 119 Q143 128 150 145 L133 160 Q113 155 96 148 Z" />
            <path fill="none" strokeWidth="4" d="M125 30 L127 48 M160 14 L160 36 M200 29 L196 48 M230 65 L223 83 M153 112 Q168 122 184 123" />
            <path fill="#F7C5A1" strokeWidth="3" d="M121 23 Q130 16 137 24 L138 39 L124 41 Z M156 7 Q165 0 172 9 L171 23 L157 25 Z M195 22 Q204 15 211 25 L207 39 L193 37 Z M231 60 Q240 55 245 65 L239 78 L226 73 Z" />
          </>
        )}
        {choice === 'scissors' && (
          <>
            <path fill="#F5BC94" d="M-8 119 L87 119 Q103 110 117 103 L137 96 Q155 92 170 105 L190 120 L215 130 Q233 138 224 155 Q214 171 195 161 L166 150 L143 165 Q119 178 96 163 L80 151 L-8 151 Z" />
            <path fill="#F5BC94" d="M117 106 L151 24 Q159 6 173 13 Q187 21 178 39 L146 113 Z" />
            <path fill="#F5BC94" d="M145 111 L202 41 Q215 25 227 36 Q240 48 226 63 L171 126 Z" />
            <path fill="#E99C75" d="M111 120 Q130 107 145 120 Q159 133 154 148 L133 163 Q113 155 99 146 Z" />
            <path fill="none" strokeWidth="4" d="M164 22 L159 39 M215 43 L204 57 M156 122 Q170 132 184 138" />
            <path fill="#F7C5A1" strokeWidth="3" d="M162 15 Q171 7 179 17 L174 31 L160 29 Z M218 34 Q227 27 234 38 L225 51 L213 46 Z" />
            <path fill="none" strokeWidth="5" d="M96 137 Q110 145 124 140" />
          </>
        )}
      </g>
    </svg>
  )
}
