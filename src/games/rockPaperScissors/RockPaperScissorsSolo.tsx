import { useEffect, useState } from 'react'
import { telegramUser } from '../../services/telegram'
import { getOpponentName, getRoundOutcome } from './logic/gameRules'
import { HandIllustration } from './HandIllustration'
import type { RockPaperScissorsChoice } from './types'
import './rockPaperScissors.css'

type SoloPhase = 'choosing' | 'revealing' | 'result' | 'completed'
type SoloState = {
  phase: SoloPhase
  phaseStartedAt: number
  roundNumber: number
  playerChoice: RockPaperScissorsChoice | null
  opponentChoice: RockPaperScissorsChoice | null
  playerScore: number
  opponentScore: number
  roundResult: 'win' | 'loss' | 'draw' | null
  opponentChoices: RockPaperScissorsChoice[]
  opponentName: string
}

const CHOICES: RockPaperScissorsChoice[] = ['rock', 'scissors', 'paper']
const CHOICE_LABELS: Record<RockPaperScissorsChoice, string> = {
  rock: 'Камень',
  scissors: 'Ножницы',
  paper: 'Бумага',
}

function createInitialState(): SoloState {
  return {
    phase: 'choosing',
    phaseStartedAt: Date.now(),
    roundNumber: 1,
    playerChoice: null,
    opponentChoice: null,
    playerScore: 0,
    opponentScore: 0,
    roundResult: null,
    opponentChoices: [],
    opponentName: 'Дуэйн',
  }
}

type Props = { onBack: () => void }

export default function RockPaperScissorsSolo({ onBack }: Props) {
  const [game, setGame] = useState<SoloState>(createInitialState)
  const [now, setNow] = useState(Date.now())
  const playerName = telegramUser?.first_name?.trim() || 'Ты'

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (game.phase === 'choosing') {
      const deadline = game.phaseStartedAt + 3_000
      const timer = window.setTimeout(() => {
        setGame((current) => {
          if (current.phase !== 'choosing' || current.phaseStartedAt !== game.phaseStartedAt) return current
          const playerChoice = current.playerChoice ?? 'rock'
          const opponentChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)]
          const outcome = getRoundOutcome(playerChoice, opponentChoice)
          return {
            ...current,
            phase: 'revealing',
            phaseStartedAt: Date.now(),
            playerChoice,
            opponentChoice,
            roundResult: outcome,
            playerScore: current.playerScore + (outcome === 'win' ? 1 : 0),
            opponentScore: current.opponentScore + (outcome === 'loss' ? 1 : 0),
            opponentChoices: [...current.opponentChoices, opponentChoice],
          }
        })
      }, Math.max(0, deadline - Date.now()))
      return () => window.clearTimeout(timer)
    }

    if (game.phase === 'revealing') {
      const timer = window.setTimeout(() => {
        setGame((current) => current.phase === 'revealing'
          ? { ...current, phase: 'result', phaseStartedAt: Date.now() }
          : current)
      }, 4_000)
      return () => window.clearTimeout(timer)
    }

    if (game.phase === 'result') {
      const timer = window.setTimeout(() => {
        setGame((current) => {
          if (current.phase !== 'result') return current
          if (current.playerScore >= 3 || current.opponentScore >= 3) {
            return {
              ...current,
              phase: 'completed',
              phaseStartedAt: Date.now(),
              opponentName: getOpponentName(current.opponentChoices),
            }
          }
          return {
            ...current,
            phase: 'choosing',
            phaseStartedAt: Date.now(),
            roundNumber: current.roundNumber + 1,
            playerChoice: null,
            opponentChoice: null,
            roundResult: null,
          }
        })
      }, 4_000)
      return () => window.clearTimeout(timer)
    }
  }, [game.phase, game.phaseStartedAt])

  const choose = (choice: RockPaperScissorsChoice) => {
    if (game.phase !== 'choosing' || Date.now() >= game.phaseStartedAt + 3_000) return
    setGame((current) => current.phase === 'choosing' ? { ...current, playerChoice: choice } : current)
  }

  const remaining = Math.max(0, Math.ceil((game.phaseStartedAt + 3_000 - now) / 1_000))
  const playerWon = game.playerScore >= 3
  const shownPlayerChoice = game.playerChoice ?? 'rock'

  return (
    <main className="app rps-app">
      <header className="topbar rps-topbar">
        <div className="logo">ROCK <span>PAPER</span></div>
        <div className="rps-mode-label">ОДИНОЧНАЯ ИГРА</div>
      </header>

      <section className="rps-arena">
        {game.phase === 'choosing' && (
          <>
            <div className="rps-timer" aria-label={`Осталось ${remaining} секунд`}>{remaining}</div>
            <HandIllustration choice={shownPlayerChoice} className="rps-hand rps-my-hand" label="Твой выбор" />
            <div className="rps-choice-pyramid" aria-label="Выбери жест">
              <button
                type="button"
                className={`rps-choice-button ${shownPlayerChoice === 'rock' ? 'selected' : ''}`}
                aria-label="Камень"
                aria-pressed={shownPlayerChoice === 'rock'}
                disabled={remaining <= 0}
                onClick={() => choose('rock')}
              ><HandIllustration choice="rock" className="rps-hand-icon" /></button>
              <div className="rps-choice-row">
                <button
                  type="button"
                  className={`rps-choice-button ${shownPlayerChoice === 'scissors' ? 'selected' : ''}`}
                  aria-label="Ножницы"
                  aria-pressed={shownPlayerChoice === 'scissors'}
                  disabled={remaining <= 0}
                  onClick={() => choose('scissors')}
                ><HandIllustration choice="scissors" className="rps-hand-icon" /></button>
                <button
                  type="button"
                  className={`rps-choice-button ${shownPlayerChoice === 'paper' ? 'selected' : ''}`}
                  aria-label="Бумага"
                  aria-pressed={shownPlayerChoice === 'paper'}
                  disabled={remaining <= 0}
                  onClick={() => choose('paper')}
                ><HandIllustration choice="paper" className="rps-hand-icon" /></button>
              </div>
            </div>
          </>
        )}

        {game.phase === 'revealing' && game.playerChoice && game.opponentChoice && (
          <>
            <HandIllustration choice={game.opponentChoice} className="rps-hand rps-opponent-hand" label="Выбор соперника" />
            <HandIllustration choice={game.playerChoice} className="rps-hand rps-my-hand" label="Твой выбор" />
          </>
        )}

        {game.phase === 'result' && (
          <div className="rps-round-result">
            <div className="rps-round-score">{game.opponentScore}</div>
            <h1 className={`rps-round-title ${game.roundResult ?? 'draw'}`}>
              {game.roundResult === 'win' ? 'Победа' : game.roundResult === 'loss' ? 'Поражение' : 'Ничья'}
            </h1>
            <div className="rps-round-score">{game.playerScore}</div>
          </div>
        )}

        {game.phase === 'completed' && (
          <div className="rps-session-result">
            <h1 className={`rps-session-title ${playerWon ? 'win' : 'loss'}`}>
              {playerWon ? 'С победой!' : 'Не в этот раз'}
            </h1>
            <div className="rps-session-scores">
              <div className="rps-session-player">
                <span className="rps-session-name">{playerName}</span>
                <strong className="rps-session-score">{game.playerScore}</strong>
              </div>
              <span className="rps-session-separator">:</span>
              <div className="rps-session-player">
                <span className="rps-session-name">{game.opponentName}</span>
                <strong className="rps-session-score">{game.opponentScore}</strong>
              </div>
            </div>
            <button type="button" className="rps-exit-button" onClick={onBack}>ВЫЙТИ</button>
          </div>
        )}

        {game.phase === 'choosing' && (
          <div className="rps-phase-message">
            {game.playerChoice ? `Выбрано: ${CHOICE_LABELS[game.playerChoice]}` : 'Выбери жест'}
          </div>
        )}
      </section>
    </main>
  )
}
