import { useState } from 'react'

export type GameId = 'reaction-rush' | 'brain-battle'

type SoloRoomMenuProps = {
  onBack: () => void
  onStart: (gameId: GameId) => void
}

export function SoloRoomMenu({ onBack, onStart }: SoloRoomMenuProps) {
  const [gameId, setGameId] = useState<GameId>('reaction-rush')

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
        <select className="invite-input" value={gameId} onChange={(event) => setGameId(event.target.value as GameId)}>
          <option value="reaction-rush">Reaction Rush</option>
          <option value="brain-battle">Brain Battle</option>
        </select>
        <button className="play-button" onClick={() => onStart(gameId)}>НАЧАТЬ</button>
      </section>
    </main>
  )
}
