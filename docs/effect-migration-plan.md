# Twitch Cafe: план миграции на Effect-TS

> Статус: проектный план архитектурной миграции.
>
> Обновлено: 2026-09-24.
>
> Решение о версии зафиксировано в [`effect-v4-rc-adr.md`](effect-v4-rc-adr.md).
>
> Миграция направлена не на замену `{ ok: boolean, ... }` ради типизации ошибок,
> а на получение предсказуемой системы эффектов, lifecycle, таймеров, внешних
> интеграций и диагностики. План не меняет игровые правила и не переписывает
> чистое доменное ядро только ради соответствия стилю Effect.

## 1. Решение и границы

### Предварительное решение

Начать с `effect@4.0.0-rc.117` — версии Effect 4.x release candidate. Это
осознанный выбор целевой API, но версия должна быть зафиксирована точно в
`package.json` и `pnpm-lock.yaml`; floating-обновления RC запрещены. Перед
основной миграцией пройти короткий compatibility-spike с `Effect`, `Clock`,
`Scope`, `Layer`, `Schema` и `TestClock` в текущем SvelteKit/Vite стеке. Если
spike не проходит, миграция останавливается на composition root и не
продолжается вслепую. Неиспользуемые `unstable` модули v4 не подключать.

### Что входит

- единая модель успешных и ошибочных результатов;
- управление таймерами, интервалами и файберами через scoped lifecycle;
- явный запуск и остановка игрового runtime;
- контролируемая обработка ошибок на границах Twitch, SIM и HTTP/SSE;
- детерминированное тестирование времени и внешних зависимостей;
- структурированное логирование и трассировка игровых операций;
- последовательная миграция `TaskAck`, `SessionManager`, `IncomingOrders`, SIM и
  presentation boundary.

### Что не входит

- превращение `OrderValidator`, `scoring` и `CommandParser` в Effect-цепочки без
  операций, таймеров или внешних зависимостей;
- изменение баланса XP, текстов реплик и игровых сценариев;
- одновременный переход на настоящий miniplex SIM и Effect; событийный SSE
  реализуется отдельным этапом миграции;
- хранение состояния в Effect-типах: `Effect` не является хранилищем игрового
  состояния;
- двойной запуск старой и новой системы, который может начислить XP дважды;
- автоматическое обновление RC-версии или переход на `unstable` API в рамках
  основной миграции.

## 2. Текущее состояние проекта

Текущий baseline: `pnpm test`, `pnpm check` и `pnpm lint` проходят; Vitest
запускает 15 test-файлов и 118 тестов.

Основные места, которые предстоит сделать надёжнее:

| Место                                                                                                           | Текущий риск                                                   | Целевое свойство                                                       |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/lib/core/game/incoming-orders.ts:27-43,63-83`                                                              | `setInterval` и несколько `setTimeout` живут вручную           | Один управляемый fiber с гарантированным cleanup                       |
| `src/lib/core/game/session-manager.ts:110-114,216-233`                                                          | Таймер заказа и его отмена связаны с мутабельным состоянием    | Scoped timeout/fiber и идемпотентное завершение                        |
| `src/lib/core/game/bootstrap.ts:10-19`                                                                          | Module-local singleton скрывает запуск и остановку             | Явный `GameRuntime` со слоями и shutdown                               |
| `src/lib/core/game/sim-dto.ts:21`                                                                               | `TaskAck` смешивает успех, отказ и DTO                         | Effect-ошибка с машинным `_tag` и типизированным payload               |
| `src/lib/sim/stub.ts:44-81`                                                                                     | Синхронный порт и callbacks создают неявные границы            | Effect-порт и контролируемый event stream/queue                        |
| `src/lib/twitch/chat-bot.ts:32-43`                                                                              | Ошибка ловится вручную и только логируется                     | Ожидаемые ошибки становятся ответами, дефекты попадают в наблюдаемость |
| `src/routes/api/overlay/sse/+server.ts:18-25`                                                                   | Polling и остановка interval не связаны с игровым runtime      | Subscription с lifecycle и гарантированным завершением                 |
| `src/lib/core/game/session-manager.test.ts`, `src/lib/sim/stub.test.ts`, `src/lib/twitch/chat-commands.test.ts` | Сценарии одновременно проверяют lifecycle, XP, verdict и текст | Отдельные contract-, policy- и integration-тесты                       |

Текущие `{ ok: ... }` являются узкими discriminated unions, а не произвольным
`boolean`-контрактом. Их нужно заменить не потому, что они не типизированы, а
потому, что Effect должен единообразно описывать отказ, отмену, дефект и ресурс.

## 3. Инварианты надёжности

До изменения кода зафиксировать следующие проверяемые свойства. Они являются
критериями приёмки для каждого этапа.

1. **Один terminal transition.** Заказ переходит в `COMPLETED` или `EXPIRED`
   ровно один раз. Повторный `serve`, повторный timeout и повторное событие SIM
   не меняют XP второй раз.
2. **Корректная отмена.** Завершение заказа, сгорание входящего заказа,
   остановка runtime и HMR освобождают все связанные таймеры, fibers и
   subscriptions.
3. **Детерминированное время.** Поведение зависит от `Clock`, а не от
   `Date.now()` и реального `setTimeout`; тесты не ждут реальное время.
4. **Детерминированная генерация.** OrderFactory получает `Random`/seed, поэтому
   один и тот же сценарий воспроизводится.
5. **Ожидаемая ошибка не теряется.** `busy`, `tray_empty`, `unknown_ingredient`
   и подобные отказы возвращаются в командный boundary и превращаются в ответ.
6. **Неожиданный дефект наблюдаем.** Unexpected error не маскируется под игровой
   отказ; в лог попадают operation, order, username и причина, а пользователь
   получает безопасный ответ без внутренних деталей.
7. **Один владелец состояния.** Операции одного заказа сериализуются;
   асинхронный SIM не может применить `serve` одновременно с timeout или вторым
   `serve`.
8. **Внешние данные валидируются на границе.** Конфигурация, входные события и
   данные SIM проходят `Schema`-декодирование до попадания в RULE CORE.
9. **Runtime имеет явный shutdown.** Повторный запуск не создаёт второй игровой
   процесс, а остановка завершает все дочерние ресурсы.
10. **Поведение не дублируется.** Нельзя запускать старый и новый обработчик на
    одном мутабельном состоянии даже в shadow-режиме.

## 4. Целевая архитектура

```text
Twitch / SSE / startup
          │
          ▼
    Effect boundary
          │
          ▼
   GameRuntime / Layers
      │          │
      ▼          ▼
 SessionManager  SimPort Effect
      │          │
      ▼          ▼
   Rule Core   SIM events
 (чистые DTO)      │
      │             ▼
      └──────── Event stream/queue
                       │
                       ▼
                 Projection / SSE
```

### Роли Effect-примитивов

| Примитив                     | Назначение в проекте                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `Effect`                     | Операции, которые могут завершиться ошибкой, отменой или дефектом |
| `Clock`                      | Все игровые таймеры, дедлайны и время в snapshot                  |
| `Random`                     | Воспроизводимая генерация заказов и customer                      |
| `Scope`                      | Владение таймерами, fibers, подписками и cleanup                  |
| `Schedule`                   | Повторяющийся spawn и retry-политики                              |
| `Context` + `Layer`          | Зависимости runtime: core, SIM, clock, logger, конфигурация       |
| `Schema`                     | Декодирование конфигурации и внешних DTO на границах              |
| `Exit` / `Cause`             | Различение ожидаемого отказа, interruption и дефекта              |
| `Logger`                     | Структурированные игровые события и диагностика                   |
| `Stream` или bounded `Queue` | Доставка SIM-событий и переход к событийному SSE                  |
| `TestClock`                  | Детерминированные timeout/interval тесты                          |

### Что остаётся обычными функциями

Следующие модули не должны зависеть от Effect только из-за стиля:

- `OrderValidator.assessOrderDishes`;
- `scoring.ts`;
- `CommandParser.parse`;
- `replies.ts`;
- функции преобразования snapshot и проекции, если у них нет lifecycle или
  внешней ошибки.

Их результаты можно оборачивать в Effect на границе orchestration-слоя.

### Целевой контракт ошибок

Внутренние отказы получают стабильные машинные теги, а не текст для чата:

```ts
type GameFailure =
  | { readonly _tag: "Busy" }
  | { readonly _tag: "NoCharacter" }
  | { readonly _tag: "UnknownIngredient"; readonly ingredientId: string }
  | { readonly _tag: "TrayEmpty" }
  | { readonly _tag: "NoActiveOrder" }
  | { readonly _tag: "LastItem" }
  | { readonly _tag: "EmptySlot"; readonly slot: number };
```

Предпочтительная реализация — tagged errors Effect (`Data.TaggedError` или
`Schema.TaggedError` для внешних DTO). Перед окончательным API нужно
зафиксировать выбор в отдельном ADR. `TaskAck` постепенно исчезает: успешный
путь возвращает эффект с полезным значением, отказ — типизированную ошибку.

Публичный текст ошибки формируется только в presentation boundary. Внутренние
сообщения и stack trace не должны попадать в Twitch.

### Целевые сигнатуры

Иллюстрация, не финальный API:

```ts
type TaskEffect = Effect.Effect<void, TaskRefusal>;

interface SimPort {
  readonly enqueueTask: (username: string, intent: TaskIntent) => TaskEffect;
}

interface GameRuntime {
  readonly takeOrder: (
    username: string,
    slotIndex: number,
  ) => Effect.Effect<IOrder, TakeOrderFailure>;
  readonly serve: (
    username: string,
  ) => Effect.Effect<AssessmentResult, ServeFailure>;
}
```

Сохранять `ISimPort` как runtime-независимый интерфейс можно на переходном
этапе. Синхронные методы чтения (`getTraySnapshot`, `getSnapshot`) не требуется
немедленно делать Effect; асинхронные команды и lifecycle — требуется.

## 5. Правила миграции

1. **Один вертикальный срез за этап.** Не менять одновременно весь core, SIM,
   Twitch и overlay.
2. **Сначала инвариант, потом API.** Сначала добавляется тест на cleanup или
   идемпотентность, затем меняется реализация.
3. **Не оборачивать чистые функции.** Effect должен оплачивать только реальные
   эффекты: время, I/O, конкурентность, ресурсы, ошибки процесса.
4. **Сохранять адаптер на каждом этапе.** Старый вызов и новый Effect-вызов
   могут сосуществовать на одной границе, но не должны одновременно менять
   состояние.
5. **Не использовать `Effect.runPromise` как замену lifecycle.** В production
   runtime должен запускаться и останавливаться явно; promise callbacks нужны
   только на границах SvelteKit/Twurple.
6. **Пинить версию Effect.** Обновление minor/major не совмещать с миграцией
   прикладного кода.
7. **Разделять expected failure и defect.** Игровые отказы не логировать как
   исключения; дефекты не превращать в обычные игровые ответы.
8. **Не добавлять telemetry до стабилизации ошибок.** Сначала должны быть
   стабильные теги и correlation fields, затем sinks для логов/метрик.
9. **Enum-like описания оформлять через `as const`.** Сначала создаётся объект
   со значениями, затем из него выводится единственный тип:
   `const ACTION_KIND = { PUT: "put", ... } as const` и
   `type ActionKind = (typeof ACTION_KIND)[keyof typeof ACTION_KIND]`. Для
   связанных наборов используются отдельные объекты вроде `OPERATION`,
   `TASK_REFUSAL`, `COMMAND_KIND` и `GAME_EVENT_TYPE`, а не ручные union.
10. **Не дублировать union-типы.** Перед добавлением нового тега искать и
    переиспользовать канонический объект или тип; не заводить второй
    `TaskOperation = "put" | "serve" | "bin"` рядом с `ActionKind` и не
    расширять тип вручную через `ActionKind | "next"`.
11. **Discriminated union dispatch только через Effect `Match`.** Для
    `GameEvent`, `ParsedCommand`, `TaskRefusal` и аналогичных union использовать
    `Match.type(...).pipe(Match.when(...), Match.exhaustive)`. `switch` и
    цепочки `if` по `reason`/`kind` запрещены; `if` допустим только для обычных
    предикатных условий.
12. **Новый тег события сразу проходит через все слои:** union,
    renderer/handler, тест полезного payload и state transition.

## 6. Этапы миграции

Оценки ниже — инженерные ориентиры для одного разработчика, знакомого с
проектом. После пилота их нужно пересчитать по фактическому diff и профилю
нагрузки.

### Этап 0. Решение и контракт

**Ориентир:** 1 день, включая короткий compatibility-spike.

**Задачи:**

- зафиксировать `effect@4.0.0-rc.117` и версию в lockfile;
- создать ADR с целями, non-goals и моделью ошибок;
- записать инварианты из раздела 3;
- собрать минимальный smoke-тест с `Effect.gen`, `Clock`, `Scope`, `Layer`,
  `Schema` и `TestClock`;
- проверить smoke-тест в Vitest и production build;
- определить, где находится production runtime;
- выбрать событийный `Stream`-контракт SSE с initial replay и scoped cleanup;
- зафиксировать способ graceful shutdown и HMR cleanup.

**Готово:** ADR принят; smoke-тест подтверждает нужные v4 API; до начала кода
нет открытых вопросов о версии и runtime; `pnpm test`, `pnpm check`, `pnpm lint`
и `pnpm build` зелёные. Если smoke-тест не проходит, миграция не продолжается до
отдельного решения; автоматического отката на Effect 3.x нет.

### Этап 1. Тестовая инфраструктура

**Ориентир:** 1–2 дня. Выполнять параллельно с этапом 0.

**Задачи:**

- вынести общие order/tray/menu fixtures;
- вынести `makeOrder` и fake `ISimPort` в test-support;
- добавить отдельные проверки scoring policy;
- в `SessionManager` и SIM-тестах проверять состояние, transition и XP delta, а
  не повторять весь баланс;
- заменить текстовые contract-тесты `replies.ts` на проверки `GameEvent`;
  сценарии чата проверяют тип события, payload и изменение состояния;
- подготовить тестовый запуск Effect через `Effect.runPromise` и `TestClock`.

**Готово:** тесты можно запускать без реального ожидания времени; policy-тесты
один раз фиксируют XP/verdict; `GameEvent` проверяется отдельно от renderer; все
существующие сценарии сохранены.

### Этап 2. Effect substrate и composition root

**Ориентир:** 1–2 дня.

**Задачи:**

- добавить минимальный composition root для `Clock`, `Random`, `Logger` и
  конфигурации;
- описать сервисы через `Context` и production/test `Layer`;
- создать `GameRuntime` с `start` и `shutdown`;
- сделать `StubSim` доступным через тестовый и production layer;
- перенести module-local bootstrap в управляемый `GameRuntime`;
- добавить проверку повторного `start` и `shutdown`.

**Не делать на этом этапе:** менять весь `SessionManager` или подключать Effect
ко всем чистым функциям.

**Готово:** runtime можно собрать в тестовом слое, запустить и остановить дважды
без утечки ресурсов; production bootstrap вызывает явный lifecycle.

### Этап 3. `IncomingOrders` и игровое время

**Ориентир:** 1–2 дня.

**Задачи:**

- заменить ручной `setInterval` на повторяющийся Effect с `Schedule`;
- заменить burn-таймеры на scoped fibers или keyed deadlines;
- перенести `ORDER_CONFIG` в конфигурационный слой, сохранив текущие значения;
- перевести `takeOrder` в Effect с `EmptySlot` ошибкой;
- добавить тесты через `TestClock`: spawn, burn, take, stop;
- проверить, что взятие заказа отменяет только burn-таймер этого слота.

**Готово:** после `shutdown` нет активных таймеров; повторный запуск не создаёт
дублирующий spawn loop; пустые/сгоревшие слоты имеют стабильные failure tags.

### Этап 4. `SessionManager` и заказный lifecycle

**Ориентир:** 2–4 дня.

**Задачи:**

- сделать `takeOrder`, `nextDish`, `putIngredient`, `serve` и `bin`
  Effect-aware;
- хранить timeout/fiber handle в scope сессии или в отдельном scheduler
  registry;
- сериализовать операции заказа;
- заменить проверку дубля `frozenAt` на контракт terminal transition плюс
  `orderId`/sequence события;
- отдельно обработать гонку `serve` с timeout;
- сохранить XP как результат доменной операции, а presentation-контракт
  проверять через `GameEvent`, если он понадобится;
- добавить fault-injection сценарии: late serve, duplicate serve, timeout после
  serve, stop во timeout.

**Готово:** ни один сценарий не может начислить или снять XP дважды; любой отказ
таймера виден в `Exit`/логах; все timers/fibers освобождаются при завершении
заказа и shutdown.

### Этап 5. Команды и Twitch boundary

**Ориентир:** 2–3 дня.

**Задачи:**

- сделать `processMessage` возвращающим `Effect` или запускать его через единый
  command service;
- перевести `CommandSink` на `emit(GameEvent)`; `replies.ts` оставить временным
  Chat renderer, а не источником игрового контракта;
- преобразовать `TaskAck` consumers в success/failure branches Effect;
- отделить expected failure-to-reply от defect-to-logging;
- подключить Twurple callback через fork/run boundary с гарантированной
  обработкой rejection;
- добавить correlation id к команде, username и order id;
- проверять в command-тестах только `GameEvent`, payload и состояние; не
  фиксировать язык, регистр или форматирование текста.

**Готово:** любая команда завершает Effect явным ветвлением; внутренний дефект
не приводит к тихому `return`; callback не оставляет необработанный Promise.

### Этап 6. SIM boundary

**Ориентир:** 3–7 дней.

**Задачи:**

- перевести `ISimPort.enqueueTask` на Effect-контракт;
- решить, будет ли событийная шина `Stream`, bounded `Queue` или hybrid;
- гарантировать порядок и максимальную задержку доставки `ACTION_COMPLETED`;
- адаптировать `StubSim` без изменения игрового поведения;
- добавить backpressure или явную политику переполнения очереди;
- подготовить контракт для будущего miniplex SIM;
- определить поведение при disconnect/despawn во время pending action.

**Готово:** повторная доставка события безопасна; перезапуск SIM не создаёт
дубликаты; очередь имеет конечную ёмкость и наблюдаемое переполнение.

### Этап 7. Projection и SSE

**Ориентир:** 1–3 дня. Выбран событийный вариант доставки через `Stream`;
snapshot используется только для первичного состояния и replay.

**Задачи:**

- читать snapshot через runtime service, а не через module-local singleton;
- решить, остаётся ли polling совместимым адаптером или переходит на stream;
  выбран stream-вариант с scoped subscription и bounded replay;
- при stream-варианте использовать scoped subscription и cleanup при disconnect;
- не вычислять игровые решения на frontend;
- сохранить независимый schema contract теста для overlay snapshot;
- после отключения чата удалить `replies.ts`, а OBS/SSE перевести на прямые
  `GameEvent` без текстового renderer.

**Готово:** закрытие SSE-клиента освобождает ресурс; snapshot соответствует
контракту независимо от способа доставки.

### Этап 8. Удаление legacy-контрактов

**Ориентир:** 1–2 дня.

**Задачи:**

- удалить `TaskAck` и публичные `{ ok: true/false }` из production-сигнатур;
- удалить дублирующие `TakeOrderResult`, если они больше не нужны;
- удалить ручные `setTimeout`/`setInterval` из core и SIM;
- удалить `try/catch`, которые скрывают Effect failure;
- добавить поиск/линт-проверку, запрещающую возврат ad-hoc `{ ok: ... }` из
  orchestration-кода;
- обновить `docs/plan.md` и `docs/backlog.md` после принятия результата.

**Готово:** legacy-типы не используются в production; адаптеры удалены или имеют
явную дату удаления; нет скрытых lifecycle-обходов.

**Выполнено 2026-09-24:** удалены `TaskAck`, sync-методы `SessionManager` и
`IncomingOrders`, `RecipeBook`-result union, `ISimEvents` и module-local
`getGame`; добавлен `pnpm check:legacy`, тесты переведены на Effect/очередь.

### Этап 9. Production hardening

**Ориентир:** 2–4 дня.

**Задачи:**

- fault injection для SIM, clock, logger и Twitch sink;
- проверка graceful shutdown и HMR;
- soak-тест с несколькими игроками и большим числом команд;
- проверить отсутствие unbounded fibers/queues/subscriptions;
- добавить минимальные метрики: commands, failures, queue depth, active
  sessions, timer count;
- проверить отсутствие XP/токенов/внутренних stack traces в логах и ответах.

**Готово:** production smoke test проходит, а отказ одного слоя не приводит к
тихой остановке процесса или неконсистентному XP.

## 7. Параллельная работа над тестами

Тестовая задача является частью миграции, а не отдельным косметическим убором.

### Политика тестовых констант

- Точные значения XP и verdict хранятся в одном scoring policy-тесте.
- Lifecycle-тесты проверяют transition, delta и идемпотентность, а не повторяют
  формулу баланса.
- `ORDER_CONFIG`, slot count и time limit берутся из production config.
- Названия блюд и ингредиенты собираются из menu/recipe data, если тест не
  проверяет конкретный пользовательский контракт.
- Тексты реплик не являются game contract: `replies.ts` — временный renderer,
  который можно удалить вместе с chat-доставкой.
- Chat integration проверяет `GameEvent`, payload и изменение состояния.

### Обязательные reliability-тесты

- повторный `serve` не меняет XP;
- timeout после `serve` не меняет XP;
- late event после timeout не меняет XP;
- `stop` освобождает spawn loop и все pending deadlines;
- два последовательных `start` не создают два цикла;
- ошибка SIM не теряется и попадает в observability boundary;
- очередь событий имеет конечную ёмкость и контролируемое переполнение;
- command boundary всегда завершает Effect, включая unexpected failure.

## 8. Ошибки, логирование и трассировка

### Политика ошибок

- `busy`, `no_character`, `unknown_ingredient`, `tray_empty` и аналогичные
  ситуации — ожидаемые domain failures;
- ошибки конфигурации, неверные DTO и нарушение инварианта — failures с
  контекстом;
- programmer error и неожиданные исключения — defects, требующие отдельного
  логирования;
- failure tag не должен совпадать с русским текстом реплики;
- пользователь получает безопасное краткое сообщение, внутренняя диагностика
  остаётся в логах.

### Минимальные поля логов

- `operation`: `take-order`, `serve`, `timeout`, `sim-task`;
- `username`;
- `orderId`;
- `eventId` или sequence, если событие пришло из SIM;
- `failureTag` для expected failure;
- `cause` для дефекта;
- `duration` и `activeSessionCount` для операций с внешним временем.

Токены Twitch и credentials не записываются в логи.

## 9. Версионирование и откат

- Каждый этап оформляется отдельным набором изменений и проходит все проверки.
- Этап считается обратимым, пока старый вызов поддерживается адаптером.
- Не делается двойная запись состояния: старый и новый runtime не могут
  одновременно менять XP или lifecycle.
- Для scoring возможен shadow-режим только на чистой функции без общего
  состояния.
- Если Effect-ветка не проходит reliability или performance gate, возвращается
  composition root предыдущего этапа, а не вся миграция.
- Версия Effect обновляется отдельным change set после завершения миграции.

## 10. Риски и открытые решения

| Риск                                        | Что сделать                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Effect 4.x RC меняет API                    | Использовать только pinned `4.0.0-rc.117`; обновлять RC отдельным change set после compatibility-spike |
| Effect runtime внутри Svelte component      | Держать runtime на server/game boundary, компоненты получают только сервисы или данные                 |
| Порядок SIM-событий меняется                | Ввести sequence/event id и тесты на late/duplicate/reordered events                                    |
| Очередь растёт при медленном overlay        | Ограничить ёмкость, измерить drop policy и backpressure                                                |
| Effect добавляет bundle/runtime overhead    | Проверить `pnpm build` и размер server bundle на этапе 2                                               |
| Старые тесты завязаны на sync API           | Мигрировать через адаптеры, а не переписывать всё одним патчем                                         |
| Scope не покрывает ручной singleton         | Сделать `GameRuntime` единственным владельцем ресурсов                                                 |
| Ошибки конфигурации проходят слишком поздно | Валидировать `.env` и config через Schema при startup                                                  |
| Наблюдаемость без correlation id            | Ввести поля из раздела 8 до подключения внешнего sink                                                  |

Открытые решения, которые нужно закрыть до этапа 2:

1. `effect@4.0.0-rc.117` проходит compatibility-spike; следующий RC обновлять
   только отдельным решением.
2. `Stream` или bounded `Queue` как основной SIM event transport.
3. Один runtime на весь процесс или отдельные runtime для game и overlay.
4. Политика переполнения очереди: backpressure, drop или reconnect.
5. Нужна ли миграция SSE в этом же плане.
6. Где хранить operation/event sequence до появления persistence.

## 11. Definition of Done миграции

- [ ] Effect и его версия зафиксированы.
- [ ] В production есть явный `GameRuntime` со стартом и shutdown.
- [ ] Все core timers работают через управляемый lifecycle.
- [ ] Нет ручных `setTimeout`/`setInterval` в мигрированных слоях.
- [ ] Нет production-контрактов вида `{ ok: boolean, ... }` в orchestration API.
- [ ] Expected failures и defects разделены и обрабатываются по-разному.
- [ ] Повторные, конкурентные и late SIM-события безопасны.
- [ ] XP и terminal state меняются ровно один раз.
- [ ] Chat, SIM и startup failures не теряются.
- [ ] Время и random генерация детерминированы в тестах.
- [ ] Точные XP/verdict проверяются в scoring policy-тесте, а command-тесты
      проверяют `GameEvent` и payload без текстовых snapshots.
- [ ] SSE/overlay имеет понятный lifecycle.
- [ ] Выполнены `pnpm test`, `pnpm check`, `pnpm lint` и `pnpm build`.
- [ ] Есть production smoke/fault-injection сценарий.
- [ ] Legacy-адаптеры удалены или явно ограничены сроком жизни.

## 12. Ближайшие шаги

1. Согласовать ADR и зафиксировать `effect@4.0.0-rc.117`.
2. Выделить общие fixtures и reliability-тесты.
3. Создать минимальный `GameRuntime`/test layer без изменения игровой логики.
4. Перевести `IncomingOrders` на `Clock`/`Scope`/`TestClock`.
5. Перевести terminal lifecycle `SessionManager` и доказать идемпотентность.
6. Только после этого переходить к chat/SIM/SSE.

Главный критерий начала следующего этапа — не количество переведённых функций, а
выполнение инвариантов из раздела 3 и отсутствие двойной мутации состояния.
