import { useState } from 'react'
import { RoundScene } from './RpsScenes'
import './rockPaperScissors.css'

const previewStyle = `
  .dev-rps { min-height: 100svh; padding: 24px; color: #292820; background: #eee9dc; font-family: system-ui, sans-serif; }
  .dev-rps__header { max-width: 900px; margin: 0 auto 18px; display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
  .dev-rps__header h1 { margin:0; font-size:22px; }
  .dev-rps__controls { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .dev-rps button { border:1px solid #8b806e; border-radius:9px; padding:9px 13px; background:#fffaf0; color:#292820; font-weight:700; cursor:pointer; }
  .dev-rps__stage { position:relative; width:min( min(100%, 420px), calc((100svh - 180px) * 360 / 700)); height:min( min(700px, calc(100svh - 180px)), calc(100vw * 700 / 360)); min-height:420px; margin:0 auto; overflow:hidden; border:8px solid #fffaf0; border-radius:20px; box-shadow:0 12px 34px #51473325; background:#d8dfcf; }
  .dev-rps__stage .rps-round-scene { position:absolute; inset:0; }
  .dev-rps__note { max-width:900px; margin:16px auto; color:#625b4f; font-size:13px; line-height:1.5; }
  @media(max-width:520px) { .dev-rps { padding:14px; } .dev-rps__stage { min-height: min(620px, calc(100svh - 190px)); } }
`

export default function DevRpsScene() {
  const [seed, setSeed] = useState(() => `preview-${Date.now()}`)
  const [version, setVersion] = useState(1)
  const regenerate = () => {
    setSeed(`preview-${Date.now()}-${Math.random()}`)
    setVersion((value) => value + 1)
  }

  return (
    <main className="dev-rps">
      <style>{previewStyle}</style>
      <header className="dev-rps__header">
        <div>
          <h1>RPS — предпросмотр сцены</h1>
          <div>Вариант композиции №{version}</div>
        </div>
        <div className="dev-rps__controls">
          <button type="button" onClick={regenerate}>Другая композиция</button>
          <button type="button" onClick={() => setSeed('fixed-reference')}>Исходный вариант</button>
        </div>
      </header>
      <section className="dev-rps__stage" aria-label="Предпросмотр раундовой сцены">
        <RoundScene seed={seed} />
      </section>
      <p className="dev-rps__note">
        Это отдельная тестовая страница: игровой матч и Supabase не запускаются.
        Кнопка «Другая композиция» меняет seed и показывает доступную вариацию текущего генератора.
        Сейчас предметы намеренно оставлены без дополнительных искажений — сначала оцениваем узнаваемость.
      </p>
    </main>
  )
}
