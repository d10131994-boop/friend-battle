type GameCatalogProps = {
  onOpenReactionRush: () => void
  onOpenBrainBattle: () => void
  onOpenMultiplayer: () => void
}

function GameCatalog({
  onOpenReactionRush,
  onOpenBrainBattle,
  onOpenMultiplayer,
}: GameCatalogProps) {
  return (
    <section className="game-catalog">
      <div className="catalog-heading">
        <div className="eyebrow">FRIEND BATTLE</div>
        <h1>
          ВЫБИРАЙ <span>ИГРУ</span>
        </h1>
        <p>Соревнуйся с друзьями и докажи, кто лучший!</p>
        <button className="invite-button" onClick={onOpenMultiplayer}>
          ИГРАТЬ С ДРУЗЬЯМИ ⚔️
        </button>
      </div>

      <div className="catalog-games">
        <button
          className="catalog-game-card reaction-card"
          onClick={onOpenReactionRush}
        >
          <span className="catalog-game-number">MINI GAME #01</span>
          <span className="catalog-game-icon">⚡</span>
          <strong>REACTION RUSH</strong>
          <span className="catalog-game-description">
            Проверка скорости реакции
          </span>
          <span className="catalog-game-status">УЖЕ ДОСТУПНА</span>
        </button>

        <button
          className="catalog-game-card brain-card"
          onClick={onOpenBrainBattle}
        >
          <span className="catalog-game-number">MINI GAME #02</span>
          <span className="catalog-game-icon">🧠</span>
          <strong>BRAIN BATTLE</strong>
          <span className="catalog-game-description">
            Испытание интеллекта
          </span>
          <span className="catalog-game-status">СКОРО</span>
        </button>
      </div>
    </section>
  )
}

export default GameCatalog