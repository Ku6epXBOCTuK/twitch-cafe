# O3: снапшот оверлея — план

Продолжение O2 (`docs/o2-commands.md`). Входное состояние: ядро умеет всё нужное
(входящие слоты, сессии с sealed/currentItemIndex, RecipeBook), SSE-роут отдаёт
демо-данные, фронт уже рисует кадры из `OverlaySnapshot`.

Задача O3 — заменить заглушку реальной проекцией: из состояния ядра собирать
`OverlaySnapshot` и стримить его в SSE. Мониторные сущности (incoming/
execution/recipe) сохраняют форму — фронт и `pixi-boards.ts` уже под них
написаны. Единственное изменение формы: добавляем поле `players` (аватарки
появятся в O4+, данные нужны уже сейчас, чтобы потом в SIM было меньше возни).

## 1. Проекция: `src/lib/overlay/projector.ts`

Чистая функция без состояния — на вход ядро, на выход `OverlaySnapshot`. Логика
и типы остаются в core-доступных слоях: проектор читает только публичные методы
SM/IncomingOrders/RecipeBook (ядро не знает про оверлей).

- [x] **incoming**: `sm.incomingOrders.getSlots()` → непустые слоты →
      `IncomingOrder { id, dishes: items.map(i => i.item.name), strictness: order.customer.strictness, deadline: createdAt + timeLimit }`.
- [x] **execution**: только заказы на мониторах. Источник — сессии SM: добавить
      метод `getSessions(): PlayerSession[]` (shallow-копии всех сессий; ядро не
      отдаёт живую мутабельную Map). Фильтр `status === PENDING` →
      `ExecutionOrder { id: order.id, performer: username, dishes, deadline }`.
      `ExecutionDish { name, done }`:
  - `state === SEALED` → `done: true`;
  - текущее блюдо (index === currentItemIndex) → `done: false` (MVP: без
    прогресса по слоям подноса — прогресс добавим, когда решим как считать);
  - будущие → `done: false`.
- [x] **players**: отдельная сущность для будущих аватарок (рендер — потом, в
      O4+; сейчас только данные, чтобы потом меньше возни в SIM). Для каждого
      игрока из `getSessions()`:
      `PlayerState { username, x: 0, y: 0, order: PlayerOrder | null }`:
  - координаты — заглушка `0, 0`, реальные появятся из SIM (O4);
  - `order` — только при `status === PENDING`:
    `PlayerOrder { dishes: PlayerDish[] }` — статус заказа по блюдам: сколько в
    заказе (длина массива), сколько выполнено (done), и тип каждого блюда для
    иконки над аватаркой;
    `PlayerDish { kind: "burger" | "pizza" | "drink", done: boolean }`: `done` =
    блюдо запечатано (`ORDER_ITEM_STATE.SEALED`); текущее и будущие — `false`.
    После serve/timeout/без заказа → `order: null` (сессия осталась в players —
    игрок ещё на кухне).
- [x] **тип блюда**: в `IMenuItem` нет категории «бургер/пицца/напиток» —
      добавляем поле `kind` в `IMenuItemBase`
      (`MENU_ITEM_KIND = { BURGER, PIZZA, DRINK }`); `data/menu.ts`: бургер →
      `kind: "burger"`, кола → `kind: "drink"`.
- [x] **recipe**: `sm.recipeBook.getCurrent()` →
      `RecipeCard { id, name, ingredients: item.recipe?.ingredients ?? [] }` (у
      simple — пустой список) или `null`. Решено: рецепт висит на доске, пока
      его не заменит `!рецепт` или не скроет `stop()` — автоскрытия нет.
- [x] Типы: в `overlay/types.ts` добавить `PlayerDish`, `PlayerOrder`,
      `PlayerState`, поле `players: PlayerState[]` в `OverlaySnapshot`.

Факт реализации: в `SessionManager.nextDish` добавлена пометка текущего блюда
`ORDER_ITEM_STATE.SEALED` (до этого `nextDish` только копил `session.sealed`,
поэтому `state === SEALED` никогда не был истинным и `done` был бы всегда
`false`).

## 2. SSE-роут: реальная проекция

`src/routes/api/overlay/sse/+server.ts`: убрать `stubSnapshot()`, каждый кадр —
`project(getGame().sessionManager)`. Интервал 250 мс оставляем (MVP-поллинг
состояния, диффы/пуш по событиям — бэклог). `getGame()` идемпотентен.

## 3. Тесты

- [x] `projector.test.ts` (новый): собрать SM с фиксированной фабрикой заказов
      (паттерн session-manager.test.ts):
  - 2 заказа в слотах → incoming: имена блюд, strictness, deadline;
  - занятый слот (после takeOrder) → исчез из incoming;
  - исполнитель: сессия с 2 блюдами (бургер + кола) → dishes [{done:false},
    {done:false}]; после `!next` → [{done:true}, {done:false}];
  - после serve/timeout (status ≠ PENDING) → исполнитель исчез;
  - players: после takeOrder →
    `{ username, x: 0, y: 0, order: { dishes: [{ kind: "burger", done: false }, { kind: "drink", done: false }] } }`;
    после `!next` → бургер `done: true`; после serve/timeout → `order: null`
    (сессия осталась в players — игрок ещё на кухне);
  - recipe: show(буржер) → карта с ингредиентами; show(кола) → пустые
    ингредиенты; без show → null.
- [x] `sse.test.ts`: обновить — первый кадр стрима соответствует проекции
      пустого/тестового ядра (пока SSE-роут собирает кадр из getGame, тест
      проверяет только структуру кадра: парсится как OverlaySnapshot).

## 4. Не делаем (бэклог)

- Пуш по событиям вместо 250 мс поллинга.
- Прогресс сборки текущего блюда (слои подноса на доске исполнения).
- Автоскрытие рецепта.
- Реальные координаты игроков и рендер аватарок — O4 (SIM).
- XP в оверлее не выводится.
- Рендер players на фронте — данных в снапшоте достаточно, рисуем позже.
- `kind` на `ExecutionDish` (на мониторах показываем имя, тип нужен только у
  аватарок) и `kind` в RecipeCard (рецепт — карточка с именем).
- FIFO-перезапись слота монитора исполнения по `!заказ` и стабильные позиции
  слотов: O3 отдаёт `execution` как проекцию PENDING-сессий в порядке взятия,
  фронт рисует их по индексу массива. Реальная сетка слотов с перезаписью
  старейшего — бэклог.

## 5. DoD (docs/overlay.md)

- [x] проекция, players-сущность, execution из PENDING-сессий + тесты. Оговорки
      (перенесено в «Не делаем»): прогресс MenuItem и FIFO-перезапись слота по
      `!заказ` — бэклог.
- [x] `pnpm test` зелёный, `pnpm check`/`pnpm lint`/`pnpm build` чистые

## 6. Шаги

1. **O3.1**: `MENU_ITEM_KIND` + `kind` в `IMenuItem`/`data/menu.ts`; типы
   оверлея (`PlayerDish`, `PlayerOrder`, `PlayerState`,
   `OverlaySnapshot.players`); `SessionManager.getSessions()`; `projector.ts`
   - юнит-тесты.
2. **O3.2**: SSE-роут на проекторе, обновить `sse.test.ts`.
3. **O3.3**: финальная проверка (test/check/format/lint/build), DoD-галочки
   (docs/overlay.md O3, этот файл); правки pixi-boards не нужны — новые поля
   фронт игнорирует.
