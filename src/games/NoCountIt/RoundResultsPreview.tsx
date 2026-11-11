const PLAYERS = [
  { id: '1', name: 'Александр', answer: 17, error: 1 },
  { id: '2', name: 'Мария', answer: 22, error: 4 },
  { id: '3', name: 'Дмитрий', answer: 18, error: 0 },
  { id: '4', name: 'Екатерина', answer: 12, error: 6 },
]

const CORRECT_ANSWER = 18

const ROUND_CANDY_COLORS = [
  { name: 'розовый', value: '#d85b91' },
  { name: 'бирюзовый', value: '#269b9b' },
  { name: 'оранжевый', value: '#e58a36' },
  { name: 'фиолетовый', value: '#8962bd' },
  { name: 'зелёный', value: '#69a64b' },
]

const RESULT_ROW_GAP = 58
const RESULT_ROW_HEIGHT = 42
const MARKER_CLEARANCE = 28
const ANSWER_WINDOW_HEIGHT = 62

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

const PLAYER_NAME_COLORS = shuffle(ROUND_CANDY_COLORS)

type PositionedPlayer = {
  id: string
  name: string
  answer: number
  error: number
  nameColor: string
  scoreColor: string
  labelSide: 'left' | 'right'
  top: number
}

function positionPlayers() {
  const ordered = [...PLAYERS].sort((a, b) => b.answer - a.answer)
  const upperPlayers = ordered.filter((player) => player.answer > CORRECT_ANSWER)
  const lowerPlayers = ordered.filter((player) => player.answer <= CORRECT_ANSWER)
  const upperSpace = Math.max(170, upperPlayers.length * RESULT_ROW_GAP + 24)
  const lowerSpace = Math.max(170, lowerPlayers.length * RESULT_ROW_GAP + 24)
  const scaleHeight = upperSpace + ANSWER_WINDOW_HEIGHT + lowerSpace
  const upperMaxDeviation = Math.max(
    1,
    ...upperPlayers.map((player) => player.answer - CORRECT_ANSWER),
  )
  const lowerMaxDeviation = Math.max(
    1,
    ...lowerPlayers.map((player) => CORRECT_ANSWER - player.answer),
  )

  const positioned = new Map<string, number>()
  let previousUpperTop = Number.POSITIVE_INFINITY

  // Place the closest upper answer first. If two entries collide, only the
  // farther-from-center entry is moved outward by the minimum required gap.
  for (const player of [...upperPlayers].reverse()) {
    const deviation = player.answer - CORRECT_ANSWER
    const ratio = deviation / upperMaxDeviation
    const desiredTop = upperSpace - MARKER_CLEARANCE - ratio * (upperSpace - MARKER_CLEARANCE - 12)
    const top = Math.min(desiredTop, previousUpperTop - RESULT_ROW_GAP)
    positioned.set(player.id, top)
    previousUpperTop = top
  }

  let previousLowerTop = Number.NEGATIVE_INFINITY

  // The lower half uses the same rule, moving farther-low answers downwards.
  for (const player of lowerPlayers) {
    const deviation = CORRECT_ANSWER - player.answer
    const ratio = deviation / lowerMaxDeviation
    const desiredTop = upperSpace + ANSWER_WINDOW_HEIGHT + MARKER_CLEARANCE
      + ratio * (lowerSpace - MARKER_CLEARANCE - 12)
    const top = Math.max(desiredTop, previousLowerTop + RESULT_ROW_GAP)
    positioned.set(player.id, top)
    previousLowerTop = top
  }

  const sideById = new Map(ordered.map((player, index) => [
    player.id,
    index % 2 === 0 ? 'left' : 'right',
  ] as const))

  const players: PositionedPlayer[] = PLAYERS.map((player, index) => ({
    ...player,
    nameColor: PLAYER_NAME_COLORS[index % PLAYER_NAME_COLORS.length].value,
    scoreColor: player.answer > CORRECT_ANSWER
      ? '#388b43'
      : player.answer < CORRECT_ANSWER
        ? '#d34e43'
        : '#8b704f',
    labelSide: sideById.get(player.id) ?? 'left',
    top: positioned.get(player.id) ?? scaleHeight / 2,
  }))

  return {
    players,
    upperSpace,
    lowerSpace,
    scaleHeight,
    answerWindowTop: upperSpace,
  }
}

export default function RoundResultsPreview() {
  const layout = positionPlayers()
  const lineBottom = layout.answerWindowTop + ANSWER_WINDOW_HEIGHT

  return (
    <main style={{
      minHeight: '100vh',
      boxSizing: 'border-box',
      padding: '28px 16px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'radial-gradient(circle at top, #fff0c9 0, #f2dfb5 48%, #e7c995 100%)',
      color: '#563a27',
      fontFamily: 'Nunito, sans-serif',
    }}>
      <section style={{
        width: 'min(100%, 430px)',
        boxSizing: 'border-box',
        padding: '24px 18px 20px',
        border: '1px solid #e7d2ad',
        borderRadius: 28,
        background: '#fffaf0',
        boxShadow: '0 18px 48px rgba(86, 58, 39, .16)',
      }}>
        <header style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 2, color: '#a17a50' }}>NO COUNT IT · МУЛЬТИПЛЕЕР</div>
          <h1 style={{ margin: '8px 0 0', fontSize: 30, lineHeight: 1.1, fontWeight: 1000 }}>
            РАУНД <span style={{ color: '#d17b35' }}>2</span>
          </h1>
          <p style={{ margin: '9px 0 0', color: '#8d7359', fontSize: 14 }}>Результаты раунда</p>
        </header>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0 5px 8px',
          color: '#9a8062',
          fontSize: 10,
          fontWeight: 900,
          letterSpacing: 1,
        }}>
          <span>ИГРОК И ОТВЕТ</span>
          <span>ОШИБКИ</span>
        </div>

        <div style={{
          position: 'relative',
          height: layout.scaleHeight,
          margin: '0 0 8px',
          borderRadius: 20,
          background: 'linear-gradient(90deg, rgba(247,230,196,.28), rgba(242,214,165,.16) 50%, rgba(247,230,196,.28))',
          border: '1px solid #f0e2c9',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            top: 12,
            height: layout.answerWindowTop - 12,
            left: '50%',
            width: 4,
            transform: 'translateX(-50%)',
            borderRadius: '4px 4px 0 0',
            background: 'linear-gradient(180deg, #d8bd91, #b48b5d)',
            boxShadow: '0 0 0 4px rgba(180,139,93,.08)',
          }} />
          <div style={{
            position: 'absolute',
            top: lineBottom,
            bottom: 12,
            left: '50%',
            width: 4,
            transform: 'translateX(-50%)',
            borderRadius: '0 0 4px 4px',
            background: 'linear-gradient(180deg, #b48b5d, #d8bd91)',
            boxShadow: '0 0 0 4px rgba(180,139,93,.08)',
          }} />

          {layout.players.map((player) => {
            const labelOnLeft = player.labelSide === 'left'
            const label = (
              <div style={{
                minWidth: 0,
                padding: labelOnLeft ? '0 20px 0 8px' : '0 8px 0 20px',
                textAlign: labelOnLeft ? 'right' : 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: labelOnLeft ? 'flex-end' : 'flex-start',
                gap: 5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                fontSize: 15,
                lineHeight: 1.15,
                fontWeight: 1000,
              }}>
                {labelOnLeft ? (
                  <>
                    <span style={{ color: player.nameColor, overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.name}</span>
                    <span style={{ color: '#65482f', flexShrink: 0 }}>- {player.answer}</span>
                  </>
                ) : (
                  <>
                    <span style={{ color: '#65482f', flexShrink: 0 }}>{player.answer} -</span>
                    <span style={{ color: player.nameColor, overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.name}</span>
                  </>
                )}
              </div>
            )
            const score = (
              <div style={{
                minWidth: 0,
                padding: labelOnLeft ? '0 8px 0 20px' : '0 20px 0 8px',
                textAlign: labelOnLeft ? 'left' : 'right',
                fontSize: 23,
                lineHeight: 1,
                fontWeight: 1000,
                color: player.scoreColor,
              }}>
                {player.error}
              </div>
            )

            return (
              <div key={player.id} style={{
                position: 'absolute',
                top: player.top,
                left: 0,
                right: 0,
                height: RESULT_ROW_HEIGHT,
                transform: 'translateY(-50%)',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                alignItems: 'center',
              }}>
                {labelOnLeft ? label : score}
                {labelOnLeft ? score : label}
                <div style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: 15,
                  height: 15,
                  transform: 'translate(-50%, -50%)',
                  borderRadius: '50%',
                  background: player.nameColor,
                  border: '3px solid #fffaf0',
                  boxShadow: '0 1px 5px rgba(86,58,39,.28)',
                  zIndex: 2,
                }} />
              </div>
            )
          })}

          <div style={{
            position: 'absolute',
            left: '50%',
            top: layout.answerWindowTop,
            height: ANSWER_WINDOW_HEIGHT,
            width: 92,
            boxSizing: 'border-box',
            transform: 'translateX(-50%)',
            zIndex: 3,
            borderRadius: 14,
            border: '2px solid #fffaf0',
            background: '#704a30',
            color: '#fffaf0',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            boxShadow: '0 3px 10px rgba(86,58,39,.24)',
          }}>
            <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1 }}>ВЕРНО</div>
            <div style={{ fontSize: 25, lineHeight: 1.1, fontWeight: 1000 }}>{CORRECT_ANSWER}</div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 14,
          margin: '8px 0 0',
          fontSize: 10,
          color: '#9a8062',
          fontWeight: 800,
        }}>
          <span><span style={{ color: '#388b43', fontSize: 14 }}>●</span> Больше правильного</span>
          <span><span style={{ color: '#d34e43', fontSize: 14 }}>●</span> Меньше правильного</span>
        </div>

        <button type="button" style={{
          width: '100%',
          marginTop: 20,
          padding: '15px 18px',
          border: 0,
          borderRadius: 16,
          background: 'linear-gradient(180deg, #d8794d, #b94e32)',
          boxShadow: '0 5px 0 #913c29, 0 9px 16px rgba(116, 54, 34, .18), inset 0 1px 0 rgba(255,255,255,.3)',
          color: '#fffaf0',
          font: '900 14px Nunito, sans-serif',
          letterSpacing: .4,
          cursor: 'pointer',
        }}>
          Выйти досрочно
        </button>
        <p style={{ margin: '13px 0 0', textAlign: 'center', fontSize: 11, color: '#a18a6d' }}>
          Временный макет · данные примера
        </p>
      </section>
    </main>
  )
}
