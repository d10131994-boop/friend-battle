export type ServerQuestion = {
  id: number;
  category: "logic" | "math" | "attention" | "general";
  question: string;
  answers: string[];
  correctAnswer: number;
  explanation: string;
};

const questionBank: ServerQuestion[] = [
  { id: 1, category: "logic", question: "Какое число должно быть следующим: 2, 4, 8, 16, ...?", answers: ["24", "30", "32", "36"], correctAnswer: 2, explanation: "Каждое число умножается на 2." },
  { id: 2, category: "logic", question: "У всех кошек четыре лапы. У Мурки четыре лапы. Значит ли это, что Мурка — кошка?", answers: ["Да", "Нет", "Всегда", "Невозможно определить"], correctAnswer: 3, explanation: "Четыре лапы есть не только у кошек." },
  { id: 3, category: "logic", question: "Что становится больше, если его перевернуть вверх ногами?", answers: ["Число 6", "Число 8", "Число 9", "Число 3"], correctAnswer: 0, explanation: "Перевёрнутая шестёрка становится девяткой." },
  { id: 4, category: "math", question: "Сколько будет 15 × 4?", answers: ["45", "50", "60", "65"], correctAnswer: 2, explanation: "15 × 4 = 60." },
  { id: 5, category: "math", question: "У тебя было 100 монет. Ты потратил 35. Сколько осталось?", answers: ["55", "65", "75", "85"], correctAnswer: 1, explanation: "100 − 35 = 65." },
  { id: 6, category: "math", question: "Какое число составляет половину от 90?", answers: ["35", "40", "45", "50"], correctAnswer: 2, explanation: "90 ÷ 2 = 45." },
  { id: 7, category: "attention", question: "Сколько букв «А» в слове «КАРАНДАШ»?", answers: ["1", "2", "3", "4"], correctAnswer: 1, explanation: "В слове КАРАНДАШ две буквы А." },
  { id: 8, category: "attention", question: "Какого цвета обычно бывает спелый лимон?", answers: ["Красный", "Синий", "Жёлтый", "Зелёный"], correctAnswer: 2, explanation: "Спелые лимоны обычно жёлтые." },
  { id: 9, category: "general", question: "Какая планета известна как Красная планета?", answers: ["Венера", "Марс", "Юпитер", "Сатурн"], correctAnswer: 1, explanation: "Марс имеет характерный красноватый оттенок." },
  { id: 10, category: "general", question: "Сколько континентов традиционно выделяют в школьной географии?", answers: ["5", "6", "7", "8"], correctAnswer: 2, explanation: "В распространённой модели выделяют семь континентов." },
  { id: 11, category: "logic", question: "У Пети два брата и одна сестра. Сколько сестёр у каждого брата?", answers: ["1", "2", "3", "4"], correctAnswer: 0, explanation: "У всех братьев одна общая сестра." },
  { id: 12, category: "logic", question: "Что тяжелее: килограмм железа или килограмм пуха?", answers: ["Железо", "Пух", "Одинаково", "Зависит от объёма"], correctAnswer: 2, explanation: "Оба весят ровно один килограмм." },
  { id: 13, category: "logic", question: "В комнате горели 5 свечей. Две потушили. Сколько свечей останется утром?", answers: ["2", "3", "5", "0"], correctAnswer: 0, explanation: "Потушенные свечи не сгорят полностью." },
  { id: 14, category: "math", question: "Сколько будет 12 × 7?", answers: ["72", "84", "92", "96"], correctAnswer: 1, explanation: "12 × 7 = 84." },
  { id: 15, category: "math", question: "В коробке 24 конфеты. Четверть уже съели. Сколько осталось?", answers: ["6", "12", "18", "20"], correctAnswer: 2, explanation: "Четверть от 24 — это 6, значит осталось 18." },
  { id: 16, category: "math", question: "Какое число получится, если 3 десятка увеличить на 8?", answers: ["28", "30", "38", "48"], correctAnswer: 2, explanation: "Три десятка — 30; 30 + 8 = 38." },
  { id: 17, category: "attention", question: "Какое слово написано наоборот: «АКШОК»?", answers: ["КОШКА", "ШКОЛА", "КАШКА", "ОКНО"], correctAnswer: 0, explanation: "Если прочитать АКШОК справа налево, получится КОШКА." },
  { id: 18, category: "attention", question: "Сколько дней в двух полных неделях?", answers: ["12", "13", "14", "15"], correctAnswer: 2, explanation: "В неделе семь дней, две недели — четырнадцать." },
  { id: 19, category: "general", question: "Какой океан самый большой на Земле?", answers: ["Атлантический", "Индийский", "Северный Ледовитый", "Тихий"], correctAnswer: 3, explanation: "Тихий океан занимает наибольшую площадь." },
  { id: 20, category: "general", question: "Как называется столица Италии?", answers: ["Милан", "Рим", "Венеция", "Неаполь"], correctAnswer: 1, explanation: "Столица Италии — Рим." },
];

export function selectQuestions(excludedIds: number[] = []): ServerQuestion[] {
  const excluded = new Set(excludedIds);
  let candidates = questionBank.filter((question) => !excluded.has(question.id));
  if (candidates.length < 10) candidates = [...questionBank];
  for (let index = candidates.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }
  return candidates.slice(0, 10);
}
