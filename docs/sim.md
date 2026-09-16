# SIM: MVP-план на miniplex и стык с ORDER/TRAY

Детализация шага 2 из `docs/plan.md` («Порядок работ»). В документе только то,
что запланировано к реализации.

## 0. Объём MVP

- мир на `miniplex` (`new World<SimEntity>()`), персонаж на зрителя;
- станции: полки с ингредиентами, мусорка, выдача (координаты — в `config.ts`);
- одно действие за раз: персонаж доделывает текущее действие или отказывает;
- `!put <ингредиент>` — идёт к полке и кладёт ингредиент на поднос;
- `!bin` — идёт к мусорке и очищает поднос;
- `!serve` — идёт к выдаче и отдаёт замороженный снимок слоёв в RULE CORE;
- шов `ISimPort` / `ISimEvents` (`sim-port.ts` + `sync.ts`);
- снапшот `SimSnapshot` для оверлея.

## 1. Одна правда: кто чем владеет

Заказ живёт в RULE CORE, поднос — в SIM. Встречаются только на шве
`sim/sync.ts`.

| Данные                                     | Владелец                | Кто читает                     | Как передаётся                                 |
| ------------------------------------------ | ----------------------- | ------------------------------ | ---------------------------------------------- |
| `IOrder` (items, customer, `timeLimit`)    | RULE CORE (учётка)      | SIM — только срез `order`      | `ISimPort.startOrder(username, order)`         |
| `tray.layers` (порядок слоёв!)             | **SIM** (сущность tray) | RULE CORE — только снимок      | `ITraySnapshot` в `ACTION_COMPLETED` (`serve`) |
| позиции и текущее действие персонажа       | **SIM**                 | PROJECTION через `SimSnapshot` | снапшот по тику                                |
| `xp`, уровень, таймер, `rating`, `xpDelta` | RULE CORE               | в SIM не попадают              | —                                              |

Правила импортов:

```txt
SIM (src/lib/sim/**)        → core (только типы: IOrder, ITraySnapshot, DTO шва)
RULE CORE (src/lib/core/**) → ничего из src/lib/sim/**
app/twitch слой             → оба (композиционный корень: бот, сервер оверлея)
PROJECTION (src/routes/**)  → только DTO-типы (import type)
```

Так RULE CORE остаётся юнит-тестируемым без запущенного мира: в тестах можно
подсунуть фейковый `ISimPort`.

> `verbatimModuleSyntax: true` в tsconfig → типы импортируем только через
> `import type`.

## 2. Что нужно знать про miniplex 2.0.0 (проверено по `.d.ts` пакета)

- Мир: **`new World<SimEntity>()`**. Хелпера `createWorld` в 2.x нет.
- Сущности — обычные объекты, компоненты — их свойства: `world.add(e)`,
  `world.remove(e)`, `world.entities`, `world.size`, `world.has(e)`.
- Запросы: `world.with("chef")`, `world.without("action")` → `Query<E>`;
  итерация `for (const e of query)`. Запросы кэшируются → выносим в константы
  модуля, а не создаём внутри функций.
- `where(pred)` **не** переоценивается при изменении свойств: нужен
  `world.reindex(entity)`, поэтому состояние выражаем наличием компонента.
- `world.addComponent(e, "action", …)` / `removeComponent(e, "action")`
  автоматически реиндексируют сущности.
- `world.id(entity)` / `world.entity(id)` — числовые id: только их храним в
  компонентах (`trayId`, `carrierId`, `targetId`), чтобы снапшот сериализовался
  в JSON.
- Планировщика систем нет: тик и порядок систем — наши.

## 3. Мир: сущности и компоненты

```ts
// src/lib/sim/types.ts
export type EntityId = number;
export type IngredientId = string;

export type StationKind = "shelf" | "bin" | "serving";
export type ActionKind = "put" | "serve" | "bin";

export type SimEntity = {
  meta?: { kind: "chef" | "station" | "tray" };
  chef?: { username: string };
  station?: {
    kind: StationKind;
    ingredientIds?: IngredientId[]; // только у полок
  };
  tray?: { layers: IngredientId[] }; // порядок = порядок завершённых put
  carries?: { trayId: EntityId }; // на персонаже
  carriedBy?: { carrierId: EntityId }; // на подносе
  order?: { orderId: string; customerId: string }; // срез, физике не нужен
  transform?: { x: number; y: number; facing: number };
  action?: {
    kind: ActionKind;
    ingredientId?: IngredientId; // для put
    targetId: EntityId; // станция, к которой идёт
    startedAt: number; // simTime, мс
  };
};
```

Поднос всегда в руках персонажа (`carries` ↔ `carriedBy`), поэтому `put` — это
один поход к полке: взял ингредиент и положил на свой поднос.

Состояния — это набор компонентов:

| Состояние          | Компоненты                             |
| ------------------ | -------------------------------------- |
| свободный персонаж | `meta, chef, transform` (без `action`) |
| занятый персонаж   | `+ action`                             |
| персонаж с заказом | `+ carries, order`                     |
| поднос             | `tray` (+ `carriedBy`)                 |

```ts
// src/lib/sim/world.ts
const world = new World<SimEntity>();

export const queries = {
  chefs: world.with("chef", "transform"),
  busyChefs: world.with("chef", "action"),
  freeChefs: world.with("chef", "transform").without("action"),
  stations: world.with("station"),
  trays: world.with("tray"),
};
```

Станции создаются один раз при инициализации мира из `config.ts`
(`KITCHEN_STATIONS`: id, kind, x, y, ингредиенты у полок), там же —
`START_POINT`, откуда появляется персонаж.

## 4. Действия: одно за раз — принять или отказать

Заявка из чата либо принимается (персонаж свободен), либо **отклоняется** с
причиной.

```ts
// src/lib/core/game/sim-dto.ts — типы шва, объявляет RULE CORE
export type TaskIntent =
  | { kind: "put"; ingredientId: IngredientId }
  | { kind: "serve" }
  | { kind: "bin" };

export type TaskRefusal =
  | "no_character" // зритель не в игре
  | "busy" // персонаж уже что-то делает — ответ «персонаж ещё идёт»
  | "unknown_ingredient" // нет полки с таким ингредиентом
  | "tray_empty"; // !serve с пустым подносом

export type TaskAck = { ok: true } | { ok: false; reason: TaskRefusal };
```

Порядок применения:

1. `SessionManager` → `ISimPort.enqueueTask(username, intent)`.
2. SIM **синхронно** проверяет и возвращает `TaskAck` (для ответа в чат через
   `replies.ts`).
3. Принятая заявка сразу ставит персонажу компонент `action` (он занят), а
   движение начинается со следующего тика.

Заявку применяем сразу из колбэка чата: JS однопоточный, тик атомарен, колбэк
выполняется между тиками — пересечения нет.

Соответствие «команда → действие → поднос»:

| Команда     | Действие                         | По прибытии                         | Эффект на `tray.layers`                       |
| ----------- | -------------------------------- | ----------------------------------- | --------------------------------------------- |
| `!put <id>` | идти к полке с этим ингредиентом | берёт ингредиент и кладёт на поднос | `push(id)`                                    |
| `!bin`      | идти к мусорке                   | сбрасывает поднос                   | `layers.length = 0`                           |
| `!serve`    | идти к выдаче                    | отдаёт поднос                       | слои не меняются, **замораживаются** в снимок |

Одно действие = один поход к целевой станции:

- персонаж движется к `targetId` с константной `SPEED`;
- **действие завершается по прибытии** (позиция совпала с координатами станции):
  SIM применяет эффект и шлёт `ACTION_COMPLETED`;
- время действия = `distance / SPEED` — оно не хранится в компоненте, а следует
  из позиции и скорости;
- прогресс оверлей считает сам из позиций снапшота.

Почему один поход, а не «полка → поднос»: поднос персонаж носит с собой
(`carries` ↔ `carriedBy`), поэтому положить ингредиент можно сразу на месте у
полки.

Внутри `put` одна нога: дошёл до полки — положил ингредиент. Роль таймингов
полностью выполняет позиция.

## 5. Тик

```ts
// src/lib/sim/simulation.ts
export interface Simulation {
  tick(dt: number): void; // ручной шаг: тесты и прод — один и тот же код
  start(): void; // setInterval(1000 / TICK_HZ)
  stop(): void;
  snapshot(): SimSnapshot;
}
```

Порядок систем в тике:

| #   | Система   | Что делает                                                              |
| --- | --------- | ----------------------------------------------------------------------- |
| 1   | `move`    | Двигает занятых персонажей к `targetId` на `SPEED * dt`                 |
| 2   | `actions` | По прибытии применяет эффект, снимает `action`, кладёт событие в outbox |
| 3   | `outbox`  | Отдаёт накопленные события наружу (`ISimEvents`)                        |

- `simTime += dt` внутри тика; `action.startedAt` — в `simTime`, не в
  `Date.now()`.
- `TICK_HZ = 20`, `dt = 50`. Игровой логики на `setTimeout` нет.
- Тест «прошло 3 секунды» = 60 вызовов `tick(50)`.

## 6. Стык с ORDER

### Порт (`src/lib/core/game/sim-port.ts`, объявляет RULE CORE)

```ts
// src/lib/core/game/sim-port.ts
import type { IOrder } from "../types/order";
import type { ITraySnapshot } from "../types/tray";
import type { SimSnapshot, TaskAck, TaskIntent } from "./sim-dto";

export interface ISimPort {
  /** `!join`: поднять персонажа, поднос и срез заказа. */
  startOrder(username: string, order: IOrder): void;
  /** `!put` / `!bin` / `!serve`: принять или отказать. */
  enqueueTask(username: string, intent: TaskIntent): TaskAck;
  /** Таймаут/выход: оборвать действие и очистить поднос. */
  cancelOrder(username: string, reason: "timeout" | "leave"): void;
  /** Забрать персонажа (дисконнект). */
  despawn(username: string): void;
  /** Чтение: `!menu`, снапшот оверлея. */
  getTraySnapshot(username: string): ITraySnapshot | undefined;
  getSnapshot(): SimSnapshot;
}

export interface ISimEvents {
  /** Реализует SessionManager. Вызывается из дренажа outbox, вне тика. */
  onActionStarted(e: ActionStartedEvent): void;
  onActionCompleted(e: ActionCompletedEvent): void;
  onCharacterRemoved(e: { username: string }): void;
}
```

`sim/sync.ts` — единственный файл, знающий оба слоя:
`connectSim(sessionManager)` создаёт симуляцию, подписывает outbox на
`ISimEvents` и возвращает `ISimPort`.

### Цикл `!start`

```txt
CommandParser → SessionManager.startOrder(username)
  → OrderFactory.generateOrder() → IOrder (в учётке), таймер в учётке
  → ISimPort.startOrder(username, order)
  → SIM: сущности chef + tray (carries/carriedBy), срез order, стартовая позиция
  → replies.ts: «Обычный заказал бургер, 90 секунд»
```

### Цикл `!put`

```txt
ChatBot → CommandParser → SessionManager.putIngredient(username, "cheese")
  → ISimPort.enqueueTask({ kind: "put", ingredientId: "cheese" })
  → TaskAck: { ok: true } либо { ok: false, reason: "busy" | "unknown_ingredient" }
  → replies.ts: «Бегу за сыром» / «Персонаж ещё идёт»
... позже: персонаж дошёл до полки
  → tray.layers.push("cheese") + ACTION_COMPLETED { kind: "put", ingredientId }
  → SessionManager.onActionCompleted: фиксирует, XP не начисляет
```

### Цикл `!serve`

```txt
... персонаж дошёл до выдачи
  → ITraySnapshot { username, layers, frozenAt } + ACTION_COMPLETED { kind: "serve", tray }
  → SessionManager: остановить таймер
  → OrderValidator.assessOrder(snapshot, order) → scoring → xp/xpDelta
  → replies.ts: вердикт и ±XP → следующий заказ (ISimPort.startOrder)
```

Правила стыка:

- `enqueueTask` — единственный **синхронный** вызов (нужен `TaskAck` для ответа
  в чат), плюс чтения (`getTraySnapshot`, `getSnapshot`). Всё остальное —
  события.
- Переход по заказу инициирует **учётка**: новый заказ выдаётся после
  `serve`/таймаута, SIM сообщает только о завершении.
- Таймер — в учётке (`onTimeout` идемпотентен: если `serve` уже завершён —
  игнор). Симуляция таймеров не знает.
- Порядок слоёв = порядок завершённых `put`, а не порядок сообщений в чате: для
  `fillingOrder: "ordered"` это честная ошибка слоёв.

## 7. Исходящие события SIM

```ts
// src/lib/core/game/sim-dto.ts
export interface ActionInfo {
  kind: ActionKind;
  ingredientId?: IngredientId;
  targetId: EntityId;
  startedAt: number;
}

export type SimOutEvent =
  | { type: "ACTION_STARTED"; username: string; action: ActionInfo }
  | {
      type: "ACTION_COMPLETED";
      username: string;
      finishedAt: number;
      action: ActionInfo;
      tray?: ITraySnapshot; // только для kind === "serve"
    }
  | { type: "CHARACTER_REMOVED"; username: string };

/** Те же типы для ISimEvents (§6) — без дублирования структур. */
export type ActionStartedEvent = Extract<
  SimOutEvent,
  { type: "ACTION_STARTED" }
>;
export type ActionCompletedEvent = Extract<
  SimOutEvent,
  { type: "ACTION_COMPLETED" }
>;
```

`ACTION_COMPLETED` самодостаточно: снимок подноса для `serve` приезжает внутри
события, поэтому `SessionManager` не обращается к SIM обратно из обработчика.

## 8. Стык с TRAY

Поднос — отдельная сущность (`meta, tray`) со ссылками:

```txt
chef.carries   = { trayId }
tray.carriedBy = { carrierId }
```

- **один писатель**: `layers` мутирует только `actions.ts` при завершении
  действия;
- поднос как сущность нужен для передачи на выдачу и для позиции в снапшоте;
- `tray.layers` — только id ингредиентов, порядок = порядок завершённых `put`;
- один поднос на персонажа, `!bin` чистит слои (сущность живёт до `despawn`).

| Момент           | Кто меняет     | Как                                     | Что видит RULE CORE                        |
| ---------------- | -------------- | --------------------------------------- | ------------------------------------------ |
| `!start`         | `startOrder`   | создать `tray { layers: [] }` + ссылки  | —                                          |
| `put` завершён   | `actions.ts`   | `layers.push(ingredientId)`             | `ACTION_COMPLETED { kind: "put" }`         |
| `bin` завершён   | `actions.ts`   | `layers.length = 0`                     | `ACTION_COMPLETED { kind: "bin" }`         |
| `serve` завершён | `actions.ts`   | слои не меняются, читается снимок       | `ACTION_COMPLETED { kind: "serve", tray }` |
| новый заказ      | `startOrder`   | `layers.length = 0`                     | —                                          |
| `cancelOrder`    | `actions.ts`   | `layers.length = 0`, действие снимается | —                                          |
| `despawn`        | `despawn`      | поднос удаляется вместе с персонажем    | `CHARACTER_REMOVED`                        |
| `!menu`          | никто (чтение) | `getTraySnapshot(username)`             | —                                          |

Снимок — тип шва для оценки:

```ts
// src/lib/core/types/tray.ts
export interface ITraySnapshot {
  username: string;
  /** Порядок = порядок завершённых put. Только id: SIM не знает IIngredient. */
  layers: string[];
  /** simTime в момент фиксации — для отладки расхождений с таймером. */
  frozenAt: number;
}
```

Два правила:

1. **Замораживаем в момент прибытия на выдачу** (копия массива), а не когда
   `SessionManager` соизволит прочитать: иначе `put`, завершившийся между
   `serve` и обработкой события, изменил бы проверяемые слои.
2. **id → `IIngredient` превращает `OrderValidator`** по каталогу
   `core/data/menu.ts`. Так SIM не тянет игровые данные, а `assessOrder`
   остаётся чистой функцией без запущенного мира.

## 9. Файлы MVP

| Путь                                                            | Статус | Что это                                                              |
| --------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `src/lib/core/types/tray.ts`                                    | new    | `ITraySnapshot`                                                      |
| `src/lib/core/game/sim-dto.ts`                                  | new    | `TaskIntent`, `TaskAck`, `ActionInfo`, `SimOutEvent`, `SimSnapshot`  |
| `src/lib/core/game/sim-port.ts`                                 | new    | `ISimPort`, `ISimEvents`                                             |
| `src/lib/core/game/session-manager.ts`                          | new    | учётка: сессии, таймер, XP, вызовы `ISimPort`                        |
| `src/lib/core/types/order.ts`                                   | edit   | `CANCELLED` → `EXPIRED` (примечание в `docs/plan.md`)                |
| `src/lib/sim/types.ts`                                          | new    | `SimEntity` + компоненты (§3)                                        |
| `src/lib/sim/config.ts`                                         | new    | `TICK_HZ`, `SPEED`, `START_POINT`, `KITCHEN_STATIONS`                |
| `src/lib/sim/world.ts`                                          | new    | `new World<SimEntity>()`, `queries`, спавн станций/персонажа/подноса |
| `src/lib/sim/simulation.ts`                                     | new    | `tick(dt)`, `start/stop`, порядок систем, outbox, `simTime`          |
| `src/lib/sim/systems/actions.ts`                                | new    | принять/отказать, завершение по прибытии, `tray.layers`              |
| `src/lib/sim/systems/move.ts`                                   | new    | движение к целевой станции                                           |
| `src/lib/sim/snapshot.ts`                                       | new    | `SimSnapshot` из мира (S6)                                           |
| `src/lib/sim/sync.ts`                                           | new    | **шов**: `ISimPort` + `outbox → ISimEvents`                          |
| `src/lib/sim/index.ts`                                          | new    | публичный API слоя                                                   |
| `src/lib/twitch/command-parser.ts`, `replies.ts`, `chat-bot.ts` | new    | twurple, разбор чата, ответы (S7)                                    |
| `src/lib/twitch/overlay-server.ts`                              | new    | SSE-сервер снапшота для оверлея (S6)                                 |

## 10. Шаги

| Шаг    | Что делаем                                                                     | Definition of Done                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S0** | тест-раннер: `vitest` + скрипт `test`                                          | `pnpm test` проходит на пустом тесте; `pnpm check`/`pnpm lint` зелёные                                                                                                                                  |
| **S1** | типы шва и порт (`types/tray.ts`, `sim-dto.ts`, `sim-port.ts`, `sim/types.ts`) | `pnpm check`; в `core/**` нет импортов из `lib/sim/**`                                                                                                                                                  |
| **S2** | мир и кухня (`world.ts`, `config.ts`)                                          | тест: станции/персонаж/поднос создаются, запросы их находят, `world.remove` чистит индексы                                                                                                              |
| **S3** | тик и движение (`simulation.ts`, `move.ts`)                                    | тест: персонаж доходит до станции за `distance / SPEED`; `tick` работает без `setInterval`                                                                                                              |
| **S4** | действия и поднос (`actions.ts`)                                               | тесты: занятый персонаж → `busy`; свободный → `put` доводит до полки и `layers` растёт; порядок слоёв = порядок прибытия; `bin` чистит; `serve` отдаёт снимок; `serve` на пустом подносе → `tray_empty` |
| **S5** | шов (`sync.ts`, `session-manager.ts`)                                          | интеграционный тест «беседа»: `!start`, `!put x3`, `!serve` → `assessOrder` → `xpDelta`; `onTimeout` закрывает заказ один раз                                                                           |
| **S6** | снапшот + оверлей (`snapshot.ts`, `overlay-server.ts`, страница)               | оверлей рисует позиции/прогресс/слои из снапшота, без логики на фронте                                                                                                                                  |
| **S7** | twurple (`command-parser.ts`, `replies.ts`, `chat-bot.ts`)                     | живой чат: `!join`, `!put`, `!serve`, `!bin`, `!menu`; ответы из `TaskAck` и `AssessmentResult`                                                                                                         |
