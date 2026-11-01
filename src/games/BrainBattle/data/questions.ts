import type { BrainBattleQuestion } from '../types'

export const brainBattleQuestions: BrainBattleQuestion[] = [
  // ЛОГИКА
  {
    id: 1,
    category: 'logic',
    question: 'Какое число должно быть следующим: 2, 4, 8, 16, ...?',
    answers: ['24', '30', '32', '36'],
    correctAnswer: 2,
    explanation: 'Каждое число умножается на 2.',
  },
  {
    id: 2,
    category: 'logic',
    question: 'У всех кошек четыре лапы. У Мурки четыре лапы. Значит ли это, что Мурка — кошка?',
    answers: ['Да', 'Нет', 'Всегда', 'Невозможно определить'],
    correctAnswer: 3,
    explanation: 'Четыре лапы есть не только у кошек.',
  },
  {
    id: 3,
    category: 'logic',
    question: 'Что становится больше, если его перевернуть вверх ногами?',
    answers: ['Число 6', 'Число 8', 'Число 9', 'Число 3'],
    correctAnswer: 0,
    explanation: 'Перевёрнутая шестёрка становится девяткой.',
  },

  // МАТЕМАТИКА
  {
    id: 4,
    category: 'math',
    question: 'Сколько будет 15 × 4?',
    answers: ['45', '50', '60', '65'],
    correctAnswer: 2,
    explanation: '15 × 4 = 60.',
  },
  {
    id: 5,
    category: 'math',
    question: 'У тебя было 100 монет. Ты потратил 35. Сколько осталось?',
    answers: ['55', '65', '75', '85'],
    correctAnswer: 1,
    explanation: '100 − 35 = 65.',
  },
  {
    id: 6,
    category: 'math',
    question: 'Какое число составляет половину от 90?',
    answers: ['35', '40', '45', '50'],
    correctAnswer: 2,
    explanation: '90 ÷ 2 = 45.',
  },

  // ВНИМАТЕЛЬНОСТЬ
  {
    id: 7,
    category: 'attention',
    question: 'Сколько букв «А» в слове «КАРАНДАШ»?',
    answers: ['1', '2', '3', '4'],
    correctAnswer: 1,
    explanation: 'В слове КАРАНДАШ две буквы А.',
  },
  {
    id: 8,
    category: 'attention',
    question: 'Какого цвета обычно бывает спелый лимон?',
    answers: ['Красный', 'Синий', 'Жёлтый', 'Зелёный'],
    correctAnswer: 2,
    explanation: 'Спелые лимоны обычно жёлтые.',
  },

  // ОБЩИЕ ЗНАНИЯ
  {
    id: 9,
    category: 'general',
    question: 'Какая планета известна как Красная планета?',
    answers: ['Венера', 'Марс', 'Юпитер', 'Сатурн'],
    correctAnswer: 1,
    explanation: 'Марс имеет характерный красноватый оттенок.',
  },
  {
    id: 10,
    category: 'general',
    question: 'Сколько континентов традиционно выделяют в школьной географии?',
    answers: ['5', '6', '7', '8'],
    correctAnswer: 2,
    explanation: 'В распространённой модели выделяют семь континентов.',
  },
]