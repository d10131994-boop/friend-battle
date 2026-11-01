
type BrainBattleMenuProps = {
  onSoloGame: () => void
  onMultiplayerGame: () => void
  onBack: () => void
}

function BrainBattleMenu({
  onSoloGame,
  onMultiplayerGame,
  onBack,
}: BrainBattleMenuProps) {
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
        <div className="eyebrow">MINI GAME #02</div>

        <div className="game-icon">🧠</div>

        <h1>
          BRAIN<br />
          <span>BATTLE</span>
        </h1>

        <p>
          Проверь свою логику, внимательность
          и эрудицию! Ответь на 10 вопросов
          и набери максимум очков.
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

export default BrainBattleMenu

