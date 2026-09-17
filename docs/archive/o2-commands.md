# O2: команды — план

Продолжение O1 (`docs/o1-incoming-orders.md`). Входное состояние: `!join`
удалён, взятие заказа — только программный `sm.takeOrder(username, slotIndex)`;
поднос — плоский список слоёв; `OrderValidator.assessOrder` оценивает весь
поднос против всего заказа сразу.

Задача O2 — вернуть игрокам интерфейс: `!взять`, `!заказ`, `!next`, `!рецепт`, и
заложить в ядро dishes-модель (запечатывание блюд) для O3/O4.

## 1. `!взять`/`!take <1|2|3>` (новый ParsedCommand "take")

- Парсер: алиасы `["!взять", "!take"]`; аргумент — номер слота `1..3`
  (1-индексация для зрителей); нечисловой/отсутствующий аргумент → «напиши номер
  слота 1–3».
- `processMessage`: `sm.takeOrder(username, slotIndex - 1)`:
  - `ok` → `replyTakeOk(username, order)`;
  - `busy` → `replyTakeBusy(username)` — «у тебя уже есть заказ»;
  - `empty_slot` → `replyTakeEmptySlot(username)` — «слот пуст».
- Реплика ok: `${username} взял заказ №N: ${orderDescription(order)}.`
  (orderDescription уже есть в replies.ts).

## 2. `!заказ`/`!order` (kind "myorder")

- Реплика = текущий `replyMenu` (заказ + поднос), переиспользуем: парсер даёт
  `myorder`, в chat-commands это текущая ветка `menu` (алиасы
  `["!menu", "!заказ", "!order"]` — просто два новых алиаса у существующей
  команды; отдельный kind не нужен).
- Отказ «нет активного заказа» — существующий `replyNotInGame`.

## 3. `!рецепт`/`!recipe <блюдо>` (новый ParsedCommand "recipe")

- Резолв блюда: новый `resolveMenuItem(token)` в `src/lib/twitch/menu-items.ts`
  (по образцу ingredients.ts: точный id → точное имя → подстрока имени; по
  `MENU_ITEMS`). `!рецепт` без аргумента → «напиши название блюда».
- Новое состояние: `RecipeBook` (класс, файл
  `src/lib/core/game/recipe-book.ts`):
  - `show(itemId): { ok: true; item } | { ok: false; reason: "unknown_item" }` —
    просто валидация + запоминание последнего показанного (`current`).
  - `getCurrent(): IMenuItem | null`.
  - `stop()`.
- SM получает поле `readonly recipeBook: RecipeBook`, создаёт в конструкторе
  (как incomingOrders).
- Ветка "recipe" в chat-commands: unknown → «нет такого блюда», ok → «показываю
  рецепт: Бургер (Нижняя булочка, …)».

## 4. Dishes-модель: запечатывание блюд (`!next`)

Цель: заказ собирается по блюдам, готовое блюдо «запечатывается» и поднос
очищается. Оценка — по запечатанным блюдам + текущему подносу.

### 4.1 Модель (types)

- `types/order.ts`:
  - `const ORDER_ITEM_STATE = { PENDING: "PENDING", SEALED: "SEALED" }`;
  - `interface IOrderItem { item: IMenuItem; state: PENDING | SEALED }`.
  - `IOrder.items: IOrderItem[]` — **breaking**: все фабрики заказов
    (order-factory, fixedOrder/fixedBurgerOrder в тестах, demo-данные SSE, три
    фабрики `makeOrder`/`fixedOrder` в тестах) переводятся на
    `{ item, state: PENDING }`.

### 4.2 Прогресс заказа в сессии

- `PlayerSession`:
  - `order: IOrder` — без изменений;
  - `currentItemIndex: number` — индекс блюда, которое сейчас на подносе;
  - `sealed: ITraySnapshot[]` — снапшоты запечатанных блюд (frozenAt = момент
    запечатывания);
  - `lastResult` — вердикт последнего serve (как было).
- `currentItemIndex === items.length - 1` (последнее блюдо на подносе) — `!next`
  недоступен: «это было последнее блюдо заказа».
- `currentItemIndex === items.length` — всё запечатано → serve невозможен? Нет:
  последнее блюдо НЕ запечатывается `!next`'ом, оно уходит на serve. `!next`
  доступен только пока `currentItemIndex < items.length - 1`.

### 4.3 `!next` — парсер, ядро, поток

- Парсер: kind `next`, алиасы `["!next"]`.
- `SessionManager.nextDish(username)`:
  - нет сессии → `{ ok: false, reason: "no_order" }`;
  - `currentItemIndex >= items.length - 1` →
    `{ ok: false, reason: "last_item" }` — «это было последнее блюдо заказа»;
  - ok: снапшот подноса через port.getTraySnapshot → пустой поднос → отказ
    «поднос пуст — нечего запечатывать» (`reason: "tray_empty"`); непустой →
    `sealed.push(snapshot)`, `currentItemIndex++`, ответ ok.
  - Поднос очищается... кто чистит поднос? В current модели слои живут в SIM до
    нового startOrder. Варианты: (а) `port.cancelOrder(username, "leave")` —
    семантика «очистить поднос, персонаж остаётся»; (б) новый метод
    `ISimPort.clearTray(username)`. Выбор: **(б) clearTray** — отдельный метод с
    честной семантикой, StubSim реализует тривиально (layers = []),
    RecordingPort в тестах тоже. `cancelOrder` остаётся только для таймаута.
- После `!next` игрок кладёт ингредиенты следующего блюда на чистый поднос.
- `serve` остаётся как есть (enqueueTask serve), но оценка переезжает на
  dishes-модель:

### 4.4 Оценка (OrderValidator)

- `assessOrder(snapshot, order)` →
  `assessOrderDishes(sealed: ITraySnapshot[], current: ITraySnapshot | null, order: IOrder)`.
- Оценка как раньше, но per-dish: assessItem(item, layers соответствующего
  снапшота). `current` оценивается против блюда с индексом `items.length - 1`,
  запечатанные — против items[0..len-2]. Пример: заказ [бургер, кола]: бургер
  собирается на подносе, `!next` запечатывает его в sealed[0]; кола кладётся на
  поднос, `!serve` отдаёт sealed + current.
- Реплика serve: как раньше (вердикт, XP, замечания), без «Следующий заказ».

### 4.5 Очистка после serve

- После serve поднос пуст (SIM чистит при serve в dishes-модели? нет — serve
  отдаёт поднос на выдачу, поднос после serve пуст в реальной SIM). StubSim:
  после serve `layers = []`. Это соответствует «после serve игрок свободен».
  После serve сессия игрока остаётся (xp), игрок берёт новый заказ сам.

## 5. CommandSink: вывод ответов через интерфейс

`processMessage` сейчас возвращает `string | null`, жёстко привязывая вывод к
чату. Вводим узкий интерфейс вывода:

- `src/lib/twitch/command-sink.ts`:

  ```ts
  export interface CommandSink {
    reply(message: string): void;
  }
  ```

- `processMessage(raw, username, sm, sink)` → `null | void`: `null`, если
  сообщение не команда (решение остаётся до создания sink); все ответы —
  `sink.reply(...)`, возвращать строки больше не нужно.
- Реализации:
  - `ChatSink` (обёртка над `bot.say(channel, msg)`) — прод;
  - тестовый sink (массив строк) — проверки `toContain` по массиву вместо
    хрупких строковых ожиданий возврата.
- Расширение (методы `orderTaken`, `recipeShown` и т.п.) и второй sink для
  проактивных событий (таймаут, сгорание слота) — в O3/O4, когда будет видна
  форма SSE-кадров; сейчас таксономию событий не выдумываем.

## 6. Оверлей (O3-заготовка, минимум)

- `types.ts`: `ExecutionDish { name: string; sealed: boolean }` уже есть.
- SSE-стаб (api/overlay/sse) и проекция — **не трогаем** (O3). (Уточнение по
  итогам O2.1: SSE-стаб не использует `IOrder` — у `OverlaySnapshot` своя форма
  `dishes: string[]`, так что обновлять было нечего.)

## 7. Тесты

- `command-parser.test.ts` (новый): `!взять 2` → take+2; `!взять` / `!взять abc`
  → take с невалидным слотом; `!заказ`/`!order` → menu; `!рецепт бургер` →
  recipe; `!next` → next; алиасы `!take`/`!recipe`.
- `recipe-book.test.ts` (новый): show ok/unknown, getCurrent после show, unknown
  не сбрасывает current.
- `chat-commands.test.ts`: сценарий «`!взять 1` → собрал → `!next` → собрал
  второе блюдо → `!serve` → снова свободен → `!взять` другого слота»; отказы:
  `!взять` без номера, на пустой слот, busy; `!next` без заказа → no_order;
  `!next` на последнем блюде → last_item; `!рецепт` ок/неизвестное.
- `session-manager.test.ts`: `nextDish` ok (sealed растёт, поднос очищен),
  отказы (no_order, last_item, tray_empty), serve после next — оценка per-dish
  (правильный бургер запечатан + кола на подносе = perfect).
- `order-validator.test.ts` — обновить вызовы на assessOrderDishes (или оставить
  старый assessOrder как обёртку? — нет, удаляем: dishes-модель становится
  единственной).
- `stub.test.ts`: clearTray (после clearTray поднос пуст), serve очищает поднос
  (после serve поднос пуст).

## 8. Шаги

1. O2.1: dishes-модель (types/order.ts IOrderItem) + фабрики (order-factory,
   тестовые fixedOrder/fixedBurgerOrder, demo SSE) — breaking, всё зелёное.
2. O2.2: `!next` ядро: PlayerSession (currentItemIndex, sealed), nextDish,
   clearTray в ISimPort+StubSim, OrderValidator.assessOrderDishes, переписать
   тесты SM и валидатора.
3. O2.3: парсер (take/myorder-алиасы menu/recipe/next) + resolveMenuItem +
   RecipeBook + тесты парсера и RecipeBook.
4. O2.4: CommandSink (интерфейс + ChatSink + тестовый sink), ветки chat-commands
   (take, recipe, next) + реплики, переключение на sink, тесты сценариев.
5. O2.5: финальная проверка (test/check/format/lint/build), DoD-галочки
   (docs/overlay.md O2, этот файл).

## 9. DoD (docs/overlay.md)

- [x] `!взять`/`!заказ`/`!next`/`!рецепт` работают, тесты сценариев зелёные
- [x] `pnpm test` зелёный, `pnpm check`/`pnpm lint`/`pnpm build` чистые
