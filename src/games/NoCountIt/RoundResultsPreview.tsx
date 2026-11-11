const PLAYERS = [
  { id: '1', name: 'Александр', answer: 17, error: 1 },
  { id: '2', name: 'Мария', answer: 22, error: 4 },
  { id: '3', name: 'Дмитрий', answer: 18, error: 0 },
  { id: '4', name: 'Екатерина', answer: 12, error: 6 },
]

export default function RoundResultsPreview() {
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
        padding: '24px 20px 20px',
        border: '1px solid #e7d2ad',
        borderRadius: 28,
        background: '#fffaf0',
        boxShadow: '0 18px 48px rgba(86, 58, 39, .16)',
      }}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 2, color: '#a17a50' }}>NO COUNT IT · МУЛЬТИПЛЕЕР</div>
          <h1 style={{ margin: '8px 0 0', fontSize: 30, lineHeight: 1.1, fontWeight: 1000 }}>
            РАУНД <span style={{ color: '#d17b35' }}>2</span>
          </h1>
          <p style={{ margin: '9px 0 0', color: '#8d7359', fontSize: 14 }}>Результаты раунда</p>
        </header>

        <div style={{
          padding: '15px 18px',
          marginBottom: 18,
          borderRadius: 18,
          background: 'linear-gradient(135deg, #f7e6c4, #f2d6a5)',
          border: '1px solid #e8c995',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.5, color: '#98744e' }}>ПРАВИЛЬНЫЙ ОТВЕТ</div>
          <div style={{ marginTop: 3, fontSize: 34, lineHeight: 1.1, fontWeight: 1000, color: '#70452d' }}>18</div>
        </div>

        <div style={{ display: 'grid', gap: 9 }}>
          {PLAYERS.map((player, index) => (
            <div key={player.id} style={{
              display: 'grid',
              gridTemplateColumns: '30px minmax(0, 1fr) auto auto',
              alignItems: 'center',
              gap: 9,
              padding: '12px 11px',
              borderRadius: 15,
              background: player.error === 0 ? '#e5f2df' : '#f7efdf',
              border: player.error === 0 ? '1px solid #c5dfb9' : '1px solid #eadcc3',
            }}>
              <div style={{
                width: 27, height: 27, borderRadius: 9,
                display: 'grid', placeItems: 'center',
                background: '#fffaf0', color: '#8c6b49', fontSize: 12, fontWeight: 900,
              }}>{index + 1}</div>
              <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{player.name}</strong>
              <div style={{ textAlign: 'center', minWidth: 37 }}>
                <div style={{ fontSize: 9, color: '#9a8062', fontWeight: 800 }}>ОТВЕТ</div>
                <strong style={{ fontSize: 17 }}>{player.answer}</strong>
              </div>
              <div style={{ textAlign: 'right', minWidth: 45 }}>
                <div style={{ fontSize: 9, color: '#9a8062', fontWeight: 800 }}>ОШИБКА</div>
                <strong style={{ fontSize: 17, color: player.error === 0 ? '#397b36' : '#80583a' }}>{player.error}</strong>
              </div>
            </div>
          ))}
        </div>

        <button type="button" style={{
          width: '100%',
          marginTop: 22,
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
