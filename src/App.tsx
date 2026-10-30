
import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import './App.css'

const tg = (window as Window & {
  Telegram?: {
    WebApp: {
      ready: () => void
      expand: () => void
        initData?: string
      initDataUnsafe?: {
        start_param?: string
        user?: {
          id?: number
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

type Duel = {
  id: string
  invite_code: string
  status: 'waiting' | 'playing' | 'finished'
  player1_telegram_id: string
  player1_name: string
  player1_score: number | null
  player2_telegram_id: string | null
  player2_name: string | null
  player2_score: number | null
  winner_telegram_id: string | null
  player1_ready: boolean
  player2_ready: boolean
  started_at: string | null
  ends_at: string | null
}


function App() {
  
  async function saveScore(finalScore: number) {
    console.log('SAVE SCORE ВЫЗВАНА:', finalScore, 'Telegram initData:', Boolean(tg?.initData));
    if (!tg?.initData) {
      console.warn('Telegram initData недоступен. Открой игру через Telegram.');
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('save-score', {
        body: {
          initData: tg.initData,
          score: finalScore,
        },
      });

      if (error) {
        console.error('Не удалось сохранить рекорд:', error.message);
        return;
      }

      console.log('Результат сохранён:', data);
    } catch (error) {
      console.error('Ошибка сохранения результата:', error);
    }
  }

  const user = tg?.initDataUnsafe?.user
  const userName = user?.first_name
  const userUsername = user?.username
  const userPhoto = user?.photo_url

  const [score, setScore] = useState(0)
  const scoreRef = useRef(0)

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
const [duel, setDuel] = useState<Duel | null>(null)
const duelRoundStartedRef = useRef(false)
const [duelLoading, setDuelLoading] = useState(false)
const [duelMessage, setDuelMessage] = useState('')

const [inviteHandled, setInviteHandled] = useState(false)


useEffect(() => {
  if (!tg?.initData) return

  const startParam = tg.initDataUnsafe?.start_param
  console.log('Параметр приглашения:', startParam)
  setDuelMessage(`Параметр приглашения: ${startParam ?? 'не получен'}`)

  if (!startParam?.startsWith('duel_')) return
  if (inviteHandled) return

  const inviteCode = startParam.slice('duel_'.length)
  if (!inviteCode) return

  setInviteHandled(true)
  void joinDuel(inviteCode)
}, [inviteHandled, tg?.initData])


useEffect(() => {
  if (!duel || duel.status === 'finished') return

  const intervalId = window.setInterval(() => {
    void refreshDuel()
  }, 2000)

  return () => window.clearInterval(intervalId)
}, [duel?.invite_code, duel?.status])

useEffect(() => {
  if (
    !duel ||
    duel.status !== 'playing' ||
    !duel.started_at ||
    !duel.ends_at
  ) {
    if (!duel?.started_at || duel.status !== 'playing') {
      duelRoundStartedRef.current = false
    }
    return
  }

  if (duelRoundStartedRef.current) return

  const startAt = new Date(duel.started_at).getTime()
  const endAt = new Date(duel.ends_at).getTime()

  let intervalId: number | undefined

  const timeoutId = window.setTimeout(() => {
    if (duelRoundStartedRef.current) return

    duelRoundStartedRef.current = true
    scoreRef.current = 0
    setScore(0)
    setTime(Math.max(0, Math.ceil((endAt - Date.now()) / 1000)))
    setPlaying(true)

    intervalId = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((endAt - Date.now()) / 1000)
      )

      setTime(remaining)

      if (remaining <= 0) {
        if (intervalId !== undefined) {
          window.clearInterval(intervalId)
        }

        setPlaying(false)
        setRounds((previous) => previous + 1)
        void submitDuelScore(scoreRef.current)
      }
    }, 100)
  }, Math.max(0, startAt - Date.now()))

  return () => {
    window.clearTimeout(timeoutId)

    if (intervalId !== undefined) {
      window.clearInterval(intervalId)
    }
  }
}, [duel?.invite_code, duel?.status, duel?.started_at, duel?.ends_at])





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
async function createDuel() {
  if (!tg?.initData) {
    setDuelMessage('Открой игру через Telegram, чтобы вызвать друга.')
    return
  }

  setDuelLoading(true)
  setDuelMessage('Создаём дуэль...')

  try {
    const { data, error } = await supabase.functions.invoke('duels', {
      body: {
        initData: tg.initData,
        action: 'create',
      },
    })

    if (error) throw error
    if (!data?.success || !data?.duel) {
      throw new Error(data?.error || 'Не удалось создать дуэль')
    }

    setDuel(data.duel as Duel)
    setDuelMessage('Дуэль создана! Пригласи друга по ссылке.')
  } catch (error) {
    console.error('Ошибка создания дуэли:', error)
    setDuelMessage('Не удалось создать дуэль. Попробуй ещё раз.')
  } finally {
    setDuelLoading(false)
  }
}


async function refreshDuel() {
  if (!tg?.initData || !duel?.invite_code) return

  try {
    const { data, error } = await supabase.functions.invoke('duels', {
      body: {
        initData: tg.initData,
        action: 'get',
        inviteCode: duel.invite_code,
      },
    })

    if (error) throw error

    if (data?.success && data?.duel) {
      const currentDuel = data.duel as Duel
      setDuel(currentDuel)

      if (currentDuel.status === 'waiting') {
        setDuelMessage('Ждём второго игрока...')
      } else if (currentDuel.status === 'playing') {
        if (!currentDuel.started_at) {
          setDuelMessage('Друг присоединился! Оба игрока должны нажать «Готов»!')
        } else if (Date.now() < new Date(currentDuel.started_at).getTime()) {
          setDuelMessage('Приготовься! Скоро начало!')
        } else if (currentDuel.ends_at && Date.now() < new Date(currentDuel.ends_at).getTime()) {
          setDuelMessage('Битва идёт! Жми как можно быстрее!')
        } else {
          setDuelMessage('Время вышло! Ожидаем результат...')
        }
      } else if (currentDuel.status === 'finished') {
  const myId = String(tg?.initDataUnsafe?.user?.id)

  if (currentDuel.winner_telegram_id === null) {
    setDuelMessage('Ничья! ⚔️')
  } else if (currentDuel.winner_telegram_id === myId) {
    setDuelMessage('Ты победил! 🏆')
  } else {
    setDuelMessage('Ты проиграл! Попробуй ещё раз!')
  }
}
    }
  } catch (error) {
    console.error('Ошибка обновления дуэли:', error)
  }
}

async function readyDuel() {
  if (!tg?.initData || !duel?.invite_code || duel.status !== 'playing') {
    return
  }

  setDuelLoading(true)
  setDuelMessage('Отправляем готовность...')

  try {
    const { data, error } = await supabase.functions.invoke('duels', {
      body: {
        initData: tg.initData,
        action: 'ready',
        inviteCode: duel.invite_code,
      },
    })

    if (error) throw error

    if (data?.success && data?.duel) {
      setDuel(data.duel as Duel)
      await refreshDuel()
    } else {
      setDuelMessage(data?.error || 'Не удалось начать дуэль')
    }
  } catch (error) {
    console.error('Ошибка готовности к дуэли:', error)
    setDuelMessage('Не удалось отправить готовность. Попробуй ещё раз.')
  } finally {
    setDuelLoading(false)
  }
}



async function joinDuel(inviteCode: string) {
  if (!tg?.initData) {
    setDuelMessage('Открой игру через Telegram, чтобы присоединиться к дуэли.')
    return
  }

  setDuelLoading(true)
  setDuelMessage('Подключаемся к дуэли...')

  try {
    const { data, error } = await supabase.functions.invoke('duels', {
      body: {
        initData: tg.initData,
        action: 'join',
        inviteCode,
      },
    })

    if (error) throw error

    if (!data?.success || !data?.duel) {
      throw new Error(data?.error || 'Не удалось присоединиться к дуэли')
    }

    setDuel(data.duel as Duel)
    setDuelMessage('Ты присоединился к дуэли! Удачи в битве!')
  } catch (error) {
    console.error('Ошибка подключения к дуэли:', error)
    setDuelMessage(
      error instanceof Error
        ? error.message
        : 'Не удалось присоединиться к дуэли.',
    )
  } finally {
    setDuelLoading(false)
  }
}


function startGame() {
  if (duel?.status === 'playing') {
    if (!duel.started_at || !duel.ends_at) {
      setDuelMessage('Оба игрока должны нажать «Готов»!')
      return
    }

    const startAt = new Date(duel.started_at).getTime()
    const endAt = new Date(duel.ends_at).getTime()
    const now = Date.now()

    if (now < startAt) {
      setDuelMessage('Приготовься! Битва скоро начнётся.')
      return
    }

    if (now >= endAt) {
      setDuelMessage('Время вышло! Отправляем результат...')
      setPlaying(false)
      void submitDuelScore(scoreRef.current)
      return
    }

    setScore(0)
    scoreRef.current = 0
    setTime(Math.ceil((endAt - now) / 1000))
    setPlaying(true)

    const timer = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((endAt - Date.now()) / 1000)
      )

      setTime(remaining)

      if (remaining <= 0) {
        window.clearInterval(timer)
        setPlaying(false)
        setRounds((previous) => previous + 1)
        void submitDuelScore(scoreRef.current)
      }
    }, 200)

    return
  }

  setScore(0)
  scoreRef.current = 0
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
      void saveScore(scoreRef.current)
    }
  }, 1000)
}


  function tap() {
    if (!playing) return

    setScore((previous) => {
      const next = previous + 1
      scoreRef.current = next
      setBest((oldBest) => Math.max(oldBest, next))
      return next
    })
  }

async function submitDuelScore(finalScore: number) {
  if (!tg?.initData || !duel?.invite_code) {
    setDuelMessage('Не удалось отправить результат дуэли.')
    return
  }

  setDuelLoading(true)

  try {
    const { data, error } = await supabase.functions.invoke('duels', {
      body: {
        initData: tg.initData,
        action: 'submit',
        inviteCode: duel.invite_code,
        score: finalScore,
      },
    })

    if (error) throw error

    if (data?.success && data?.duel) {
      setDuel(data.duel as Duel)

      if (data.duel.status === 'finished') {
        setDuelMessage(
          data.duel.winner_telegram_id === null
            ? 'Ничья! ⚔️'
            : data.duel.winner_telegram_id === String(tg.initDataUnsafe?.user?.id)
              ? 'Ты победил! 🏆'
              : 'Друг победил! Попробуй ещё раз!'
        )
      } else {
        setDuelMessage('Результат отправлен! Ждём соперника...')
      }
    } else {
      setDuelMessage(data?.error || 'Не удалось отправить результат.')
    }
  } catch (error) {
    console.error('Ошибка отправки результата дуэли:', error)
    setDuelMessage('Не удалось отправить результат. Попробуй обновить игру.')
  } finally {
    setDuelLoading(false)
  }
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
  FRIEND <span>BATTLE</span>
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
          
<button
  className="play-button"
  onClick={startGame}
  disabled={playing || duel?.status === 'playing'}
>
  {playing
    ? 'БИТВА ИДЁТ!'
    : duel?.status === 'playing'
      ? 'ОЖИДАЕМ РЕЗУЛЬТАТ'
      : score > 0
        ? 'ИГРАТЬ ЕЩЁ'
        : 'НАЧАТЬ ИГРУ'}
</button>

        )}
      </section>

     

<section className="invite-card">
  <div className="invite-icon">⚔️</div>
  <div className="invite-text">
    <strong>Вызови друга!</strong>
    <p>
      {duelMessage ||
        'Создай дуэль и узнай, кто быстрее!'}
    </p>
    {duel && (
  <>
    <p>
      Код дуэли: <strong>{duel.invite_code}</strong>
    </p>
    
    {duel.status === 'playing' && (
      <>
        <p>
          Игрок 1: {duel.player1_ready ? '✅ Готов' : '⏳ Ожидает'}
          <br />
          Игрок 2: {duel.player2_ready ? '✅ Готов' : '⏳ Ожидает'}
        </p>

        {!duel.started_at && (
          <button
            className="invite-button"
            disabled={duelLoading || (duel.player1_telegram_id === String(tg?.initDataUnsafe?.user?.id) ? duel.player1_ready : duel.player2_ready)}
            onClick={readyDuel}
          >
            {duelLoading ? 'ОЖИДАЙ...' : 'ГОТОВ К БИТВЕ ⚔️'}
          </button>
        )}
      </>
    )}

    <button
      className="invite-button"
      onClick={() => {
        
const inviteUrl =
  `https://t.me/yourpartygame_bot/FriendBattle?startapp=duel_${duel.invite_code}`

        const shareUrl =
          `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent('Сразись со мной в Friend Battle! ⚔️')}`
        window.open(shareUrl, '_blank')
      }}
    >
      ОТПРАВИТЬ ДРУГУ
    </button>
  </>
)}
  </div>
  <button
    className="invite-button"
    disabled={duelLoading}
    onClick={createDuel}
  >
    {duelLoading ? 'СОЗДАЁМ...' : 'ВЫЗВАТЬ'}
  </button>
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