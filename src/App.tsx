import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import './App.css'
import DevMultiplayerSmokeTest from './multiplayer/DevSmokeTest'
import { useReactionRush } from './games/ReactionRush/useReactionRush'
import ReactionRushMenu from './games/ReactionRush/ReactionRushMenu'
import ReactionRush from './games/ReactionRush/ReactionRush'
import ReactionRushMultiplayer from './games/ReactionRush/ReactionRushMultiplayer'
import GameCatalog from './components/GameCatalog/GameCatalog'
import BottomNavigation from './components/BottomNavigation/BottomNavigation'
import PlayerProfile from './components/PlayerProfile/PlayerProfile'
import BrainBattleMenu from './games/BrainBattle/BrainBattleMenu'
import BrainBattle from './games/BrainBattle/BrainBattle'
import BrainBattleRoom from './games/BrainBattle/BrainBattleRoom'
import { telegramUser, telegramInitData, telegramStartParam } from './services/telegram'

type LeaderboardPlayer = {
  telegram_id: string
  username: string | null
  first_name: string
  best_score: number
}

type Screen =
  | 'games'
  | 'reaction-menu'
  | 'reaction-game'
  | 'reaction-multiplayer'
  | 'brain-menu'
  | 'brain-game'
  | 'brain-battle-room'
  | 'rating'
  | 'profile'

function App() {
  const [screen, setScreen] = useState<Screen>('games')
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

  useEffect(() => {
    if (telegramStartParam?.startsWith('rr_')) setScreen('reaction-multiplayer')
    if (telegramStartParam?.startsWith('bb_')) setScreen('brain-battle-room')
  }, [telegramStartParam])

  function openRating() {
    setScreen('rating')
    void loadLeaderboard()
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="logo">FRIEND <span>BATTLE</span></div>
        <div className="player-level">НОВИЧОК · LVL 1</div>
      </header>

      {screen === 'games' && (
        <>
          <section className="hero">
            <PlayerProfile userName={userName} userUsername={userUsername} userPhoto={userPhoto} score={score} best={best} rounds={rounds} />
            <p>Докажи, кто здесь лучший!</p>
          </section>
          <GameCatalog
            onOpenReactionRush={() => setScreen('reaction-menu')}
            onOpenBrainBattle={() => setScreen('brain-menu')}
            onOpenMultiplayer={() => setScreen('reaction-multiplayer')}
          />
        </>
      )}

      {screen === 'reaction-menu' && (
        <ReactionRushMenu
          onSoloGame={() => {
            setScreen('reaction-game')
            startSoloGame()
          }}
          onMultiplayerGame={() => setScreen('reaction-multiplayer')}
          onBack={() => setScreen('games')}
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
            if (!playing) setScreen('reaction-menu')
          }}
        />
      )}

      {screen === 'reaction-multiplayer' && (
        <ReactionRushMultiplayer
          initData={telegramInitData}
          inviteCode={telegramStartParam?.startsWith('rr_') ? telegramStartParam.slice(3) : undefined}
          onBack={() => setScreen('games')}
        />
      )}

      {screen === 'brain-menu' && (
        <BrainBattleMenu
          onSoloGame={() => setScreen('brain-game')}
          onMultiplayerGame={() => setScreen('brain-battle-room')}
          onBack={() => setScreen('games')}
        />
      )}

      {screen === 'brain-game' && <BrainBattle onBack={() => setScreen('brain-menu')} />}
      {screen === 'brain-battle-room' && (
        <BrainBattleRoom
          initData={telegramInitData}
          inviteCode={telegramStartParam?.startsWith('bb_') ? telegramStartParam.slice(3) : undefined}
          onBack={() => setScreen('brain-menu')}
        />
      )}

      {screen === 'rating' && (
        <>
          <section className="hero">
            <div className="eyebrow">FRIEND BATTLE</div>
            <h1>ТАБЛИЦА<br /><span>ЛИДЕРОВ</span></h1>
            <p>Соревнуйся с лучшими игроками!</p>
          </section>
          <section className="stats">
            <div className="stat-card">
              <span>🏆</span>
              <div><small>ТВОЙ РЕКОРД</small><strong>{best}</strong></div>
            </div>
          </section>
          <section className="leaderboard-list">
            {leaderboardLoading && <p>Загружаем рейтинг...</p>}
            {!leaderboardLoading && leaderboardError && <p>{leaderboardError}</p>}
            {!leaderboardLoading && !leaderboardError && leaderboard.length === 0 && <p>Пока игроков нет. Стань первым!</p>}
            {!leaderboardLoading && !leaderboardError && leaderboard.map((player, index) => (
              <div className="leaderboard-row" key={player.telegram_id}>
                <span>{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}</span>
                <div>
                  <strong>{player.first_name || 'Игрок'}</strong>
                  <small>{player.username ? `@${player.username}` : 'Игрок Friend Battle'}</small>
                </div>
                <strong>{player.best_score}</strong>
              </div>
            ))}
          </section>
          <button className="leaderboard-button" onClick={() => void loadLeaderboard()}>↻ Обновить рейтинг</button>
        </>
      )}

      {screen === 'profile' && (
        <>
          <section className="hero"><div className="eyebrow">FRIEND BATTLE</div><h1>ТВОЙ <span>ПРОФИЛЬ</span></h1></section>
          <PlayerProfile userName={userName} userUsername={userUsername} userPhoto={userPhoto} score={score} best={best} rounds={rounds} />
        </>
      )}

      {import.meta.env.DEV && new URLSearchParams(window.location.search).get('multiplayer-smoke') === '1' && <DevMultiplayerSmokeTest />}

      <BottomNavigation
        activeTab={screen === 'rating' ? 'rating' : screen === 'profile' ? 'profile' : 'games'}
        onGames={() => setScreen('games')}
        onRating={openRating}
        onProfile={() => setScreen('profile')}
      />
    </main>
  )
}

export default App
