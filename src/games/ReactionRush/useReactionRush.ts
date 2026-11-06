
import { useEffect, useRef, useState } from 'react'

export function useReactionRush() {
  const [score, setScore] = useState(0)
  const scoreRef = useRef(0)
  const soloTimerRef = useRef<number | null>(null)

  const [rounds, setRounds] = useState(() => {
    const savedRounds = localStorage.getItem('friendBattleRounds')
    return savedRounds ? Number(savedRounds) : 0
  })

  const [best, setBest] = useState(() => {
    const savedBest = localStorage.getItem('friendBattleBest')
    return savedBest ? Number(savedBest) : 0
  })

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(10)

  useEffect(() => () => {
    if (soloTimerRef.current !== null) window.clearInterval(soloTimerRef.current)
  }, [])

  useEffect(() => {
    localStorage.setItem('friendBattleBest', String(best))
  }, [best])

  useEffect(() => {
    localStorage.setItem('friendBattleRounds', String(rounds))
  }, [rounds])

  function startSoloGame() {
    setScore(0)
    scoreRef.current = 0
    setTime(10)
    setPlaying(true)

    if (soloTimerRef.current !== null) window.clearInterval(soloTimerRef.current)
    let remaining = 10

    soloTimerRef.current = window.setInterval(() => {
      remaining -= 1
      setTime(remaining)

      if (remaining <= 0) {
        if (soloTimerRef.current !== null) window.clearInterval(soloTimerRef.current)
        soloTimerRef.current = null
        setPlaying(false)
        setRounds((previous) => previous + 1)
      }
    }, 1000)
  }

  function tap() {
    if (!playing) return

    setScore((previous) => {
      const next = previous + 1
      scoreRef.current = next
      setBest((oldBest) => Math.max(oldBest, next))
      return next
    })
  }

  return {
    score,
    setScore,
    scoreRef,
    rounds,
    setRounds,
    best,
    setBest,
    playing,
    setPlaying,
    time,
    setTime,
    startSoloGame,
    tap,
  }
}
