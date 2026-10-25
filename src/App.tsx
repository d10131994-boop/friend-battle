
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
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

type LeaderboardPlayer = {
  telegram_id: string
  username: string | null
  first_name: string
  best_score: number
}

function App() {
  const user = tg?.initDataUnsafe?.user
  const userName = user?.first_name
  const userUsername = user?.username
  const userPhoto = user?.photo_url

  const [score, setScore] = useState(0)

  const [rounds, setRounds] = useState(() => {
    const savedRounds = localStorage.getItem('friendBattleRounds')
    return savedRounds ? Number(savedRounds) : 0
  })

  const [best, setBest] = useState(() => {
    const savedBest = localStorage.getItem('friendBattleBest')
    return savedBest ? Number(savedBest) : 0
  })

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(10)
  const [showLeaderboard, setShowLeaderboard] = useState(false)

  const [leaderboard, setLeaderboard] = useState<LeaderboardPlayer[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState('')

  useEffect(() => {
    localStorage.setItem('friendBattleBest', String(best))
  }, [best])

  useEffect(() => {
    localStorage.setItem('friendBattleRounds', String(rounds))
  }, [rounds])

  async function loadLeaderboard() {
    setLeaderboardLoading(true)
    setLeaderboardError('')

    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('telegram_id, username, first_name, best_score')
        .order('best_score', { ascending: false })
        .limit(50)

      if (error) {
        console.error('Ошибка загрузки рейтинга:', error.message)
        setLeaderboardError('Не удалось загрузить рейтинг. Попробуй позже.')
      } else {
        setLeaderboard(data ?? [])
      }
    } catch (error) {
      console.error('Ошибка загрузки рейтинга:', error)
      setLeaderboardError('Не удалось загрузить рейтинг. Проверь подключение.')
    } finally {
      setLeaderboardLoading(false)
    }
  }

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
        setRounds((previous) => previous + 1)
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

  function openLeaderboard() {
    setShowLeaderboard(true)
    void loadLeaderboard()
  }

  function closeLeaderboard() {
    setShowLeaderboard(false)
  }

  return showLeaderboard ? (
    <main className="app">
      <header className="topbar">
        <div className="logo">
          FB<span>⚡</span>
        </div>

        <button
          className="leaderboard-button"
          onClick={closeLeaderboard}
        >
          ← Назад к игре
        </button>
      </header>

      <section className="hero">
        <div className="eyebrow">FRIEND BATTLE</div>
        <h1>
          ТАБЛИЦА<br />
          <span>ЛИДЕРОВ</span>
        </h1>
        <p>Соревнуйся с лучшими игроками!</p>
      </section>

      <section className="stats">
        <div className="stat-card">
          <span>🏆</span>
          <div>
            <small>ТВОЙ РЕКОРД</small>
            <strong>{best}</strong>
          </div>
        </div>
      </section>

      <section className="leaderboard-list">
        {leaderboardLoading && (
          <p>Загружаем рейтинг...</p>
        )}

        {!leaderboardLoading && leaderboardError && (
          <p>{leaderboardError}</p>
        )}

        {!leaderboardLoading &&
          !leaderboardError &&
          leaderboard.length === 0 && (
            <p>Пока игроков нет. Стань первым!</p>
          )}

        {!leaderboardLoading &&
          !leaderboardError &&
          leaderboard.map((player, index) => (
            <div
              className="leaderboard-row"
              key={player.telegram_id}
            >
              <span>
                {index === 0
                  ? '🥇'
                  : index === 1
                    ? '🥈'
                    : index === 2
                      ? '🥉'
                      : `${index + 1}.`}
              </span>

              <div>
                <strong>{player.first_name || 'Игрок'}</strong>
                <small>
                  {player.username
                    ? `@${player.username}`
                    : 'Игрок Friend Battle'}
                </small>
              </div>

              <strong>{player.best_score}</strong>
            </div>
          ))}
      </section>

      <button
        className="leaderboard-button"
        onClick={() => void loadLeaderboard()}
      >
        ↻ Обновить рейтинг
      </button>
    </main>
  ) : (
    <main className="app">
      <header className="topbar">
        <div className="logo">
          FB<span>⚡</span>
        </div>
        <div className="player-level">НОВИЧОК · LVL 1</div>
      </header>

      <section className="hero">
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

      <button
        className="leaderboard-button"
        onClick={openLeaderboard}
      >
        🏆 Таблица лидеров
      </button>

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
        <div className="nav-item active">
          ⚔️<span>Игра</span>
        </div>

        <div className="nav-item" onClick={openLeaderboard}>
          🏆<span>Рейтинг</span>
        </div>

        <div className="nav-item">
          👤<span>Профиль</span>
        </div>
      </nav>
       </main>
  )
}

export default App