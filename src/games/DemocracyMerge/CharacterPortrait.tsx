import { useState } from 'react'

type Props = {
  level: number
  className?: string
}

/**
 * Solo character artwork is kept separate from multiplayer artwork.
 * Until the approved PNGs are uploaded, show the original level number.
 */
export default function CharacterPortrait({ level, className = '' }: Props) {
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const path = `/democracy-merge/solo/level-${String(level).padStart(2, '0')}.png`

  return (
    <span className={`dm-character-portrait ${className}`}>
      {failedPath !== path && (
        <img
          key={path}
          className="dm-character-art"
          src={path}
          alt=""
          aria-hidden="true"
          loading="eager"
          draggable={false}
          onError={() => setFailedPath(path)}
        />
      )}
      <span className="dm-character-fallback" aria-label={`Уровень ${level}`}>
        {level}
      </span>
    </span>
  )
}
