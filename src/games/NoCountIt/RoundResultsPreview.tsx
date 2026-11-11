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

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

const PLAYER_NAME_COLORS = shuffle(ROUND_CANDY_COLORS)

export default function RoundResultsPreview() {
  const maxDeviation = Math.max(
    1,
    ...PLAYERS.map((player) => Math.abs(player.answer - CORRECT_ANSWER)),
  )

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
          <span>ОТВЕТ И ИГРОК</span>
          <span>БАЛЛЫ</span>
        </div>

        <div style={{
          position: 'relative',
          height: 450,
          margin: '0 0 8px',
          borderRadius: 20,
          background: 'linear-gradient(90deg, rgba(247,230,196,.28), rgba(242,214,165,.16) 50%, rgba(247,230,196,.28))',
          border: '1px solid #f0e2c9',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            top: '7%',
            bottom: '7%',
            left: '50%',
            width: 4,
            transform: 'translateX(-50%)',
            borderRadius: 4,
            background: 'linear-gradient(180deg, #d8bd91, #b48b5d 50%, #d8bd91)',
            boxShadow: '0 0 0 4px rgba(180,139,93,.08)',
          }} />

          {PLAYERS.map((player, index) => {
            const offset = ((player.answer - CORRECT_ANSWER) / maxDeviation) * 39
            const top = 50 - offset
            const nameColor = PLAYER_NAME_COLORS[index % PLAYER_NAME_COLORS.length].value
            const scoreColor = player.answer > CORRECT_ANSWER
              ? '#388b43'
              : player.answer < CORRECT_ANSWER
                ? '#d34e43'
                : '#8b704f'

            return (
              <div key={player.id} style={{
                position: 'absolute',
                top: `${top}%`,
                left: 0,
                right: 0,
                transform: 'translateY(-50%)',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                alignItems: 'center',
                minHeight: 42,
              }}>
                <div style={{
                  minWidth: 0,
                  padding: '0 18px 0 8px',
                  textAlign: 'right',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 1,
                }}>
                  <strong style={{
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    lineHeight: 1,
                    color: nameColor,
                  }}>{player.name}</strong>
                  <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 1000, color: '#65482f' }}>{player.answer}</span>
                </div>
                <div style={{
                  minWidth: 0,
                  padding: '0 8px 0 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 1,
                }}>
                  <strong style={{ fontSize: 18, lineHeight: 1, color: scoreColor }}>{player.error}</strong>
                  <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: .7, color: '#a18a6d' }}>БАЛЛОВ</span>
                </div>
                <div style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: 13,
                  height: 13,
                  transform: 'translate(-50%, -50%)',
                  borderRadius: '50%',
                  background: nameColor,
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
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 3,
            padding: '8px 11px 7px',
            borderRadius: 12,
            border: '2px solid #fffaf0',
            background: '#704a30',
            color: '#fffaf0',
            textAlign: 'center',
            boxShadow: '0 3px 10px rgba(86,58,39,.24)',
            whiteSpace: 'nowrap',
          }}>
            <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: 1 }}>ВЕРНО</div>
            <div style={{ fontSize: 22, lineHeight: 1, fontWeight: 1000 }}>{CORRECT_ANSWER}</div>
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
