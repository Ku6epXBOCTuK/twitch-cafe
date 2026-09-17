# O1: входящие заказы — план

Решения зафиксированы: замена потока заказов **одним шагом** (без переходного
сопределения со старым `!join`), настройки в `src/lib/core/config.ts`,
придирчивость на доске — 0–5 звёзд (маппинг в проекции O3).

Следствие «одного шага»: после O1 у игроков нет ни одной команды — старый
`!join` удалён, новые (`!взять` и пр.) придут в O2. Часть `!put/!serve/!bin`
остаётся, но использовать их нечем до `!взять`.

## 1. `src/lib/core/config.ts` (новый)

```ts
export const ORDER_CONFIG = {
  SLOT_COUNT: 3,
  SPAWN_INTERVAL_MS: 20_000,
  SLOT_LIFETIME_MS: 60_000,
  ORDER_TIME_LIMIT_MS: 90_000,
} as const;
```

- `order-factory.ts` удаляет локальный `ORDER_TIME_LIMIT_MS`, импортирует из
  config. Все потребители константы — на новый импорт.

## 2. `src/lib/core/game/incoming-orders.ts` (новый сервис)

- `class IncomingOrders`:
  - `slots: (IOrder | null)[]` длиной `ORDER_CONFIG.SLOT_COUNT`;
  - `start()` — цикл спавна: раз в `SPAWN_INTERVAL_MS` кладёт новый заказ в
    **первый пустой слот** (все заняты — пропуск, повтор на следующем тике);
  - на каждый взятый в слот заказ — таймер сгорания `SLOT_LIFETIME_MS`;
    сгоревший заказ получает `status = EXPIRED`, слот освобождается;
  - `take(slotIndex): { ok: true; order } | { ok: false; reason: "empty_slot" }`
    — забирает заказ, гасит его таймер сгорания; пустой/невалидный индекс →
    `empty_slot`;
  - `stop()` — гасит все таймеры (для тестов);
  - `getSlots()` — снимок слотов для тестов и будущей проекции O3.
- `makeOrder` инжектится (по умолчанию `OrderFactory.generateOrder`) — как в SM.

## 3. `session-manager.ts` — замена потока заказов

- `startOrder(username)` удаляется.
- Новый `takeOrder(username, slotIndex)`:
  - у игрока уже есть `PENDING`-заказ → `{ ok: false, reason: "busy" }` («у тебя
    уже есть заказ»);
  - `incomingOrders.take(slotIndex)` → при `empty_slot` — отказ наверх;
  - иначе — ленивое создание `PlayerSession` (как раньше в `startOrder`), таймер
    `order.timeLimit` → `onTimeout`, `port.startOrder(username, order)`,
    `{ ok: true, order }`.
- `finishOrder`: авто-выдача следующего заказа удаляется — после serve игрок
  свободен, сессия (xp) живёт.
- `onTimeout`: авто-выдача удаляется, остальное как было (штраф XP,
  `port.cancelOrder(username, "timeout")`).
- `IncomingOrders` создаётся в конструкторе SM, `start()` — в
  `bootstrap.getGame()` (доска живёт независимо от игроков).
- Итоговый тип:
  `TakeOrderResult = { ok: true; order } | { ok: false; reason: "busy" | "empty_slot" }`.

## 4. Chat-слой — удалить `!join`

- `command-parser.ts`: убрать псевдонимы `!join`/`!start`, `"join"` из
  `ParsedCommand`.
- `chat-commands.ts`: убрать ветку join.
- `replies.ts`: убрать `replyJoinStart`/`replyJoinAlready` (если нигде больше не
  используются — проверить grep'ом).

## 5. Тесты

- `incoming-orders.test.ts` (новый, fake timers):
  1. наполнение: 3 тика спавна → 3 заказа; дальнейшие тики — не больше 3;
  2. спавн при полных слотах пропускается, освобождённый слот заполняется на
     следующем тике;
  3. сгорание: `advanceTimersByTime(SLOT_LIFETIME_MS)` → слот пуст, статус
     `EXPIRED`;
  4. `take` успешный: слот освобождён, таймер сгорания снят (не сгорает позже);
  5. `take` пустого слота / невалидного индекса → `empty_slot`.
- `session-manager.test.ts` (переписать под слоты):
  1. `takeOrder` после спавна → сессия лениво создана, персонаж заспавнен
     (`RecordingPort.startOrder`), отказы: busy при активном заказе,
     `empty_slot` на пустой слот;
  2. serve → XP/вердикт, **авто-выдачи нет** (port.startOrder не звался снова),
     игрок может взять новый заказ;
  3. timeout → штраф XP, `cancelOrder`, авто-выдачи нет.
- `chat-commands.test.ts`: сценарий `!join` удалить; сценарии, начинавшиеся с
  `!join`, перевести на прямой вызов `sm.takeOrder(...)` после прогрева спавна.

## DoD (docs/overlay.md)

- [x] тесты: наполнение до 3 слотов, сгорание, взятие пустого/занятого
- [x] `pnpm test` зелёный, `pnpm check`/`pnpm lint` чистые

## Открытые вопросы (не блокируют)

- Стартовые константы 20s/60s/90s — поправим в config без переделки.
- Сгоревший заказ = `EXPIRED` (отдельный статус не вводим).
