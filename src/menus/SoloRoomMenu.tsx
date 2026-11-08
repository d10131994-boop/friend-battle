import { useCallback, useEffect, useState } from 'react'
import {
  getGamePresentation,
  loadGameAvailability,
} from './gameAvailability'
import type { GameAvailability, SoloGameId } from './gameAvailability'

export type GameId = SoloGameId

type SoloRoomMenuProps = {
  onBack: () => void
  onStart: (gameId: GameId) => void
}

export function SoloRoomMenu({ onBack, onStart }: SoloRoomMenuProps) {
  const [games, setGames] = useState<GameAvailability[]>([])
  const [gameId, setGameId] = useState<GameId | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshGames = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const availableGames = await loadGameAvailability('solo')
      setGames(availableGames)
      setGameId((current) =>
        availableGames.some((game) => game.game_id === current)
          ? current
          : (availableGames[0]?.game_id as GameId | undefined) ?? '',
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить список игр.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    loadGameAvailability('solo')
      .then((availableGames) => {
        if (!active) return
        setGames(availableGames)
        setGameId((current) =>
          availableGames.some((game) => game.game_id === current)
            ? current
            : (availableGames[0]?.game_id as GameId | undefined) ?? '',
        )
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить список игр.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="app">
      <header className="topbar">
        <button className="leaderboard-button menu-back-button" onClick={onBack}>← НАЗАД</button>
        <div className="logo">FRIEND <span>BATTLE</span></div>
      </header>
      <section className="hero">
        <div className="eyebrow">ОДИНОЧНАЯ ИГРА</div>
        <div className="game-icon">🎮</div>
        <h1>ВЫБЕРИ <span>ИГРУ</span></h1>
        <p>Тренируйся и улучшай собственный результат</p>
      </section>
      <section className="game-card">
        <h2>ВЫБОР ИГРЫ</h2>
        {loading ? (
          <p>Загружаем список игр…</p>
        ) : error ? (
          <>
            <p role="alert">{error}</p>
            <button className="play-button" onClick={() => void refreshGames()}>ПОВТОРИТЬ</button>
          </>
        ) : games.length === 0 ? (
          <p>Сейчас нет игр, доступных в одиночном режиме.</p>
        ) : (
          <>
            <select
              className="invite-input"
              value={gameId}
              onChange={(event) => setGameId(event.target.value as GameId)}
            >
              {games.map((game) => (
                <option key={game.game_id} value={game.game_id}>
                  {getGamePresentation(game.game_id)?.title ?? game.game_id}
                </option>
              ))}
            </select>
            <button
              className="play-button"
              onClick={() => gameId && onStart(gameId)}
              disabled={!gameId}
            >
              НАЧАТЬ
            </button>
          </>
        )}
      </section>
    </main>
  )
}
