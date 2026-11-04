import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Не найден корневой элемент приложения (#root).')
}

const root = createRoot(rootElement)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

if (!supabaseUrl || !supabasePublishableKey) {
  const missingVariables = [
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabasePublishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
  ].filter(Boolean)

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
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
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
