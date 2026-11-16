import { useEffect, useMemo, useRef, useState } from 'react'
import { generateCandyJarScene, createSeededRandom } from './scene/sceneGenerator'
import { CANDY_PALETTE, renderCandyJarSvg } from './scene/svgRenderer'
import { NO_COUNT_IT_TEXTS } from './texts'
import type { NoCountItPaletteColor } from './types'

const BACKGROUNDS = import.meta.glob<string>('./backgrounds/*.{png,jpg,jpeg,webp}', {
  eager: true, query: '?url', import: 'default',
})
const COLORS = Object.keys(CANDY_PALETTE) as NoCountItPaletteColor[]
const ROUND_COUNT = 3
type Phase = 'showing' | 'answering' | 'revealing' | 'finished'
type RoundResult = { answer: number | null; correct: number; error: number }

function newRound() {
  const seed = `solo-${Date.now()}-${Math.random()}`
  const scene = generateCandyJarScene({ seed, maxColors: COLORS.length - 1 })
  const paths = Object.keys(BACKGROUNDS).sort()
  const random = createSeededRandom(`${scene.seed}-layers`)
  const background = paths.length ? BACKGROUNDS[paths[Math.floor(random() * paths.length)]] : null
  return { scene, svg: renderCandyJarSvg(scene), background }
}

export default function NoCountItSolo({ onBack }: { onBack: () => void }) {
  const [roundNumber, setRoundNumber] = useState(1)
  const [round, setRound] = useState(newRound)
  const [phase, setPhase] = useState<Phase>('showing')
  const [deadline, setDeadline] = useState(() => Date.now() + 5000)
  const [now, setNow] = useState(Date.now)
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState<number | null>(null)
  const [results, setResults] = useState<RoundResult[]>([])
  const submitted = useRef(false)

  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  const target = NO_COUNT_IT_TEXTS.colors[round.scene.targetColor]
  const error = Math.abs((answer ?? 0) - round.scene.correctCount)
  const totalError = results.reduce((sum, result) => sum + result.error, 0)
  const keypadStyles = useMemo(() => {
    const colors = [...new Set([...round.scene.objects.map((candy) => candy.color), round.scene.backgroundColor])].sort()
    const random = createSeededRandom(`${round.scene.seed}:keypad`)
    return Object.fromEntries('0123456789'.split('').map((digit) => {
      const backgroundColor = colors[Math.floor(random() * colors.length)]
      const foreground = colors.filter((color) => color !== backgroundColor)
      const foregroundColor = foreground[Math.floor(random() * foreground.length)]
      const background = CANDY_PALETTE[backgroundColor]
      return [digit, {
        background: `linear-gradient(180deg, ${background.light}, ${background.base})`,
        color: CANDY_PALETTE[foregroundColor].base,
        borderColor: background.light,
      }]
    }))
  }, [round])

  function submit(value: string) {
    if (submitted.current || phase !== 'answering') return
    submitted.current = true
    const parsed = value ? Number(value) : null
    const valid = parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
    setAnswer(valid)
    setResults((previous) => [...previous, {
      answer: valid,
      correct: round.scene.correctCount,
      error: Math.abs((valid ?? 0) - round.scene.correctCount),
    }])
    setPhase('revealing')
    setDeadline(Date.now() + 6000)
  }

  function nextRound() {
    if (roundNumber === ROUND_COUNT) {
      setPhase('finished')
      return
    }
    setRound(newRound())
    setRoundNumber((value) => value + 1)
    setDraft('')
    setAnswer(null)
    submitted.current = false
    setPhase('showing')
    setDeadline(Date.now() + 5000)
  }

  useEffect(() => {
    if (phase === 'finished') return
    const interval = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(interval)
  }, [phase])

  useEffect(() => {
    if (phase === 'finished' || now < deadline) return
    const timeout = window.setTimeout(() => {
      if (phase === 'showing') {
        setPhase('answering')
        setDeadline(Date.now() + 10000)
      } else if (phase === 'answering') {
        submit(draft)
      } else if (phase === 'revealing') {
        nextRound()
      }
    }, 0)
    return () => window.clearTimeout(timeout)
  // The phase transition is deliberately driven by the local deadline.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, deadline, phase, draft])

  function restart() {
    setRoundNumber(1)
    setRound(newRound())
    setPhase('showing')
    setDeadline(Date.now() + 5000)
    setNow(Date.now())
    setDraft('')
    setAnswer(null)
    setResults([])
    submitted.current = false
  }

  return (
    <main className={`app${phase === 'answering' ? ' no-count-it-answer-screen' : ''}`}>
      <header className="topbar">
        <button type="button" className="leaderboard-button menu-back-button" onClick={onBack}>← НАЗАД</button>
        <div className="logo">NO COUNT <span>IT</span></div>
        <div className="player-level">ОДИНОЧНАЯ ИГРА</div>
      </header>
      {phase === 'finished' ? (
        <section className="game-card">
          <h2>Игра завершена</h2>
          <p>Сумма ошибок за три раунда: <strong>{totalError}</strong></p>
          {results.map((result, index) => (
            <p key={index}>Раунд {index + 1}: ответ {result.answer ?? 'нет ответа'}, правильный {result.correct}, ошибка {result.error}</p>
          ))}
          <button type="button" className="play-button" onClick={restart}>ИГРАТЬ ЕЩЁ</button>
          <button type="button" className="play-button" onClick={onBack}>К ВЫБОРУ ИГР</button>
        </section>
      ) : (
        <>
          <section className="hero">
            <div className="eyebrow">Раунд {roundNumber} из {ROUND_COUNT}</div>
            <h1>СОСЧИТАЙ <span>КОНФЕТЫ</span></h1>
          </section>
          {phase === 'showing' && (
            <section className="game-card no-count-it-showing-card">
              <p>Запоминай! · {remaining} сек.</p>
              <div className="no-count-it-round-image" style={{
                position: 'relative', aspectRatio: '3 / 4', maxWidth: 420, margin: 'auto',
                background: CANDY_PALETTE[round.scene.backgroundColor].base,
              }}>
                {round.background && <img src={round.background} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                <div style={{ position: 'relative', height: '100%', display: 'grid', placeItems: 'center' }} dangerouslySetInnerHTML={{ __html: round.svg }} />
              </div>
              <h2>{NO_COUNT_IT_TEXTS.match.questionPrefix}{target}»?</h2>
            </section>
          )}
          {phase === 'answering' && (
            <section className="game-card no-count-it-answer-card">
              <div className="no-count-it-answer-layout">
                <div className="no-count-it-answer-top">
                  <h2 className="no-count-it-answer-question">{NO_COUNT_IT_TEXTS.match.questionPrefix}{target}»?</h2>
                  <div className="no-count-it-answer-timer">{remaining} сек.</div>
                  <div className="no-count-it-answer-value">{draft || '0'}</div>
                </div>
                <div className="no-count-it-keypad">
                  {['1','2','3','4','5','6','7','8','9','⌫','0','✓'].map((digit) => (
                    <button key={digit} type="button"
                      className={`no-count-it-key${digit === '✓' ? ' no-count-it-key-submit' : digit === '⌫' ? ' no-count-it-key-delete' : ''}`}
                      style={/^\d$/.test(digit) ? keypadStyles[digit] : undefined}
                      aria-label={digit === '⌫' ? 'Удалить последнюю цифру' : digit === '✓' ? 'Отправить ответ' : digit}
                      onClick={() => {
                        if (digit === '✓') submit(draft)
                        else if (digit === '⌫') setDraft((value) => value.slice(0, -1))
                        else setDraft((value) => value.length < 15 ? value + digit : value)
                      }}>{digit}</button>
                  ))}
                </div>
              </div>
            </section>
          )}
          {phase === 'revealing' && (
            <section className="game-card no-count-it-reveal-card">
              <h2>Результат раунда {roundNumber}</h2>
              <p>Правильный ответ: <strong>{round.scene.correctCount}</strong></p>
              <p>Твой ответ: <strong>{answer ?? 'нет ответа'}</strong></p>
              <p>Ошибка: <strong>{error}</strong></p>
              <p>Сумма ошибок: <strong>{totalError}</strong></p>
              <p>Следующий этап через {remaining} сек.</p>
              <button type="button" className="play-button" onClick={onBack}>ВЫЙТИ ДОСРОЧНО</button>
            </section>
          )}
        </>
      )}
    </main>
  )
}
