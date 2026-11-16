import { NO_COUNT_IT_TEXTS } from './texts'

type Props = { roundNumber: number; error: number | null }

export default function NoCountItRevealHeader({ roundNumber, error }: Props) {
  return (
    <header className="no-count-it-reveal-heading">
      <div className="no-count-it-reveal-round">{NO_COUNT_IT_TEXTS.match.round} {roundNumber}</div>
      <h2>{error ?? '—'} Баллов!</h2>
    </header>
  )
}
