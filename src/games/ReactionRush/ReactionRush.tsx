type ReactionRushProps = {
  score: number
  time: number
  playing: boolean
  mode: 'solo' | 'multiplayer'
  disabled?: boolean
  message?: string
  onStart: () => void
  onTap: () => void
  onBack: () => void
}

function ReactionRush({
  score,
  time,
  playing,
  mode,
  disabled = false,
  message,
  onStart,
  onTap,
  onBack,
}: ReactionRushProps) {
  return (
    <main className="app">
      <header className="topbar">
        <button
          className="leaderboard-button"
          onClick={onBack}
          disabled={playing}
        >
          ← Назад
        </button>

        <div className="logo">
          FRIEND <span>BATTLE</span>
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow">
          {mode === 'solo' ? 'ОДИНОЧНАЯ ИГРА' : 'БИТВА С ДРУГОМ'}
        </div>

        <div className="game-icon">⚡</div>

        <h1>
          REACTION<br />
          <span>RUSH</span>
        </h1>

        <p>
          {playing
            ? `Жми как можно быстрее! Осталось: ${time} сек.`
            : mode === 'solo'
              ? 'Набери максимум очков за 10 секунд!'
              : 'Покажи другу, кто быстрее!'}
        </p>
      </section>

      <section className="stats">
        <div className="stat-card">
          <span>⚡</span>
          <div>
            <small>ТВОИ ОЧКИ</small>
            <strong>{score}</strong>
          </div>
        </div>

        <div className="stat-card">
          <span>⏱️</span>
          <div>
            <small>ОСТАЛОСЬ</small>
            <strong>{time}</strong>
          </div>
        </div>
      </section>

      <section className="game-card">
        {message && <p>{message}</p>}

        {playing ? (
          <button
            className="play-button"
            onClick={onTap}
          >
            ЖМИ! ⚡
          </button>
        ) : (
          <button
            className="play-button"
            onClick={onStart}
            disabled={disabled}
          >
            {disabled ? 'ОЖИДАЕМ...' : 'НАЧАТЬ ИГРУ'}
          </button>
        )}
      </section>
    </main>
  )
}

export default ReactionRush