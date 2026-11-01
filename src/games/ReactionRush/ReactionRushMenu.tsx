type ReactionRushMenuProps = {
  onSoloGame: () => void
  onMultiplayerGame: () => void
  onBack: () => void
}

function ReactionRushMenu({
  onSoloGame,
  onMultiplayerGame,
  onBack,
}: ReactionRushMenuProps) {
  return (
    <main className="app">
      <header className="topbar">
        <button
          className="leaderboard-button"
          onClick={onBack}
        >
          ← Назад к играм
        </button>
      </header>

      <section className="hero">
        <div className="eyebrow">MINI GAME #01</div>

        <div className="game-icon">⚡</div>

        <h1>
          REACTION<br />
          <span>RUSH</span>
        </h1>

        <p>
          Проверь скорость своей реакции!
          Набери максимум очков за 10 секунд.
        </p>
      </section>

      <section className="game-card">
        <button
          className="play-button"
          onClick={onSoloGame}
        >
          ОДИНОЧНАЯ ИГРА
        </button>

        <button
          className="invite-button"
          onClick={onMultiplayerGame}
        >
          ИГРАТЬ С ДРУГОМ ⚔️
        </button>
      </section>
    </main>
  )
}

export default ReactionRushMenu