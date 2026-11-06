# Friend Battle

Friend Battle — веб-приложение на React, TypeScript и Vite, рассчитанное в том числе на запуск внутри Telegram Mini Apps.

## Локальный запуск

Требуется Node.js 24.x.

```bash
npm install
cp .env.example .env.local
# Заполни значения переменных в .env.local
npm run dev
```

Проверка production-сборки:

```bash
npm run build
npm run preview
```

## Переменные окружения

Приложению нужны две публичные переменные:

| Переменная | Назначение |
| --- | --- |
| `VITE_SUPABASE_URL` | URL проекта Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key проекта Supabase |

Шаблон находится в `.env.example`. В Vite переменные с префиксом `VITE_` встраиваются в клиентскую сборку и доступны пользователям приложения. Здесь допустим только Supabase publishable key (или legacy anon key, если проект его использует). **Никогда не добавляй `service_role` или другие секретные ключи в переменные `VITE_*`.**

Если одна из обязательных переменных не задана, приложение покажет понятную страницу с названием отсутствующей переменной вместо необработанной ошибки `supabaseUrl is required`.

## Развёртывание на Vercel

Проект использует Vite. Рекомендуемые настройки Vercel:

- **Framework Preset:** Vite
- **Root Directory:** `./`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`
- **Node.js Version:** 24.x

Файл `vercel.json` содержит SPA rewrite: прямое открытие URL приложения и обновление страницы должны возвращать `index.html`, чтобы маршрутизацию мог обработать клиент.

### Production и Preview

1. Подключи GitHub-репозиторий `d10131994-boop/friend-battle` к проекту Vercel.
2. Укажи `main` как Production Branch, если именно эта ветка используется для выпуска Production.
3. В **Settings → Environment Variables** добавь обе переменные Supabase.
4. Отметь для них окружения **Production** и **Preview** (и Development, если используешь Vercel CLI).
5. После изменения переменных создай новое развёртывание: переменные применяются к новым сборкам, а не к уже созданным deployment.
6. Проверяй Preview deployment до слияния изменений в Production branch.

Для локальной разработки используй `.env.local`; не коммить его в репозиторий. Файл `.env.example` содержит только имена и демонстрационные значения.

## Полезные команды

- `npm run dev` — локальный сервер разработки.
- `npm run build` — проверка TypeScript и production-сборка.
- `npm run lint` — ESLint.
- `npm run preview` — локальный просмотр production-сборки.


## Игровые рейтинги

В приложении нет и не планируется общего рейтинга всех игроков. Рейтинг может быть реализован отдельно внутри конкретной игры. Например, Reaction Rush предоставляет собственный рейтинг многопользовательских матчей. Личные рекорды одиночного режима хранятся локально на устройстве и не отправляются в общий рейтинг.
