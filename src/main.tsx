import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Не найден корневой элемент приложения (#root).')
}

const root = createRoot(rootElement)

if (import.meta.env.DEV && window.location.pathname === '/dev/rps-scene') {
  void import('./games/rockPaperScissors/DevRpsScene.tsx').then(({ default: DevRpsScene }) => {
    root.render(<StrictMode><DevRpsScene /></StrictMode>)
  }).catch((error: unknown) => {
    console.error('Не удалось загрузить предпросмотр RPS:', error)
    root.render(<div className="startup-error"><h1>Не удалось открыть предпросмотр</h1></div>)
  })
} else {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
  const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!supabaseUrl || !supabasePublishableKey) {
    const missingVariables = [
      !supabaseUrl && 'VITE_SUPABASE_URL',
      !supabasePublishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
    ].filter((variable): variable is string => Boolean(variable))

    root.render(
      <div className="startup-error" role="alert">
        <div className="startup-error__content">
          <h1>Не удалось запустить Friend Battle</h1>
          <p>Не настроено подключение к Supabase. Добавь следующие переменные окружения в настройках проекта Vercel:</p>
          <ul>
            {missingVariables.map((variable) => (
              <li key={variable}><code>{variable}</code></li>
            ))}
          </ul>
          <p>После сохранения переменных запусти новое развёртывание (Redeploy).</p>
        </div>
      </div>,
    )
  } else {
    void import('./App.tsx').then(({ default: App }) => {
      root.render(<StrictMode><App /></StrictMode>)
    }).catch((error: unknown) => {
      console.error('Не удалось загрузить приложение:', error)
      root.render(
        <div className="startup-error" role="alert">
          <div className="startup-error__content">
            <h1>Не удалось загрузить Friend Battle</h1>
            <p>Произошла ошибка при загрузке приложения. Обнови страницу или попробуй позже.</p>
          </div>
        </div>,
      )
    })
  }
}
