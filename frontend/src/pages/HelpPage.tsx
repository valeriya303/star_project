import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { GUEST_FEATURES, MEMBER_FEATURES } from "@/components/auth/access";
import FeatureList from "@/components/auth/FeatureList";
import Icon from "@/components/brand/Icon";
import type { IconName } from "@/components/brand/Icon";
import { GLOSSARY } from "@/content/glossary";
import type { GlossaryEntry } from "@/content/glossary";
import "./HelpPage.css";

const FLASH_MS = 2000;

const QUICK_START: { icon: IconName; title: string; text: string }[] = [
  { icon: "map", title: "Відкрийте карту", text: "Перетягуйте небо мишею або пальцем, наближайте колесом миші, жестом або кнопками +/−." },
  { icon: "search", title: "Знайдіть зорю", text: "Введіть назву (наприклад, «Вега»), номер HIP/HD або координати. Карта сама наведеться на результат." },
  { icon: "info", title: "Прочитайте картку", text: "Клацніть на зорю: праворуч з'являться характеристики, видимість і час сходу й заходу." },
  { icon: "horizon", title: "Подивіться небо зараз", text: "Перемкніться на «Небо над Львовом» або вкажіть своє місце, дату й час і натисніть «Показати небо»." },
];

interface Guide {
  id: string;
  title: string;
  steps: string[];
  note?: string;
}

const GUIDES: Guide[] = [
  {
    id: "guide-map",
    title: "Карта зір: керування",
    steps: [
      "Перетягніть карту, щоб переміститися небом. Небо «замкнене» по колу: прокручуючи вбік, ви повертаєтеся до початку.",
      "Колесо миші, жест двома пальцями або кнопки +/− праворуч унизу змінюють масштаб. Кнопка ⟲ повертає початковий вигляд.",
      "Клацніть на зорю, щоб відкрити її картку. Клацніть на лінію сузір'я — відкриється опис сузір'я.",
      "Під картою вмикайте або вимикайте лінії сузір'їв, назви, сітку координат і стрілки власного руху.",
      "У списку «Проєкція» оберіть рівнопроміжну (все небо одразу) або стереографічну (менше спотворень при наближенні).",
    ],
    note: "Колір точки відповідає кольору зорі, а розмір — яскравості. Легенда кольорів розташована під картою.",
  },
  {
    id: "guide-search",
    title: "Пошук зорі",
    steps: [
      "«Назва»: почніть вводити українською чи англійською — з'являться підказки. Шукати можна й за частиною назви.",
      "«HIP / HD»: оберіть каталог і введіть номер, наприклад HIP 32349 — це Сіріус.",
      "«Координати»: введіть α і δ у градусах і радіус пошуку. Результати впорядковано від найближчої до точки зорі.",
      "Кнопка «Швидкі зорі» показує зорі з найбільшим власним рухом.",
    ],
  },
  {
    id: "guide-filters",
    title: "Фільтри",
    steps: [
      "Відкрийте вкладку «Фільтри» на панелі ліворуч.",
      "Задайте діапазон зоряної величини, спектральні класи, відстань, показник кольору або власний рух. Порожнє поле означає «без обмеження».",
      "Натисніть «Застосувати». Під фільтрами видно активні умови та кількість зір на карті й у всьому каталозі.",
      "«Скинути фільтри» повертає початкові налаштування.",
    ],
    note: "Якщо фільтруєте за відстанню, зорі без відомої відстані не показуються — система окремо повідомить, скільки їх.",
  },
  {
    id: "guide-sky",
    title: "Небо над місцем спостереження",
    steps: [
      "Перемкніть вигляд на «Небо над Львовом».",
      "Оберіть місце: «Львів», «Вручну» (введіть широту й довготу) або «Моє місце» (знадобиться ваша згода на геолокацію).",
      "Виберіть дату, час і часовий пояс та натисніть «Показати небо». Кнопка «Зараз» показує поточне небо й оновлює його автоматично.",
      "У картці зорі буде висота, азимут, час сходу, кульмінації й заходу для вибраного місця.",
    ],
    note: "Розрахунок геометричний: погода, засвічення й будинки не враховуються.",
  },
  {
    id: "guide-lists",
    title: "Списки улюблених зір",
    steps: [
      "Увійдіть у систему. У картці зорі натисніть «В улюблені» або оберіть список у «Додати до списку…».",
      "У розділі «Списки» створюйте нові списки, перейменовуйте й видаляйте їх, додавайте зорі через пошук.",
      "«Показати на карті» залишає на карті лише зорі вибраного списку.",
    ],
  },
  {
    id: "guide-journal",
    title: "Журнал спостережень",
    steps: [
      "Відкрийте «Журнал» або натисніть «Додати в журнал» у картці зорі.",
      "Вкажіть дату, зорю, оцініть яскравість і умови за шкалою 1–5 та за бажанням додайте нотатку й місце.",
      "Записи можна редагувати й видаляти. За замовчуванням журнал бачите лише ви.",
    ],
    note: "Щоб інші користувачі бачили ваш журнал, надайте згоду C-04 у «Профіль → Мої згоди». Точні координати при цьому не показуються.",
  },
  {
    id: "guide-photos",
    title: "Знімки сузір'їв і публікація",
    steps: [
      "У «Мої знімки» завантажте файл JPEG або PNG до 10 МБ, не менше 800 × 600 пікселів.",
      "Заповніть назву, сузір'я, дату зйомки, автора (або «Анонімно») і ліцензію та підтвердіть права на знімок.",
      "Знімок зберігається приватно. Натисніть «Подати на публікацію», оберіть авторство й ліцензію та надайте згоду на публікацію.",
      "Після схвалення модератором знімок з'явиться в «Спільноті», а ви отримаєте бали. Якщо його відхилять, ви побачите причину й зможете виправити та подати знову.",
      "Відкликати публікацію можна будь-коли — знімок одразу зникне з галереї.",
    ],
  },
  {
    id: "guide-privacy",
    title: "Згоди та ваші дані",
    steps: [
      "Усі згоди вимкнені, доки ви самі їх не надасте. Кожна стосується лише однієї мети.",
      "Переглянути, надати чи відкликати згоду можна в «Профіль → Мої згоди». Там же — історія ваших рішень.",
      "«Профіль → Мої дані» дозволяє завантажити копію всіх ваших даних або видалити обліковий запис.",
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  { q: "Чому я не бачу зорю, яку знайшов, на карті «Небо над Львовом»?", a: "У цей момент вона під горизонтом. Подивіться в картці зорі, коли вона зійде, і змініть час." },
  { q: "Чому деякі зорі сірі?", a: "Для них у каталозі немає показника кольору B–V, тому колір невідомий." },
  { q: "Чому навпроти відстані написано «Дані відсутні»?", a: "Паралакс цієї зорі не виміряно або він від'ємний через похибку — надійно обчислити відстань неможливо." },
  { q: "Чи бачить хтось мою геолокацію?", a: "Ні. Координати використовуються лише для розрахунку в поточному сеансі, не зберігаються й не потрапляють у журнали системи." },
  { q: "Як побачити слабкі зорі?", a: "У фільтрах збільште верхню межу зоряної величини понад 6,5 — система довантажить слабші зорі для ділянки, яку ви переглядаєте." },
  { q: "Знімок не завантажується. Що робити?", a: "Перевірте формат (JPEG/PNG), розмір (до 10 МБ) і роздільну здатність (від 800 × 600). Біля поля з'явиться пояснення з кодом правила." },
];

const GROUPS = ["Усі", ...Array.from(new Set(GLOSSARY.map((g) => g.group)))];

/** Пункти бічного змісту: id має збігатися з id відповідної <section> */
const TOC: { id: string; label: string }[] = [
  { id: "start", label: "Швидкий старт" },
  { id: "access", label: "Що доступно" },
  { id: "guides", label: "Інструкції" },
  { id: "glossary", label: "Глосарій термінів" },
  { id: "faq", label: "Часті запитання" },
];

export default function HelpPage() {
  const { hash, key } = useLocation();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("Усі");
  const [activeId, setActiveId] = useState<string>(TOC[0].id);
  const [flashId, setFlashId] = useState<string | null>(null);
  // Яку адресу з якорем уже обробили, щоб не скролити повторно при кожній зміні фільтра
  const handledHash = useRef<string | null>(null);

  const terms = useMemo(() => {
    const s = q.trim().toLowerCase();
    return GLOSSARY.filter((g) => (group === "Усі" || g.group === group) &&
      (!s || `${g.term} ${g.short} ${g.long}`.toLowerCase().includes(s)));
  }, [q, group]);

  /* 1. Якщо ціль — термін, який зараз не видно через пошук/фільтр, скидаємо фільтри */
  useEffect(() => {
    const id = hash.slice(1);
    if (!id || handledHash.current === key) return;
    const isGlossaryEntry = GLOSSARY.some((g) => g.id === id);
    if (isGlossaryEntry && !terms.some((t) => t.id === id)) {
      setQ("");
      setGroup("Усі");
    }
  }, [hash, key, terms]);

  /* 2. Скрол до блоку, розгортання закритого <details> і підсвітка */
  useEffect(() => {
    const id = hash.slice(1);
    if (!id || handledHash.current === key) return;

    const el = document.getElementById(id);
    if (!el) {
      // Елемента ще немає (фільтр його ховає): чекаємо наступного рендера
      if (GLOSSARY.some((g) => g.id === id)) return;
      handledHash.current = key;
      return;
    }

    handledHash.current = key;

    const details = el.closest("details");
    if (details) details.open = true;

    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlashId(id);
  }, [hash, key, terms]);


  /* 3. Знімаємо підсвітку через FLASH_MS */
  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flashId]);

  /* Scrollspy: підсвічуємо в змісті розділ, який зараз читає користувач */
  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      // Лінія «читання» трохи нижча за липку шапку (scroll-margin-top: 6rem у CSS)
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const offset = rem * 6 + 24;

      let current = TOC[0].id;
      for (const { id } of TOC) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= offset) current = id;
      }

      // Унизу сторінки підсвічуємо останній пункт, навіть якщо розділ короткий
      const doc = document.documentElement;
      const canScroll = doc.scrollHeight > window.innerHeight + 2;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
      if (canScroll && atBottom) current = TOC[TOC.length - 1].id;

      setActiveId(current);
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    // capture: true — ловимо прокрутку і вікна, і будь-якого контейнера-обгортки
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
    // Перераховуємо, коли фільтр глосарію змінює висоту сторінки
  }, [terms.length]);

  return (
    <div className="help">
      <aside className="help__toc">
        <nav aria-label="Зміст довідки">
          <p className="help__toc-title">Зміст</p>
          {TOC.map((item) => {
            const isActive = item.id === activeId;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={"help__toc-link" + (isActive ? " help__toc-link--active" : "")}
                aria-current={isActive ? "location" : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </aside>

      <div className="help__main">
        <header className="help__hero panel">
          <span className="help__hero-icon"><Icon name="book" size={26} /></span>
          <div>
            <h1 className="help__title">Довідка</h1>
            <p className="help__lead">
              Як користуватися картою зір, що означають астрономічні терміни й скорочення та як працюють ваші дані.
              Терміни з позначкою <span className="help__mark">?</span> у застосунку пояснюються при наведенні — тут зібрано всі пояснення разом.
            </p>
          </div>
        </header>

        <section id="start" className="help__section">
          <h2 className="help__h2">Швидкий старт</h2>
          <ol className="help__steps">
            {QUICK_START.map((s, i) => (
              <li key={s.title} className="panel help__step">
                <span className="help__step-num">{i + 1}</span>
                <span className="help__step-icon"><Icon name={s.icon} size={20} /></span>
                <strong>{s.title}</strong>
                <span className="muted small">{s.text}</span>
              </li>
            ))}
          </ol>
          <Link to="/map" className="btn btn--primary btn--sm help__cta">Відкрити карту</Link>
        </section>

        <section id="access" className="help__section">
          <h2 className="help__h2">Що доступно без входу і після входу</h2>
          <div className="help__two">
            <div className="panel help__card">
              <h3 className="help__h3">Без входу</h3>
              <FeatureList items={GUEST_FEATURES} />
            </div>
            <div className="panel help__card help__card--accent">
              <h3 className="help__h3"><Icon name="lock" size={15} /> Після входу</h3>
              <FeatureList items={MEMBER_FEATURES} tone="accent" />
            </div>
          </div>
          <p className="muted small">
            Ролі: <strong>Гість</strong> — без облікового запису; <strong>Спостерігач</strong> — зареєстрований користувач;
            <strong> Модератор</strong> — перевіряє знімки; <strong>DG Admin</strong> — адміністратор даних (імпорт каталогів, аудит, ролі).
          </p>
        </section>

        <section id="guides" className="help__section">
          <h2 className="help__h2">Інструкції</h2>
          <div className="help__guides">
            {GUIDES.map((g) => (
              <details
                key={g.id}
                id={g.id}
                className={"panel help__guide" + (flashId === g.id ? " help__guide--flash" : "")}
              >
                <summary>{g.title}</summary>
                <ol className="help__list">
                  {g.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                {g.note && <p className="help__note">{g.note}</p>}
              </details>
            ))}
          </div>
        </section>

        <section id="glossary" className="help__section">
          <h2 className="help__h2">Глосарій термінів і скорочень</h2>
          <div className="help__filters">
            <input className="field__input help__search" placeholder="Знайти термін, наприклад «паралакс»" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Пошук у глосарії" />
            <div className="help__chips" role="group" aria-label="Тема">
              {GROUPS.map((g) => (
                <button key={g} type="button" className={"help__chip" + (g === group ? " help__chip--on" : "")}
                  aria-pressed={g === group} onClick={() => setGroup(g)}>{g}</button>
              ))}
            </div>
          </div>
          {terms.length === 0 && <p className="muted">Нічого не знайдено.</p>}
          <dl className="help__terms">
            {terms.map((g: GlossaryEntry) => (
              <div
                key={g.id}
                id={g.id}
                className={"panel help__term" + (flashId === g.id ? " help__term--flash" : "")}
              >
                <dt>
                  <span>{g.term}</span>
                  <span className="help__group">{g.group}</span>
                </dt>
                <dd>
                  <p>{g.short}</p>
                  <p className="muted">{g.long}</p>
                  {g.example && <p className="help__example"><strong>Приклад.</strong> {g.example}</p>}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="faq" className="help__section">
          <h2 className="help__h2">Часті запитання</h2>
          <div className="help__guides">
            {FAQ.map((f) => (
              <details key={f.q} className="panel help__guide">
                <summary>{f.q}</summary>
                <p className="help__answer">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="muted small">
            Про джерела даних — у розділі <Link to="/about-data">«Про дані»</Link>, про обробку персональних даних —
            у <Link to="/privacy">«Політиці конфіденційності»</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}
