type MainMenuProps = {
  onSolo: () => void
  onMultiplayer: () => void
}

export function MainMenu({ onSolo, onMultiplayer }: MainMenuProps) {
  return (
    <section className="game-card">
      <h2>КАК БУДЕМ ИГРАТЬ?</h2>
      <button className="play-button" onClick={onSolo}>ОДИНОЧНАЯ ИГРА</button>
      <button className="leaderboard-button" onClick={onMultiplayer}>СОВМЕСТНАЯ ИГРА</button>
    </section>
  )
}
