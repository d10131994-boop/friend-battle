import { useState } from 'react'
import './App.css'
import DevMultiplayerSmokeTest from './multiplayer/DevSmokeTest'
import SceneGeneratorPreview from './games/NoCountIt/SceneGeneratorPreview'
import { useReactionRush } from './games/ReactionRush/useReactionRush'
import ReactionRushSolo from './games/ReactionRush/ReactionRushSolo'
import BrainBattle from './games/BrainBattle/BrainBattle'
import RockPaperScissorsSolo from './games/rockPaperScissors/RockPaperScissorsSolo'
import DemocracyMergeSolo from './games/DemocracyMerge/DemocracyMergeSolo'
import { MainMenu, MultiplayerRoomMenu, SoloRoomMenu } from './menus'
import type { GameId } from './menus'
import BottomNavigation from './components/BottomNavigation/BottomNavigation'
import PlayerProfile from './components/PlayerProfile/PlayerProfile'
import { telegramUser, telegramInitData, telegramStartParam } from './services/telegram'

type Screen = 'home' | 'solo-room' | 'reaction-game' | 'brain-game' | 'rock-paper-scissors' | 'democracy-solo' | 'multiplayer-room' | 'profile'

function getInviteCode(startParam: string | undefined): string | undefined {
  if (!startParam) return undefined
  for (const prefix of ['fb_', 'rr_', 'bb_']) {
    if (startParam.startsWith(prefix)) return startParam.slice(prefix.length).trim() || undefined
  }
  return undefined
}

function AppContent() {
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
    } else if (gameId === 'brain-battle') {
      setScreen('brain-game')
    } else if (gameId === 'rock-paper-scissors') {
      setScreen('rock-paper-scissors')
    } else if (gameId === 'democracy-merge') {
      setScreen('democracy-solo')
    } else {
      const unreachableGame: never = gameId
      throw new Error(`Solo game route is not implemented: ${unreachableGame}`)
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
        <ReactionRushSolo onBack={() => setScreen('solo-room')} />
      )}

      {screen === 'brain-game' && <BrainBattle onBack={() => setScreen('solo-room')} />}

      {screen === 'rock-paper-scissors' && <RockPaperScissorsSolo onBack={() => setScreen('solo-room')} />}

      <div hidden={screen !== 'democracy-solo'}><DemocracyMergeSolo onBack={() => setScreen('solo-room')} /></div>

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

export default function App() {
  const params = new URLSearchParams(window.location.search)
  if (import.meta.env.DEV && params.get('no-count-it-generator') === '1') {
    return <SceneGeneratorPreview />
  }
  return <AppContent />
}
