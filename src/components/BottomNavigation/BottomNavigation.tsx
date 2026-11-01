type BottomNavigationProps = {
  activeTab: 'games' | 'rating' | 'profile'
  onGames: () => void
  onRating: () => void
  onProfile: () => void
}

function BottomNavigation({
  activeTab,
  onGames,
  onRating,
  onProfile,
}: BottomNavigationProps) {
  return (
    <nav className="bottom-nav">
      <button
        className={`nav-item ${activeTab === 'games' ? 'active' : ''}`}
        onClick={onGames}
      >
        ⚔️<span>Игры</span>
      </button>

      <button
        className={`nav-item ${activeTab === 'rating' ? 'active' : ''}`}
        onClick={onRating}
      >
        🏆<span>Рейтинг</span>
      </button>

      <button
        className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={onProfile}
      >
        👤<span>Профиль</span>
      </button>
    </nav>
  )
}

export default BottomNavigation
