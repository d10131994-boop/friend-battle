type BottomNavigationProps = {
  activeTab: 'games' | 'profile'
  onGames: () => void
  onProfile: () => void
}

function BottomNavigation({
  activeTab,
  onGames,
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
        className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={onProfile}
      >
        👤<span>Профиль</span>
      </button>
    </nav>
  )
}

export default BottomNavigation
