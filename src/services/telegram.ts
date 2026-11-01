
export type TelegramUser = {
  id?: number
  first_name?: string
  username?: string
  photo_url?: string
}

type TelegramWebApp = {
  ready: () => void
  expand: () => void
  initData?: string
  initDataUnsafe?: {
    start_param?: string
    user?: TelegramUser
  }
}

type TelegramWindow = Window & {
  Telegram?: {
    WebApp: TelegramWebApp
  }
}

export const tg = (window as TelegramWindow).Telegram?.WebApp

if (tg) {
  tg.ready()
  tg.expand()
}

export const telegramUser = tg?.initDataUnsafe?.user

export const telegramInitData = tg?.initData

export const telegramStartParam = tg?.initDataUnsafe?.start_param

