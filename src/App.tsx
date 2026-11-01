
import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import './App.css'

import { useReactionRush } from './games/ReactionRush/useReactionRush'
import ReactionRushMenu from './games/ReactionRush/ReactionRushMenu'
import ReactionRush from './games/ReactionRush/ReactionRush'
import GameCatalog from './components/GameCatalog/GameCatalog'
import BottomNavigation from './components/BottomNavigation/BottomNavigation'
import PlayerProfile from './components/PlayerProfile/PlayerProfile'
import BrainBattleMenu from './games/BrainBattle/BrainBattleMenu'
import BrainBattle from './games/BrainBattle/BrainBattle'
import BrainBattleRoom from './games/BrainBattle/BrainBattleRoom'

import {
  telegramUser,
  telegramInitData,
  telegramStartParam,
} from './services/telegram'

import {
  type Duel,
  createDuelRequest,
  getDuelRequest,
  readyDuelRequest,
  joinDuelRequest,
  submitDuelScoreRequest,
} from './services/duels'

type LeaderboardPlayer = {
  telegram_id: string
  username: string | null
  first_name: string
  best_score: number
}

type Screen =
  | 'games'
  | 'reaction-menu'
  | 'brain-menu'
  | 'reaction-game'
  | 'brain-game'
  | 'brain-battle-room'
  | 'rating'
  | 'profile'

type GameMode = 'solo' | 'multiplayer'

function App() {
  const [screen, setScreen] = useState<Screen>('games')
  const [gameMode, setGameMode] = useState<GameMode>('solo')

  const user = telegramUser
  const userName = user?.first_name
  const userUsername = user?.username
  const userPhoto = user?.photo_url

  async function saveScore(finalScore: number) {
    if (!telegramInitData) {
      console.warn('Telegram initData недоступен.')
      return
    }

    try {
      const { data, error } = await supabase.functions.invoke('save-score', {
        body: {
          initData: telegramInitData,
          score: finalScore,
        },
      })

      if (error) {
        console.error('Не удалось сохранить рекорд:', error.message)
        return
      }

      console.log('Результат сохранён:', data)
    } catch (error) {
      console.error('Ошибка сохранения результата:', error)
    }
  }

  const {
    score,
    setScore,
    scoreRef,
    rounds,
    setRounds,
    best,
    playing,
    setPlaying,
    time,
    setTime,
    startSoloGame,
    tap,
  } = useReactionRush({
    onSaveScore: saveScore,
  })

  const [duel, setDuel] = useState<Duel | null>(null)
  const duelRoundStartedRef = useRef(false)
  const [duelLoading, setDuelLoading] = useState(false)
  const [duelMessage, setDuelMessage] = useState('')
  const [inviteHandled, setInviteHandled] = useState(false)

  const [leaderboard, setLeaderboard] = useState<LeaderboardPlayer[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState('')

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
    if (!telegramInitData) {
      setDuelMessage('Открой игру через Telegram, чтобы вызвать друга.')
      return
    }

    setDuelLoading(true)
    setDuelMessage('Создаём дуэль...')

    try {
      const newDuel = await createDuelRequest(telegramInitData)

      setDuel(newDuel)
      setDuelMessage('Дуэль создана! Пригласи друга по ссылке.')
    } catch (error) {
      console.error('Ошибка создания дуэли:', error)
      setDuelMessage('Не удалось создать дуэль. Попробуй ещё раз.')
    } finally {
      setDuelLoading(false)
    }
  }

  async function refreshDuel() {
    if (!telegramInitData || !duel?.invite_code) return

    try {
      const currentDuel = await getDuelRequest(
        telegramInitData,
        duel.invite_code,
      )

      setDuel(currentDuel)

      if (currentDuel.status === 'waiting') {
        setDuelMessage('Ждём второго игрока...')
      } else if (currentDuel.status === 'playing') {
        if (!currentDuel.started_at) {
          setDuelMessage('Друг присоединился! Оба игрока должны нажать «Готов»!')
        } else if (Date.now() < new Date(currentDuel.started_at).getTime()) {
          setDuelMessage('Приготовься! Скоро начало!')
        } else if (
          currentDuel.ends_at &&
          Date.now() < new Date(currentDuel.ends_at).getTime()
        ) {
          setDuelMessage('Битва идёт! Жми как можно быстрее!')
        } else {
          setDuelMessage('Время вышло! Ожидаем результат...')
        }
      } else if (currentDuel.status === 'finished') {
        const myId = String(telegramUser?.id)

        if (currentDuel.winner_telegram_id === null) {
          setDuelMessage('Ничья! ⚔️')
        } else if (currentDuel.winner_telegram_id === myId) {
          setDuelMessage('Ты победил! 🏆')
        } else {
          setDuelMessage('Ты проиграл! Попробуй ещё раз!')
        }
      }
    } catch (error) {
      console.error('Ошибка обновления дуэли:', error)
    }
  }

  async function readyDuel() {
    if (!telegramInitData || !duel?.invite_code || duel.status !== 'playing') {
      return
    }

    setDuelLoading(true)
    setDuelMessage('Отправляем готовность...')

    try {
      const updatedDuel = await readyDuelRequest(
        telegramInitData,
        duel.invite_code,
      )

      setDuel(updatedDuel)
      await refreshDuel()
    } catch (error) {
      console.error('Ошибка готовности к дуэли:', error)
      setDuelMessage('Не удалось отправить готовность. Попробуй ещё раз.')
    } finally {
      setDuelLoading(false)
    }
  }

  async function joinDuel(inviteCode: string) {
    if (!telegramInitData) {
      setDuelMessage('Открой игру через Telegram, чтобы присоединиться к дуэли.')
      return
    }

    setDuelLoading(true)
    setDuelMessage('Подключаемся к дуэли...')

    try {
      const joinedDuel = await joinDuelRequest(
        telegramInitData,
        inviteCode,
      )

      setDuel(joinedDuel)
      setGameMode('multiplayer')
      setScreen('reaction-game')
      setDuelMessage('Ты присоединился к дуэли! Удачи в битве!')
    } catch (error) {
      console.error('Ошибка подключения к дуэли:', error)
      setDuelMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось присоединиться к дуэли.',
      )
      setScreen('reaction-game')
      setGameMode('multiplayer')
    } finally {
      setDuelLoading(false)
    }
  }

  async function submitDuelScore(finalScore: number) {
    if (!telegramInitData || !duel?.invite_code) {
      setDuelMessage('Не удалось отправить результат дуэли.')
      return
    }

    setDuelLoading(true)

    try {
      const updatedDuel = await submitDuelScoreRequest(
        telegramInitData,
        duel.invite_code,
        finalScore,
      )

      setDuel(updatedDuel)

      if (updatedDuel.status === 'finished') {
        setDuelMessage(
          updatedDuel.winner_telegram_id === null
            ? 'Ничья! ⚔️'
            : updatedDuel.winner_telegram_id === String(telegramUser?.id)
              ? 'Ты победил! 🏆'
              : 'Друг победил! Попробуй ещё раз!',
        )
      } else {
        setDuelMessage('Результат отправлен! Ждём соперника...')
      }
    } catch (error) {
      console.error('Ошибка отправки результата дуэли:', error)
      setDuelMessage('Не удалось отправить результат. Попробуй обновить игру.')
    } finally {
      setDuelLoading(false)
    }
  }

  useEffect(() => {
    if (!telegramInitData) return

    if (!telegramStartParam?.startsWith('duel_')) return
    if (inviteHandled) return

    const inviteCode = telegramStartParam.slice('duel_'.length)
    if (!inviteCode) return

    setInviteHandled(true)
    setGameMode('multiplayer')
    setScreen('reaction-game')
    void joinDuel(inviteCode)
  }, [inviteHandled, telegramInitData, telegramStartParam])

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
          Math.ceil((endAt - Date.now()) / 1000),
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

  function openReactionRush() {
    setScreen('reaction-menu')
  }
  function openBrainBattle() {
  setScreen('brain-menu')
}

  function startSelectedGame() {
    if (gameMode === 'solo') {
      setDuel(null)
      setDuelMessage('')
      setScreen('reaction-game')
      startSoloGame()
      return
    }

    setScreen('reaction-game')

    if (duel?.status === 'playing') {
      if (!duel.started_at) {
        void readyDuel()
      } else {
        setDuelMessage('Битва уже запущена. Жми как можно быстрее!')
      }
    } else if (!duel || duel.status === 'finished') {
      setDuelMessage('Создай дуэль или открой приглашение друга.')
    }
  }

  function openRating() {
    setScreen('rating')
    void loadLeaderboard()
  }

  function openProfile() {
    setScreen('profile')
  }

  function backToGames() {
    if (playing) return
    setScreen('games')
  }

  function shareDuel() {
    if (!duel?.invite_code) return

    const inviteUrl =
      `https://t.me/yourpartygame_bot/FriendBattle?startapp=duel_${duel.invite_code}`

    const shareUrl =
      `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent('Сразись со мной в Friend Battle! ⚔️')}`

    window.open(shareUrl, '_blank')
  }

  function renderMultiplayerPanel() {
    return (
      <section className="invite-card">
        <div className="invite-icon">⚔️</div>

        <div className="invite-text">
          <strong>Битва с другом</strong>
          <p>{duelMessage || 'Создай дуэль и узнай, кто быстрее!'}</p>

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
                      disabled={
                        duelLoading ||
                        (duel.player1_telegram_id === String(telegramUser?.id)
                          ? duel.player1_ready
                          : duel.player2_ready)
                      }
                      onClick={() => void readyDuel()}
                    >
                      {duelLoading ? 'ОЖИДАЙ...' : 'ГОТОВ К БИТВЕ ⚔️'}
                    </button>
                  )}
                </>
              )}

              <button
                className="invite-button"
                onClick={shareDuel}
              >
                ОТПРАВИТЬ ДРУГУ
              </button>
            </>
          )}
        </div>

        <button
          className="invite-button"
          disabled={duelLoading}
          onClick={() => void createDuel()}
        >
          {duelLoading ? 'СОЗДАЁМ...' : 'ВЫЗВАТЬ'}
        </button>
      </section>
    )
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="logo">
          FRIEND <span>BATTLE</span>
        </div>

        <div className="player-level">НОВИЧОК · LVL 1</div>
      </header>

      {screen === 'games' && (
        <>
          <section className="hero">
            <PlayerProfile
              userName={userName}
              userUsername={userUsername}
              userPhoto={userPhoto}
              score={score}
              best={best}
              rounds={rounds}
            />
            <p>Докажи, кто здесь лучший!</p>
          </section>

        <GameCatalog
  onOpenReactionRush={openReactionRush}
  onOpenBrainBattle={openBrainBattle}
/>

        </>
      )}

      {screen === 'reaction-menu' && (
        <ReactionRushMenu
          onSoloGame={() => {
            setGameMode('solo')
            setScreen('reaction-game')
          }}
          onMultiplayerGame={() => {
            setGameMode('multiplayer')
            setScreen('reaction-game')
          }}
          onBack={backToGames}
        />
      )}

      {screen === 'brain-menu' && (
  <BrainBattleMenu
    onSoloGame={() => {
      setScreen('brain-game')
    }}
    onMultiplayerGame={() => {
  setScreen('brain-battle-room')
}}
    onBack={backToGames}
  />
)}
{screen === 'brain-game' && (
  <BrainBattle
    onBack={() => setScreen('brain-menu')}
  />
)}
{screen === 'brain-battle-room' && (
  <BrainBattleRoom
    onBack={() => setScreen('brain-menu')}
  />
)}

      {screen === 'reaction-game' && (
        <>
          <ReactionRush
            score={score}
            time={time}
            playing={playing}
            mode={gameMode}
            disabled={
              gameMode === 'multiplayer' &&
              (duelLoading || duel?.status !== 'playing')
            }
            message={
              gameMode === 'multiplayer'
                ? duelMessage || 'Создай дуэль или присоединись к другу.'
                : undefined
            }
            onStart={startSelectedGame}
            onTap={tap}
            onBack={() => {
              if (playing) return
              setScreen('reaction-menu')
            }}
          />

          {gameMode === 'multiplayer' && renderMultiplayerPanel()}
        </>
      )}

      {screen === 'rating' && (
        <>
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
            {leaderboardLoading && <p>Загружаем рейтинг...</p>}

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
        </>
      )}

      {screen === 'profile' && (
        <>
          <section className="hero">
            <div className="eyebrow">FRIEND BATTLE</div>
            <h1>
              ТВОЙ <span>ПРОФИЛЬ</span>
            </h1>
          </section>

          <PlayerProfile
            userName={userName}
            userUsername={userUsername}
            userPhoto={userPhoto}
            score={score}
            best={best}
            rounds={rounds}
          />
        </>
      )}

      <BottomNavigation
        activeTab={
          screen === 'rating'
            ? 'rating'
            : screen === 'profile'
              ? 'profile'
              : 'games'
        }
        onGames={() => setScreen('games')}
        onRating={openRating}
        onProfile={openProfile}
      />
    </main>
  )
}

export default App
