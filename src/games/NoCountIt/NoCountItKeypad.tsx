import type { CSSProperties } from 'react'

type Props = {
  value: string
  styles: Record<string, CSSProperties>
  disabled?: boolean
  onDigit: (digit: string) => void
  onDelete: () => void
  onSubmit: () => void
}

/** Shared presentation only: solo and multiplayer retain their own answer lifecycle. */
export default function NoCountItKeypad({ value, styles, disabled = false, onDigit, onDelete, onSubmit }: Props) {
  return (
    <>
      <div className="no-count-it-answer-value" aria-live="polite">{value || '0'}</div>
      <div className="no-count-it-keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((digit) => (
          <button
            key={digit}
            type="button"
            className={`no-count-it-key${digit === '✓' ? ' no-count-it-key-submit' : digit === '⌫' ? ' no-count-it-key-delete' : ''}`}
            aria-label={digit === '⌫' ? 'Удалить последнюю цифру' : digit === '✓' ? 'Отправить ответ' : digit}
            disabled={disabled}
            style={/^\d$/.test(digit) ? styles[digit] : undefined}
            onClick={() => {
              if (digit === '✓') onSubmit()
              else if (digit === '⌫') onDelete()
              else onDigit(digit)
            }}
          >{digit}</button>
        ))}
      </div>
    </>
  )
}
