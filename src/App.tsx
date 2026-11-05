import { useState } from 'react'
import { supabase } from './supabase'
import './App.css'
import DevMultiplayerSmokeTest from './multiplayer/DevSmokeTest'
import { useReactionRush } from './games/ReactionRush/useReactionRush'
import ReactionRush from './games/ReactionRush/ReactionRush'
import BrainBattle from './games/BrainBattle/BrainBattle'
import { MainMenu, MultiplayerRoomMenu, SoloRoomMenu } from './menus'
import type { GameId } from './menus'
import BottomNavigation from './components/BottomNavigation/BottomNavigation'
import PlayerProfile from './components/PlayerProfile/PlayerProfile'
import { telegramUser, telegramInitData, telegramStartParam } from './services/telegram'

type LeaderboardPlayer = {
  telegram_id: string
  username: string | null
  first_name: string
  best_score: number
}
type Screen = 'home' | 'solo-room' | 'reaction-game' | 'brain-game' | 'multiplayer-room' | 'rating' | 'profile'

function getInviteCode(startParam: string | undefined): string | undefined {
  if (!startParam) return undefined
  for (const prefix of ['fb_', 'rr_', 'bb_']) {
    if (startParam.startsWith(prefix)) return startParam.slice(prefix.length).trim() || undefined
  }
  return undefined
}

function App() {
  const inviteCode = getInviteCode(telegramStartParam)
  const [screen, setScreen] = useState<Screen>(inviteCode ? 'multiplayer-room' : 'home')
  const [leaderboard, setLeaderboard] = useState<LeaderboardPlayer[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState('')

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
        body: { initData: telegramInitData, score: finalScore },
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

  const { score, rounds, best, playing, time, startSoloGame, tap } =
    useReactionRush({ onSaveScore: saveScore })

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

  function openRating() {
    setScreen('rating')
    void loadLeaderboard()
  }

  function startSelectedSoloGame(gameId: GameId) {
    if (gameId === 'reaction-rush') {
      setScreen('reaction-game')
      startSoloGame()
    } else {
      setScreen('brain-game')
    }
  }

  const showBottomNavigation = screen === 'home' || screen === 'rating' || screen === 'profile'

  return (
    <>
      {screen === 'home' && (
        <main className="app">
          <header className="topbar">
            <div className="logo">FRIEND <span>BATTLE</span></div>
            <div className="player-level">НОВИЧОК · LVL 1</div>
          </header>
          <section className="hero">
            <PlayerProfile userName={userName} userUsername={userUsername} userPhoto={userPhoto} score={score} best={best} rounds={rounds} />
            <p>Докажи, кто здесь лучший!</p>
          </section>
          <MainMenu
            onSolo={() => setScreen('solo-room')}
            onMultiplayer={() => setScreen('multiplayer-room')}
          />
          {import.meta.env.DEV && new URLSearchParams(window.location.search).get('multiplayer-smoke') === '1' && <DevMultiplayerSmokeTest />}
        </main>
      )}

      {screen === 'solo-room' && (
        <SoloRoomMenu onBack={() => setScreen('home')} onStart={startSelectedSoloGame} />
      )}

      {screen === 'multiplayer-room' && (
        <MultiplayerRoomMenu
          initData={telegramInitData}
          inviteCode={inviteCode}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'reaction-game' && (
        <ReactionRush
          score={score}
          time={time}
          playing={playing}
          mode="solo"
          onStart={startSoloGame}
          onTap={tap}
          onBack={() => {
            if (!playing) setScreen('solo-room')
          }}
        />
      )}

      {screen === 'brain-game' && <BrainBattle onBack={() => setScreen('solo-room')} />}

      {screen === 'rating' && (
        <main className="app">
          <header className="topbar">
            <div className="logo">FRIEND <span>BATTLE</span></div>
            <div className="player-level">РЕЙТИНГ</div>
          </header>
          <section className="hero">
            <div className="eyebrow">FRIEND BATTLE</div>
            <h1>ТАБЛИЦА<br /><span>ЛИДЕРОВ</span></h1>
            <p>Соревнуйся с лучшими игроками!</p>
          </section>
          <section className="stats">
            <div className="stat-card"><span>🏆</span><div><small>ТВОЙ РЕКОРД</small><strong>{best}</strong></div></div>
          </section>
          <section className="leaderboard-list">
            {leaderboardLoading && <p>Загружаем рейтинг...</p>}
            {!leaderboardLoading && leaderboardError && <p>{leaderboardError}</p>}
            {!leaderboardLoading && !leaderboardError && leaderboard.length === 0 && <p>Пока игроков нет. Стань первым!</p>}
            {!leaderboardLoading && !leaderboardError && leaderboard.map((player, index) => (
              <div className="leaderboard-row" key={player.telegram_id}>
                <span>{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1 + '.'}</span>
                <div><strong>{player.first_name || 'Игрок'}</strong><small>{player.username ? '@' + player.username : 'Игрок Friend Battle'}</small></div>
                <strong>{player.best_score}</strong>
              </div>
            ))}
          </section>
          <button className="leaderboard-button" onClick={() => void loadLeaderboard()}>↻ Обновить рейтинг</button>
        </main>
      )}

      {screen === 'profile' && (
        <main className="app">
          <header className="topbar">
            <div className="logo">FRIEND <span>BATTLE</span></div>
            <div className="player-level">ПРОФИЛЬ</div>
          </header>
          <section className="hero"><div className="eyebrow">FRIEND BATTLE</div><h1>ТВОЙ <span>ПРОФИЛЬ</span></h1></section>
          <PlayerProfile userName={userName} userUsername={userUsername} userPhoto={userPhoto} score={score} best={best} rounds={rounds} />
        </main>
      )}

      {showBottomNavigation && (
        <BottomNavigation
          activeTab={screen === 'rating' ? 'rating' : screen === 'profile' ? 'profile' : 'games'}
          onGames={() => setScreen('home')}
          onRating={openRating}
          onProfile={() => setScreen('profile')}
        />
      )}
    </>
  )
}

export default App
