
type PlayerProfileProps = {
  userName?: string
  userUsername?: string
  userPhoto?: string
  score: number
  best: number
  rounds: number
}

function PlayerProfile({
  userName,
  userUsername,
  userPhoto,
  score,
  best,
  rounds,
}: PlayerProfileProps) {
  return (
    <div className="profile-card">
      <div className="profile-avatar">
        {userPhoto ? (
          <img src={userPhoto} alt="Аватар игрока" />
        ) : (
          <span>
            {(userName || 'И').charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className="profile-info">
        <div className="profile-greeting">ТВОЙ ПРОФИЛЬ</div>
        <div className="profile-name">{userName || 'Игрок'}</div>
        <div className="profile-username">
          {userUsername ? `@${userUsername}` : 'Игрок Friend Battle'}
        </div>
      </div>

      <div className="profile-level-badge">LVL 1</div>

      <div className="profile-stats">
        <div className="profile-stat">
          <span>⚡</span>
          <strong>{score}</strong>
          <small>ОЧКИ</small>
        </div>

        <div className="profile-stat">
          <span>🏆</span>
          <strong>{best}</strong>
          <small>РЕКОРД</small>
        </div>

        <div className="profile-stat">
          <span>🎮</span>
          <strong>{rounds}</strong>
          <small>РАУНДЫ</small>
        </div>
      </div>
    </div>
  )
}

export default PlayerProfile
