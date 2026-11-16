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
type Phase = 'prompt' | 'showing' | 'answering' | 'revealing' | 'finished'
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
  const [phase, setPhase] = useState<Phase>('prompt')
  const [deadline, setDeadline] = useState(() => Date.now() + 3000)
  const [now, setNow] = useState(Date.now)
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState<number | null>(null)
  const [results, setResults] = useState<RoundResult[]>([])
  const submitted = useRef(false)

  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  const target = NO_COUNT_IT_TEXTS.colors[round.scene.targetColor]
  const error = Math.abs((answer ?? 0) - round.scene.correctCount)
  const scalePosition = Math.max(32, Math.min(330, 180 + ((answer ?? 0) - round.scene.correctCount) * -7))
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
    setPhase('prompt')
    setDeadline(Date.now() + 3000)
  }

  useEffect(() => {
    if (phase === 'finished') return
    const interval = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(interval)
  }, [phase])

  useEffect(() => {
    if (phase === 'finished' || now < deadline) return
    const timeout = window.setTimeout(() => {
      if (phase === 'prompt') {
        setPhase('showing')
        setDeadline(Date.now() + 5000)
      } else if (phase === 'showing') {
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
    setPhase('prompt')
    setDeadline(Date.now() + 3000)
    setNow(Date.now())
    setDraft('')
    setAnswer(null)
    setResults([])
    submitted.current = false
  }

  return (
    <main className={`app${phase === 'answering' ? ' no-count-it-answer-screen' : ''}`}>
      {phase !== 'showing' && phase !== 'answering' && <header className="topbar">
        <button type="button" className="leaderboard-button menu-back-button" onClick={onBack}>← НАЗАД</button>
        <div className="logo">NO COUNT <span>IT</span></div>
        <div className="player-level">ОДИНОЧНАЯ ИГРА</div>
      </header>}
      {phase === 'finished' ? (
        <section className="game-card">
          <div className="hero">
            <div className="eyebrow">NO COUNT IT · ОДИНОЧНАЯ ИГРА</div>
            <div className="game-icon">🍬</div>
            <h1>ИГРА <span>ЗАВЕРШЕНА</span></h1>
          </div>
          <h2>{NO_COUNT_IT_TEXTS.match.totalErrors}</h2>
          <div className="brain-room-player"><span>Ты</span><strong>{totalError}</strong></div>
          <div className="no-count-it-result-columns"><span>Раунд</span><span>Ошибка</span></div>
          {results.map((result, index) => (
            <div className="brain-room-player" key={index}><span>{index + 1}</span><strong>{result.error}</strong></div>
          ))}
          <button type="button" className="play-button" onClick={restart}>ИГРАТЬ ЕЩЁ</button>
          <button type="button" className="play-button" onClick={onBack}>{NO_COUNT_IT_TEXTS.match.returnToRoom}</button>
        </section>      ) : (
        <>
          {phase === 'prompt' && (
            <section className="game-card">
              <div className="eyebrow">Раунд {roundNumber} из {ROUND_COUNT}</div>
              <div className="game-icon">🍬</div>
              <h2>{NO_COUNT_IT_TEXTS.match.questionPrefix}{target}»?</h2>
              <p>Смотри внимательно · {remaining} сек.</p>
            </section>
          )}
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
              <header className="no-count-it-reveal-heading">
                <div className="no-count-it-reveal-round">{NO_COUNT_IT_TEXTS.match.round} {roundNumber}</div>
                <h2>{NO_COUNT_IT_TEXTS.match.roundResults}</h2>
              </header>
              <div className="no-count-it-result-columns"><span>Игрок</span><span>Ответ</span></div>
              <div className="no-count-it-result-scale" style={{ height: 390 }}>
                <div className="no-count-it-result-axis no-count-it-result-axis-upper" style={{ top: 12, height: 160 }} />
                <div className="no-count-it-result-axis no-count-it-result-axis-lower" style={{ top: 220, bottom: 12 }} />
                {error === 0 && <div className="no-count-it-correct-highlight" style={{ top: 165, height: 65 }} />}
                <div className="no-count-it-correct-answer" style={{ top: 165 }}>
                  <span>{NO_COUNT_IT_TEXTS.match.correctShort}</span>
                  <strong>{round.scene.correctCount}</strong>
                </div>
                <div className="no-count-it-result-player" style={{ top: scalePosition }}>
                  <div className="no-count-it-result-player-label is-left">
                    <span className="no-count-it-result-name" style={{ color: '#8962bd' }}>Ты</span>
                  </div>
                  <div className="no-count-it-result-score is-right" style={{ color: error === 0 ? '#388b43' : '#d34e43' }}>
                    {answer ?? NO_COUNT_IT_TEXTS.match.noAnswer}
                  </div>
                  <span className="no-count-it-result-dot" style={{ background: '#8962bd' }} />
                </div>
              </div>
              <div className="no-count-it-result-legend">
                <span><i className="is-higher" />{NO_COUNT_IT_TEXTS.match.moreThanCorrect}</span>
                <span><i className="is-lower" />{NO_COUNT_IT_TEXTS.match.lessThanCorrect}</span>
              </div>
              <button type="button" className="play-button no-count-it-reveal-exit" onClick={onBack}>
                {NO_COUNT_IT_TEXTS.match.earlyExit}
              </button>
            </section>
          )}
        </>
      )}
    </main>
  )
}
