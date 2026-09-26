export const textbookCatalog = {
  3: [
    { id: 'lapitskaya-3-2023', label: 'Английский язык. 3 класс — Л. М. Лапицкая и др. (2023)', parts: 2, storage: true },
    { id: 'custom-3', label: 'Другой учебник', custom: true },
  ],
  4: [
    { id: 'lapitskaya-4-2024', label: 'Английский язык. 4 класс — Л. М. Лапицкая и др. (2024)', parts: 2, storage: true },
    { id: 'custom-4', label: 'Другой учебник', custom: true },
  ],
  5: [
    { id: 'demchenko-5-2025', label: 'Английский язык. 5 класс — Н. В. Демченко и др. (2025)', parts: 2, storage: true },
    { id: 'lapitskaya-5-2020', label: 'Английский язык. 5 класс — Л. М. Лапицкая и др. (2020)', parts: 2, storage: true },
    { id: 'custom-5', label: 'Другой учебник', custom: true },
  ],
  6: [
    { id: 'demchenko-6-2026', label: 'Английский язык. 6 класс — Н. В. Демченко и др. (2026)', parts: 2, storage: true },
    { id: 'yuhnel-6-2021', label: 'Английский язык. 6 класс — Н. В. Юхнель и др. (2021)', parts: 1, storage: true },
    { id: 'custom-6', label: 'Другой учебник', custom: true },
  ],
  7: [
    { id: 'yuhnel-7-2023', label: 'Английский язык. 7 класс — Н. В. Юхнель и др. (2023)', parts: 1, storage: true },
    { id: 'demchenko-7-2019', label: 'Английский язык. 7 класс — Н. В. Демченко и др. (2019)', parts: 2, storage: true },
    { id: 'custom-7', label: 'Другой учебник', custom: true },
  ],
  8: [
    { id: 'lapitskaya-8-2021', label: 'Английский язык. 8 класс — Л. М. Лапицкая и др. (2021)', parts: 1, storage: true },
    { id: 'demchenko-8-2020', label: 'Английский язык. 8 класс — Н. В. Демченко и др. (2020)', parts: 2, storage: true },
    { id: 'custom-8', label: 'Другой учебник', custom: true },
  ],
  9: [
    { id: 'lapitskaya-9-2026', label: 'Английский язык. 9 класс — Л. М. Лапицкая и др. (2026)', parts: 1, storage: true },
    { id: 'demchenko-9-2022', label: 'Английский язык. 9 класс — Н. В. Демченко и др. (2022)', parts: 2, storage: true },
    { id: 'custom-9', label: 'Другой учебник', custom: true },
  ],
  10: [
    { id: 'demchenko-10-2021', label: 'Английский язык. 10 класс — Н. В. Демченко и др. (2021)', parts: 2, storage: true },
    { id: 'yuhnel-10-2019', label: 'Английский язык. 10 класс — Н. В. Юхнель и др. (2019)', parts: 1, storage: true },
    { id: 'custom-10', label: 'Другой учебник', custom: true },
  ],
  11: [
    { id: 'demchenko-11-2022', label: 'Английский язык. 11 класс — Н. В. Демченко и др. (2022)', parts: 2, storage: true },
    { id: 'yuhnel-11-2021', label: 'Английский язык. 11 класс — Н. В. Юхнель и др. (2021)', parts: 1, storage: true },
    { id: 'custom-11', label: 'Другой учебник', custom: true },
  ],
};

// Firebase Storage files currently live in the bucket root. The resolver first tries
// these exact names and then a token-based fallback, so a minor naming variation
// does not break the textbook lookup.
export const storageTextbookFiles = {
  'lapitskaya-3-2023': {
    '1': { exact: ['Angliskaya_mova_3kl_ch1_rus_Lapickaya_2023.pdf'], tokens: ['3kl', 'lapickaya', 'ch1', '2023'] },
    '2': { exact: ['angliski_yazik_3kl_Lapickaya_rus_ch2_2023.pdf'], tokens: ['3kl', 'lapickaya', 'ch2', '2023'] },
  },
  'lapitskaya-4-2024': {
    '1': { exact: ['angliski_yazik_4kl_Lapickaya_rus_ch1_2024.pdf'], tokens: ['4kl', 'lapickaya', 'ch1', '2024'] },
    '2': { exact: ['angliskaya_mova_4kl_Lapickaya_rus_ch2_2024.pdf'], tokens: ['4kl', 'lapickaya', 'ch2', '2024'] },
  },
  'demchenko-5-2025': {
    '1': { exact: ['angliski_yazik_Demchenko_5kl_ch1_2025.pdf'], tokens: ['demchenko', '5kl', 'ch1', '2025'] },
    '2': { exact: ['angliski_yazik_Demchenko_5kl_ch2_2025.pdf'], tokens: ['demchenko', '5kl', 'ch2', '2025'] },
  },
  'lapitskaya-5-2020': {
    '1': { exact: ['angliski_yazik_5kl_ch1_Lapickaya_rus_2020.pdf'], tokens: ['5kl', 'lapickaya', 'ch1', '2020'] },
    '2': { exact: ['angliski_yazik_5kl_ch2_Lapickaya_rus_2020.pdf'], tokens: ['5kl', 'lapickaya', 'ch2', '2020'] },
  },
  'demchenko-6-2026': {
    '1': { exact: ['angliski_yazik_Demchenko_6kl_ch1_2026.pdf'], tokens: ['demchenko', '6kl', 'ch1', '2026'] },
    '2': { exact: ['angliski_yazik_Demchenko_6kl_ch2_2026.pdf'], tokens: ['demchenko', '6kl', 'ch2', '2026'] },
  },
  'yuhnel-6-2021': {
    '1': { exact: ['angliski_yazik_6k_Yuhnel_rus_2021.pdf', 'angliski_yazik_6kl_Yuhnel_rus_2021.pdf'], tokens: ['yuhnel', '6k', '2021'] },
  },
  'yuhnel-7-2023': {
    '1': { exact: ['angliski_yazik_7kl_Yuhnel_rus_2023.pdf'], tokens: ['yuhnel', '7kl', '2023'] },
  },
  'demchenko-7-2019': {
    '1': { exact: ['angliski_yazik_7kl_Demchenko_bel_rus_ch1_2019.pdf'], tokens: ['demchenko', '7kl', 'ch1', '2019'] },
    '2': { exact: ['angliski_yazik_7kl_Demchenko_bel_rus_ch2_2019.pdf'], tokens: ['demchenko', '7kl', 'ch2', '2019'] },
  },
  'lapitskaya-8-2021': {
    '1': { exact: ['angliski_yazik_8kl_Lapickaya_rus_2021.pdf'], tokens: ['8kl', 'lapickaya', '2021'] },
  },
  'demchenko-8-2020': {
    '1': { exact: ['angliski_Demchenko_8kl_bel_rus_ch1_2020.pdf'], tokens: ['demchenko', '8kl', 'ch1', '2020'] },
    '2': { exact: ['angliski_Demchenko_8kl_bel_rus_ch2_2020.pdf'], tokens: ['demchenko', '8kl', 'ch2', '2020'] },
  },
  'lapitskaya-9-2026': {
    '1': { exact: ['angliski_yazik_9kl_Lapickaya_rus_2026.pdf'], tokens: ['9kl', 'lapickaya', '2026'] },
  },
  'demchenko-9-2022': {
    '1': { exact: ['angliski_Demchenko_9kl_ch1_bel_rus_2022.pdf'], tokens: ['demchenko', '9kl', 'ch1', '2022'] },
    '2': { exact: ['angliski_Demchenko_9kl_ch2_bel_rus_2022.pdf'], tokens: ['demchenko', '9kl', 'ch2', '2022'] },
  },
  'demchenko-10-2021': {
    '1': { exact: ['angliski_Demchenko_10kl_bel_rus_ch1_2021.pdf'], tokens: ['demchenko', '10kl', 'ch1', '2021'] },
    '2': { exact: ['angliski_Demchenko_10kl_bel_rus_ch2_2021.pdf'], tokens: ['demchenko', '10kl', 'ch2', '2021'] },
  },
  'yuhnel-10-2019': {
    '1': { exact: ['angliski_yazik_10kl_Yuhnel_rus_2019.pdf'], tokens: ['yuhnel', '10kl', '2019'] },
  },
  'demchenko-11-2022': {
    '1': { exact: ['angliski_Demchenko_11kl_bel_rus_ch1_2022.pdf'], tokens: ['demchenko', '11kl', 'ch1', '2022'] },
    '2': { exact: ['angliski_Demchenko_11kl_bel_rus_ch2_2022.pdf'], tokens: ['demchenko', '11kl', 'ch2', '2022'] },
  },
  'yuhnel-11-2021': {
    '1': { exact: ['angliski_yazik_11kl_Yuhnel_rus_2021.pdf'], tokens: ['yuhnel', '11kl', '2021'] },
  },
};

export const lessonTypes = [
  'Изучение нового материала',
  'Закрепление',
  'Комбинированный',
  'Контроль',
  'Коррекция',
  'Обобщение и систематизация',
];

export const defaultStages = {
  'Изучение нового материала': [
    'Организационный этап',
    'Этап проверки выполнения домашнего задания',
    'Этап мотивации и целеполагания',
    'Этап актуализации опорных знаний и способов действий',
    'Этап изучения новых знаний и способов действий',
    'Двигательная пауза / физкультминутка',
    'Этап первичной проверки понимания изученного',
    'Этап первичного закрепления',
    'Этап информации о домашнем задании',
    'Этап подведения итогов',
    'Этап рефлексии',
  ],
  'Закрепление': [
    'Организационный этап',
    'Этап проверки выполнения домашнего задания',
    'Этап закрепления новых знаний и способов действий',
    'Двигательная пауза / физкультминутка',
    'Этап контроля и самоконтроля знаний и способов действий',
    'Этап коррекции знаний и способов действий',
    'Этап информации о домашнем задании',
    'Этап подведения итогов',
    'Этап рефлексии',
  ],
  'Комбинированный': [
    'Организационный этап',
    'Этап проверки выполнения домашнего задания',
    'Этап мотивации и целеполагания',
    'Этап актуализации знаний',
    'Этап изучения / совершенствования знаний и способов действий',
    'Двигательная пауза / физкультминутка',
    'Этап применения знаний в речевой деятельности',
    'Этап контроля и самоконтроля',
    'Этап коррекции',
    'Этап информации о домашнем задании',
    'Этап подведения итогов',
    'Этап рефлексии',
  ],
  'Контроль': [
    'Организационный этап',
    'Этап мотивации и постановки цели контроля',
    'Этап контроля знаний и способов действий',
    'Двигательная пауза / физкультминутка',
    'Этап самоконтроля',
    'Этап информации о домашнем задании',
    'Этап подведения итогов',
    'Этап рефлексии',
  ],
  'Коррекция': [
    'Организационный этап',
    'Этап анализа типичных затруднений',
    'Этап коррекции знаний и способов действий',
    'Двигательная пауза / физкультминутка',
    'Этап повторного применения знаний',
    'Этап контроля и самоконтроля',
    'Этап информации о домашнем задании',
    'Этап подведения итогов',
    'Этап рефлексии',
  ],
  'Обобщение и систематизация': [
    'Организационный этап',
    'Этап мотивации и целеполагания',
    'Этап актуализации и систематизации знаний',
    'Этап обобщения способов действий',
    'Двигательная пауза / физкультминутка',
    'Этап применения знаний в новой ситуации',
    'Этап контроля и самоконтроля',
    'Этап информации о домашнем задании',
    'Этап подведения итогов',
    'Этап рефлексии',
  ],
};

export const competencies = [
  'Гражданственность',
  'Коммуникация',
  'Кооперация',
  'Мышление',
  'Устойчивое личностное развитие',
  'Эмоциональная регуляция',
];

export const literacies = [
  { name: 'Информационная', priority: true },
  { name: 'Читательская', priority: true },
  { name: 'Художественно-эстетическая', priority: true },
  { name: 'Математическая', priority: false },
  { name: 'Естественнонаучная', priority: false },
  { name: 'Финансовая', priority: false },
];

export const extras = [
  'Парная работа',
  'Групповая работа',
  'Игровая деятельность',
  'ИКТ',
  'Критическое мышление',
  'Дифференциация',
  'Инклюзия',
  'Краеведение',
  'Патриотическое воспитание',
  'Межпредметные связи',
  'Двигательная активность',
];

export const speechActivities = [
  'Диалогическая речь',
  'Монологическая речь',
  'Аудирование',
  'Чтение',
  'Письменная речь',
];
