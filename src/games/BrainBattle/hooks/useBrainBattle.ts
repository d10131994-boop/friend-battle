
import { useCallback, useEffect, useState } from 'react'

import type {
  BrainBattleQuestion,
  BrainBattleGameState,
  BrainBattleResult,
} from '../types'

import { selectQuestions } from '../logic/questionSelector'
import { calculateGameResult } from '../logic/gameEngine'

const QUESTIONS_PER_GAME = 10
const QUESTION_TIME = 15

export function useBrainBattle() {
  const [questions, setQuestions] = useState<BrainBattleQuestion[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<(number | null)[]>([])
  const selectedAnswer = answers[currentQuestionIndex] ?? null
  const [remainingTimes, setRemainingTimes] = useState<number[]>([])
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME)
  const [gameState, setGameState] = useState<BrainBattleGameState>('idle')
  const [result, setResult] = useState<BrainBattleResult | null>(null)

  const currentQuestion = questions[currentQuestionIndex] ?? null

  const startGame = useCallback(() => {
    const selectedQuestions = selectQuestions(QUESTIONS_PER_GAME)

    setQuestions(selectedQuestions)
    setCurrentQuestionIndex(0)
    setAnswers(Array(selectedQuestions.length).fill(null))
    setRemainingTimes(Array(selectedQuestions.length).fill(0))
    setTimeLeft(QUESTION_TIME)
    setResult(null)
    setGameState(selectedQuestions.length > 0 ? 'playing' : 'finished')
  }, [])

  const selectAnswer = useCallback((answerIndex: number) => {
    if (gameState !== 'playing' || !currentQuestion) return

    if (
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex >= currentQuestion.answers.length
    ) {
      return
    }

    setAnswers((previous) => {
      const updated = [...previous]
      updated[currentQuestionIndex] = answerIndex
      return updated
    })

    setRemainingTimes((previous) => {
      const updated = [...previous]
      updated[currentQuestionIndex] = timeLeft
      return updated
    })

    setGameState('answering')
  }, [gameState, currentQuestion, currentQuestionIndex, timeLeft])

  const nextQuestion = useCallback(() => {
    if (gameState !== 'answering') return

    const nextIndex = currentQuestionIndex + 1

    if (nextIndex >= questions.length) {
      // The state updates from selectAnswer have been committed
      // before the UI can call nextQuestion.
      const finalResult = calculateGameResult(
        questions,
        answers,
        remainingTimes,
      )

      setResult(finalResult)
      setGameState('finished')
      return
    }

    setCurrentQuestionIndex(nextIndex)
    setTimeLeft(QUESTION_TIME)
    setGameState('playing')
  }, [
    gameState,
    currentQuestionIndex,
    questions,
    answers,
    remainingTimes,
  ])

  const resetGame = useCallback(() => {
    setQuestions([])
    setCurrentQuestionIndex(0)
    setAnswers([])
    setRemainingTimes([])
    setTimeLeft(QUESTION_TIME)
    setResult(null)
    setGameState('idle')
  }, [])

  useEffect(() => {
    if (gameState !== 'playing') return

    const timer = window.setInterval(() => {
      if (timeLeft <= 1) {
        setRemainingTimes((previous) => {
          const updated = [...previous]
          updated[currentQuestionIndex] = 0
          return updated
        })
        setTimeLeft(0)
        setGameState('answering')
        return
      }
      setTimeLeft(timeLeft - 1)
    }, 1000)

    return () => window.clearInterval(timer)
  }, [gameState, currentQuestionIndex, timeLeft])

  return {
    questions,
    currentQuestion,
    selectedAnswer,
    currentQuestionIndex,
    answers,
    timeLeft,
    gameState,
    result,
    startGame,
    selectAnswer,
    nextQuestion,
    resetGame,
  }
}
