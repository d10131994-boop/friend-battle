
import { useBrainBattle } from './hooks/useBrainBattle'

type BrainBattleProps = {
  onBack: () => void
}

function BrainBattle({ onBack }: BrainBattleProps) {
  const {
    currentQuestion,
    selectedAnswer,
    currentQuestionIndex,
    timeLeft,
    gameState,
    result,
    startGame,
    selectAnswer,
    nextQuestion,
    resetGame,
  } = useBrainBattle()

  if (gameState === 'idle') {
    return (
      <main className="app">
        <section className="hero">
          <div className="eyebrow">BRAIN BATTLE</div>
          <div className="game-icon">🧠</div>
          <h1>
            ГОТОВ<br />
            <span>ДУМАТЬ?</span>
          </h1>
          <p>10 вопросов. 15 секунд на каждый. Покажи, на что способен!</p>
        </section>

        <section className="game-card">
          <button className="play-button" onClick={startGame}>
            НАЧАТЬ ИГРУ
          </button>
          <button className="leaderboard-button" onClick={onBack}>
            ← Назад в меню
          </button>
        </section>
      </main>
    )
  }

  if (gameState === 'finished' && result) {
    return (
      <main className="app">
        <section className="hero">
          <div className="eyebrow">BRAIN BATTLE · РЕЗУЛЬТАТ</div>
          <div className="game-icon">🏆</div>
          <h1>
            ИГРА<br />
            <span>ЗАВЕРШЕНА</span>
          </h1>
          <p>Твой результат: {result.totalScore} очков</p>
        </section>

        <section className="stats">
          <div className="stat-card">
            <span>✅</span>
            <div>
              <small>ПРАВИЛЬНО</small>
              <strong>{result.correctAnswers}</strong>
            </div>
          </div>
          <div className="stat-card">
            <span>❌</span>
            <div>
              <small>НЕПРАВИЛЬНО</small>
              <strong>{result.incorrectAnswers}</strong>
            </div>
          </div>
          <div className="stat-card">
            <span>⏭️</span>
            <div>
              <small>ПРОПУЩЕНО</small>
              <strong>{result.skippedQuestions}</strong>
            </div>
          </div>
        </section>

        <section className="game-card">
          <button className="play-button" onClick={startGame}>
            ИГРАТЬ ЕЩЁ
          </button>
          <button className="leaderboard-button" onClick={onBack}>
            ← В меню BRAIN BATTLE
          </button>
        </section>
      </main>
    )
  }

  if (!currentQuestion) {
    return (
      <main className="app">
        <section className="hero">
          <p>Подготавливаем вопросы...</p>
        </section>
      </main>
    )
  }


  return (
    <main className="app">
      <header className="topbar">
        <button
  className="leaderboard-button"
  onClick={() => {
    resetGame()
    onBack()
  }}
>
  ← Выйти
</button>
        <div className="player-level">
          {currentQuestionIndex + 1} / 10
        </div>
      </header>

            <div className="brain-progress">
        {Array.from({ length: 10 }, (_, index) => (
          <div
            key={index}
            className={[
              'brain-progress-segment',
              index < currentQuestionIndex ? 'completed' : '',
              index === currentQuestionIndex ? 'current' : '',
            ].filter(Boolean).join(' ')}
          />
        ))}
      </div>

      <section className="hero">
        <div className="eyebrow">
          {currentQuestion.category.toUpperCase()}
        </div>

        <div className="game-icon">🧠</div>

        <h1>
          ВОПРОС<br />
          <span>{currentQuestionIndex + 1}</span>
        </h1>

        <p>{currentQuestion.question}</p>
      </section>

            <div
        className={[
          'brain-timer',
          timeLeft <= 3 ? 'danger' : '',
          timeLeft > 3 && timeLeft <= 7 ? 'warning' : '',
        ].filter(Boolean).join(' ')}
      >
        <span>⏱️</span>
        <span>{timeLeft} сек.</span>
      </div>

      <section className="game-card">
        {currentQuestion.answers.map((answer, index) => {
          const isCorrect =
            gameState === 'answering' &&
            index === currentQuestion.correctAnswer

          const isSelected = selectedAnswer === index
          const answerClass = [
  'brain-answer',
  gameState === 'answering' && isCorrect ? 'correct' : '',
  gameState === 'answering' && isSelected && !isCorrect
    ? 'incorrect'
    : '',
  gameState === 'answering' && !isCorrect && !isSelected
    ? 'dimmed'
    : '',
]
  .filter(Boolean)
  .join(' ')

          return (
            <button
              key={`${currentQuestion.id}-${index}`}
              className={answerClass}
              disabled={gameState !== 'playing'}
              onClick={() => selectAnswer(index)}
              
            >
              {String.fromCharCode(65 + index)}. {answer}
              {isCorrect ? ' ✓' : ''}
            </button>
          )
        })}

        {gameState === 'answering' && (
          <>
            <p>
              {currentQuestion.explanation ??
                'Правильный ответ выделен зелёным.'}
            </p>
            <button className="play-button" onClick={nextQuestion}>
              {currentQuestionIndex === 9
                ? 'ПОКАЗАТЬ РЕЗУЛЬТАТ'
                : 'СЛЕДУЮЩИЙ ВОПРОС →'}
            </button>
          </>
        )}
      </section>
    </main>
  )
}

export default BrainBattle
