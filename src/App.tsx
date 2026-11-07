import { useState } from 'react'
import './App.css'
import DevMultiplayerSmokeTest from './multiplayer/DevSmokeTest'
import { useReactionRush } from './games/ReactionRush/useReactionRush'
import ReactionRush from './games/ReactionRush/ReactionRush'
import BrainBattle from './games/BrainBattle/BrainBattle'
import RockPaperScissorsSolo from './games/rockPaperScissors/RockPaperScissorsSolo'
import { MainMenu, MultiplayerRoomMenu, SoloRoomMenu } from './menus'
import type { GameId } from './menus'
import BottomNavigation from './components/BottomNavigation/BottomNavigation'
import PlayerProfile from './components/PlayerProfile/PlayerProfile'
import { telegramUser, telegramInitData, telegramStartParam } from './services/telegram'

type Screen = 'home' | 'solo-room' | 'reaction-game' | 'brain-game' | 'rock-paper-scissors' | 'multiplayer-room' | 'profile'

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

  const user = telegramUser
  const userName = user?.first_name
  const userUsername = user?.username
  const userPhoto = user?.photo_url

  const { score, rounds, best, playing, time, startSoloGame, tap } = useReactionRush()

  function startSelectedSoloGame(gameId: GameId) {
    if (gameId === 'reaction-rush') {
      setScreen('reaction-game')
      startSoloGame()
    } else if (gameId === 'brain-battle') {
      setScreen('brain-game')
    } else {
      setScreen('rock-paper-scissors')
    }
  }

  const showBottomNavigation = screen === 'home' || screen === 'profile'

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

      {screen === 'rock-paper-scissors' && <RockPaperScissorsSolo onBack={() => setScreen('solo-room')} />}

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
          activeTab={screen === 'profile' ? 'profile' : 'games'}
          onGames={() => setScreen('home')}
          onProfile={() => setScreen('profile')}
        />
      )}
    </>
  )
}

export default App
