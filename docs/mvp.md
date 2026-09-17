# MVP: минимальный игровой цикл с заглушкой SIM

## Цель

Замкнуть игровой цикл:
`!join → заказ → !put / !bin → !serve → вердикт + XP → следующий заказ`. Вместо
SIM — **мгновенная заглушка**: запрос пришёл → эффект применён → событие сразу.
Реальная SIM (`miniplex`, физика, движение) подключается позже **без правок** в
RULE CORE и чате.

## Почему заглушка не выбросится

`StubSim` реализует **тот же `ISimPort` / `ISimEvents`**, что и потом реальный
`miniplex`-мир (`docs/sim.md`). RULE CORE и чат видят только шов, не реализацию
— физика с движениями подключается одним файлом, состояние чата и учётки не
меняется.

## Интерфейсы (шов, объявляет RULE CORE в `src/lib/core/game/`)

1. **`ITraySnapshot`** (`core/types/tray.ts`) —
   `{ username, layers: string[], frozenAt }`. То, что оценивает
   `OrderValidator`. Только id ингредиентов.
2. **`TaskIntent` / `TaskAck`** (`core/game/sim-dto.ts`) — заявки из чата:

   ```ts
   type TaskIntent =
     | { kind: "put"; ingredientId: string }
     | { kind: "serve" }
     | { kind: "bin" };

   type TaskRefusal =
     | "no_character" // зритель не в игре
     | "busy" // персонаж уже что-то делает (реальная SIM)
     | "unknown_ingredient" // нет такого ингредиента
     | "tray_empty"; // !serve с пустым подносом
   // "busy" — часть контракта асинхронной модели. Заглушка его не возвращает
   // (действие мгновенно), реальная SIM вернёт, когда персонаж занят.

   type TaskAck = { ok: true } | { ok: false; reason: TaskRefusal };
   ```

3. **`SimOutEvent`** (`sim-dto.ts`) —
   `ACTION_STARTED | ACTION_COMPLETED | CHARACTER_REMOVED`. В `serve` внутри
   события приезжает замороженный `ITraySnapshot` (самодостаточно, обработчик не
   лезет в SIM обратно).
4. **`ISimPort` / `ISimEvents`** (`core/game/sim-port.ts`) — методы и колбэки из
   `docs/sim.md` §6, один в один:

   ```ts
   interface ISimPort {
     startOrder(username: string, order: IOrder): void;
     enqueueTask(username: string, intent: TaskIntent): TaskAck;
     cancelOrder(username: string, reason: "timeout" | "leave"): void;
     despawn(username: string): void;
     getTraySnapshot(username: string): ITraySnapshot | undefined;
     getSnapshot(): SimSnapshot;
   }

   interface ISimEvents {
     onActionStarted(e: ActionStartedEvent): void;
     onActionCompleted(e: ActionCompletedEvent): void;
     onCharacterRemoved(e: { username: string }): void;
   }
   ```

## Классы (5 групп, в порядке реализации)

1. **`StubSim`** (`sim/stub.ts`) —
   `Map<username, { orderId, layers, startedAt }>`. `enqueueTask` инстантен:
   проверил (`no_character`, `unknown_ingredient`, `tray_empty`) → применил
   (`put` → push слой, `bin` → очистить, `serve` → заморозить снимок) → сразу
   `onActionCompleted`. Никакого тика, движения, miniplex.
2. **`SessionManager`** (`core/game/session-manager.ts`) — учётка:
   `Map<username, PlayerSession>`, таймер (истёк → `onTimeout`, идемпотентен),
   XP/уровень. `onActionCompleted` для `serve` = `OrderValidator` → `scoring` →
   `xpDelta` → следующий заказ (переход по заказу инициирует учётка, не SIM).
3. **`OrderValidator` + `scoring.ts`** (`core/services/`) —
   `assessOrder(snapshot, order) → AssessmentResult`. Чистая функция,
   юнит-тестируемая без мира. `scoring` — таблица весов `COST_*`, формула из
   `docs/plan.md` §4, `verdict` / `xpDelta` выводятся из `rating`.
4. **`OrderFactory` + данные** (`core/services/order-factory.ts`,
   `core/data/menu.ts`, `core/data/customers.ts`) — переписать текущий стаб (там
   опечатка `constuctor`). Минимум: ингредиенты, бургер + напиток, клиент
   `normal`. `generateOrder()` → `IOrder` + `timeLimit`.
5. **`CommandParser` + `replies.ts`** (`twitch/`) — `!put сыр` → `TaskIntent`,
   `!serve`, `!bin`, `!menu`; ответы по `TaskAck` и `AssessmentResult`.

## Шаги (± время)

1. **S0 — тест-раннер** (≈15 мин): `vitest` + скрипт `test`. DoD: `pnpm test`
   зелёный на пустом тесте.
2. **S1 — типы шва** (≈30 мин): `core/types/tray.ts`, `core/game/sim-dto.ts`,
   `core/game/sim-port.ts`. DoD: `pnpm check` проходит; в `core/**` нет импортов
   из `lib/sim/**`.
3. **S2 — RULE CORE** (≈1.5 ч): `data/menu.ts`, `data/customers.ts`,
   `OrderFactory`, `OrderValidator`, `scoring.ts`. DoD: юнит-тесты оценки
   (идеал, недостача, лишнее, не тот напиток, гурман).
4. **S3 — `SessionManager`** (≈1 ч): сессии, таймер, XP. DoD: тест «заказ закрыт
   один раз», `onTimeout` срабатывает и идемпотентен.
5. **S4 — `StubSim` + связка** (≈30 мин): `sim/stub.ts` + композиция (диспетчер
   событий на `ISimEvents` подписан на `SessionManager`). DoD: `enqueueTask`
   возвращает `TaskAck` и шлёт событие.
6. **S5 — сценарный тест «беседа»** (≈1 ч): `!start, !put ×3, !serve` → вердикт;
   `!bin`; `!serve` с пустым подносом → `tray_empty`; таймаут. DoD: весь цикл
   работает через
   `CommandParser → SessionManager → StubSim → OrderValidator → xpDelta → следующий заказ`.
   **Момент, когда «процесс игры работает».**

## Чего НЕ делаем сейчас

- miniplex-мир, тик/движение (`simulation.ts`, `move.ts`, `actions.ts`);
- снапшот позиций для оверлея, SSE-сервер, PROJECTION-страница;
- twurple-чат;
- анимации, pathfinding, очереди у станций.

Всё это — шаги `docs/sim.md` и `docs/plan.md` S6/S7, они прикручиваются поверх
сохранённого шва.

## Решено

- тест-раннер: **vitest** (дружит с SvelteKit/vite; у `node --test` проблемы с
  алиасом `#lib` и type-stripping).
- план сохранён в `docs/mvp.md`; реализация начинается по подтверждению.
