
import { useState } from 'react'
import './App.css'

const tg = (window as Window & {
  Telegram?: {
    WebApp: {
      ready: () => void
      expand: () => void
      initDataUnsafe?: {
        user?: {
          first_name?: string
username?: string
photo_url?: string
        }
      }
    }
  }
}).Telegram?.WebApp

if (tg) {
  tg.ready()
  tg.expand()
}

function App() {
    const userName = tg?.initDataUnsafe?.user?.first_name
  const userUsername = tg?.initDataUnsafe?.user?.username
  const userPhoto = tg?.initDataUnsafe?.user?.photo_url

  const [score, setScore] = useState(0)
  const [best, setBest] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(10)

  function startGame() {
    setScore(0)
    setTime(10)
    setPlaying(true)

    let remaining = 10
    const timer = window.setInterval(() => {
      remaining -= 1
      setTime(remaining)

      if (remaining <= 0) {
        window.clearInterval(timer)
        setPlaying(false)
      }
    }, 1000)
  }

  function tap() {
    if (!playing) return

    setScore((previous) => {
      const next = previous + 1
      setBest((oldBest) => Math.max(oldBest, next))
      return next
    })
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="logo">FB<span>⚡</span></div>
        <div className="player-level">НОВИЧОК · LVL 1</div>
      </header>

      <section className="hero">
       
<div className="profile-card">
  <div className="profile-avatar">
    {userPhoto ? (
      <img src={userPhoto} alt="Аватар игрока" />
    ) : (
      <span>{(userName || 'И').charAt(0).toUpperCase()}</span>
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
  </div>
</div>

        <p>Докажи, кто здесь лучший!</p>
      </section>

      <section className="stats">
        <div className="stat-card">
          <span>🏆</span>
          <div>
            <small>ТВОЙ РЕКОРД</small>
            <strong>{best}</strong>
          </div>
        </div>
        <div className="stat-card">
          <span>⚡</span>
          <div>
            <small>ОЧКИ МАТЧА</small>
            <strong>{score}</strong>
          </div>
        </div>
      </section>

      <section className="game-card">
        <div className="game-label">MINI GAME #01</div>
        <div className="game-icon">⚡</div>
        <h2>REACTION RUSH</h2>
        <p>
          {playing
            ? `Жми как можно быстрее! Осталось: ${time} сек.`
            : 'Набери максимум очков за 10 секунд.'}
        </p>

        {playing ? (
          <button className="play-button" onClick={tap}>
            ЖМИ! ⚡
          </button>
        ) : (
          <button className="play-button" onClick={startGame}>
            {score > 0 ? 'ИГРАТЬ ЕЩЁ' : 'НАЧАТЬ ИГРУ'}
          </button>
        )}
      </section>

      <section className="invite-card">
        <div className="invite-icon">👥</div>
        <div className="invite-text">
          <strong>Вызови друга!</strong>
          <p>Скоро здесь появятся дуэли и рейтинг.</p>
        </div>
        <span className="coming-soon">SOON</span>
      </section>

      <nav className="bottom-nav">
        <div className="nav-item active">⚔️<span>Игра</span></div>
        <div className="nav-item">🏆<span>Рейтинг</span></div>
        <div className="nav-item">👤<span>Профиль</span></div>
      </nav>
    </main>
  )
}

export default App
