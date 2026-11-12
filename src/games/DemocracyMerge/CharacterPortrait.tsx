type Props = {
  level: number
  className?: string
}

const characterNames = [
  'Дерзкий фермер с вилами и мешком',
  'Уверенный фермер с картой поместья',
  'Фермер-землевладелец с картой участка',
  'Богатый дворянин-банкир с сокровищами',
  'Рыцарь-землевладелец с картой владений',
  'Король-завоеватель с королевским знаменем',
] as const

export default function CharacterPortrait({ level, className = '' }: Props) {
  const validLevel = Number.isInteger(level) && level >= 1 && level <= 6
  const filename = validLevel ? `level-${String(level).padStart(2, '0')}.png` : null
  return (
    <span className={`dm-character-portrait dm-level-${level} ${className}`} aria-label={validLevel ? characterNames[level - 1] : `Уровень ${level}`}>
      {filename ? (
        <img
          src={`/democracy-merge/characters/${filename}`}
          alt={characterNames[level - 1]}
          loading="lazy"
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
          onError={(event) => { event.currentTarget.style.display = 'none'; event.currentTarget.nextElementSibling?.removeAttribute('hidden') }}
        />
      ) : null}
      <span className="dm-character-fallback" hidden={Boolean(filename)}>{level}</span>
    </span>
  )
}
