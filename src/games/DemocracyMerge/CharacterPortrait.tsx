type Props = {
  level: number
  className?: string
}

/** The cooperative V1 character set consists of numbered level 1–6 tokens.
 * Reuse the same six identities in solo rather than solo-only level 7–10 art.
 */
export default function CharacterPortrait({ level, className = '' }: Props) {
  return (
    <span className={`dm-character-portrait dm-coop-character dm-level-${level} ${className}`} aria-label={`Уровень ${level}`}>
      <span className="dm-character-fallback">{level}</span>
    </span>
  )
}
