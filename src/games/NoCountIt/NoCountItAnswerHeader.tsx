import type { ReactNode } from 'react'

type Props = {
  question: ReactNode
  remaining: number
  children?: ReactNode
}

export default function NoCountItAnswerHeader({ question, remaining, children }: Props) {
  return (
    <div className="no-count-it-answer-top">
      <h2 className="no-count-it-answer-question">{question}</h2>
      <div className="no-count-it-answer-timer" aria-live="polite">{remaining} сек.</div>
      {children}
    </div>
  )
}
