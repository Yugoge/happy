## 研究目标
定位 web 端关闭/重开同一 session 后，为什么“claude babling”状态与后续实时输出没有被正确 resync。

## 文件 + 行号（"claude babling" 渲染位置 + state source）
- 主 session 页左下角状态文案/圆点实际渲染在 `packages/happy-app/sources/components/AgentInput.tsx:778-804`。
- 这个状态由 `SessionView` 传入：`packages/happy-app/sources/-session/SessionView.tsx:225-236`、`packages/happy-app/sources/-session/SessionView.tsx:496-544`。
- 状态计算逻辑在 `packages/happy-app/sources/utils/sessionUtils.ts:22-74`：
  - `session.presence === 'online'` -> 在线
  - `session.agentState.requests` -> `permission_required`
  - `session.thinking === true` -> `thinking`（会显示随机 vibing/babling 文案）
  - 否则只显示 `online`
- `session.thinking` / `session.presence` 的存储字段定义在 `packages/happy-app/sources/sync/storageTypes.ts:77-90`。
- app 端把 ephemeral activity 写回 session 状态的地方在 `packages/happy-app/sources/sync/sync.ts:2212-2235` + `packages/happy-app/sources/sync/sync.ts:2238-2253`。
- app 端还会在**实时 new-message**里，根据 `task_started / task_complete / turn-start / turn-end` 补写 thinking 状态：`packages/happy-app/sources/sync/sync.ts:1801-1845`。
- 但是**重开/重连时的 hydrate 路径**在 `packages/happy-app/sources/sync/sync.ts:784-808`，这里把所有 session 先硬置为 `thinking: false`、`thinkingAt: 0`。
- `fetchMessages()` 只拉 message history，不会像 live `handleUpdate()` 一样回放 lifecycle 来恢复 `session.thinking`：`packages/happy-app/sources/sync/sync.ts:1647-1729`。

结论：
- “claude babling”不是直接读某个 server-side persisted 字段；
- 它是 app 本地 `session.thinking` 的 UI 投影；
- 这个字段在 live path 能被 ephemeral / lifecycle 更新，但在 reopen hydrate path 会先被清零。

## 重连流程链路（CLI → server → app 各段）
1. **CLI 侧 keepAlive / thinking**
   - `packages/happy-cli/src/claude/session.ts:69-73`：session 启动后立即 `keepAlive()`，之后每 2 秒发一次。
   - `packages/happy-cli/src/claude/session.ts:85-93`：thinking 或 mode 变化时也会立即发。
   - 真正发包在 `packages/happy-cli/src/api/apiSession.ts:523-533`，事件名是 `session-alive`，而且是 `socket.volatile.emit(...)`。

2. **server 侧接收 / 广播**
   - `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts:146-186`：server 收到 `session-alive` 后：
     - 校验 session
     - 更新 activity cache / DB 的 `lastActiveAt`
     - 广播 ephemeral `activity { active, activeAt, thinking }` 给 **user-scoped** 客户端

3. **app 侧 socket 连接模型**
   - app 用的是 **user-scoped socket**，不是 per-session subscribe：`packages/happy-app/sources/sync/apiSocket.ts:59-69`。
   - server 的路由规则在 `packages/happy-server/sources/app/events/eventRouter.ts:264-279`：
     - `all-interested-in-session` 会发给“匹配 session 的 session-scoped 连接 + 所有 user-scoped 连接”。
   - 也就是说：**app 并不存在“重连后重新发 session 订阅请求”这一步**。app 只有一个全局 user-scoped socket。

4. **app 侧“可见 session” catch-up 机制**
   - session 页面 mount 时调用 `sync.onSessionVisible(sessionId)`：`packages/happy-app/sources/-session/SessionView.tsx:278-281`。
   - `onSessionVisible()` 只是触发该 session 的 REST 增量拉取：`packages/happy-app/sources/sync/sync.ts:229-245`。
   - 增量接口是 `/v3/sessions/:id/messages?after_seq=...`：server 在 `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts:53-102`，app 拉取在 `packages/happy-app/sources/sync/sync.ts:1647-1729`。

5. **socket reconnect 后 app 做了什么**
   - socket 自动重连逻辑在 `packages/happy-app/sources/sync/apiSocket.ts:52-72`、`packages/happy-app/sources/sync/apiSocket.ts:228-236`。
   - reconnect callback 在 `packages/happy-app/sources/sync/sync.ts:1756-1771`：只会 invalidates `sessionsSync / machinesSync / artifacts / feed / sendSync...`。
   - 关键：**这里不再对所有 session 做 `fetchMessages()`**。

6. **当前代码里“可见 session 在 reconnect 后会自动 re-fetch”这件事并不成立**
   - `sync.ts` 注释写的是“SessionView 会在 `realtimeStatus` 变化时 re-fetch”：`packages/happy-app/sources/sync/sync.ts:1765-1767`。
   - 但 `SessionView` 依赖的是 `useRealtimeStatus()`：`packages/happy-app/sources/-session/SessionView.tsx:275-281`。
   - 这个 `realtimeStatus` 是**语音 realtime** 状态，不是 socket 状态；其定义/写入在 `packages/happy-app/sources/sync/storage.ts:759-762`，实际由 `packages/happy-app/sources/realtime/*` 更新。
   - 真正的 websocket 状态是 `socketStatus`：`packages/happy-app/sources/sync/storage.ts:788-805`、`packages/happy-app/sources/sync/storage.ts:1332-1337`。
   - 其他页面已经在用 `useSocketStatus()`（例如 `packages/happy-app/sources/components/MainView.tsx:114-150`、`packages/happy-app/sources/components/HomeHeader.tsx:166-190`），但 `SessionView` 没用它。

结论：
- app 没有 per-session subscribe/resubscribe；
- 它依赖“全局 socket + 可见 session 的 REST catch-up”；
- 当前 reconnect 后，这个 visible-session catch-up 没有绑定到 websocket 状态恢复。

## ephemeral event 广播机制
- CLI **主动 emit** `session-alive`：`packages/happy-cli/src/api/apiSession.ts:523-533`。
- server **主动广播** ephemeral `activity`：`packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts:181-186`。
- ephemeral schema 在 app 端是 `packages/happy-app/sources/sync/apiTypes.ts:153-159`。
- server 构造 activity payload 的代码在 `packages/happy-server/sources/app/events/eventRouter.ts:494-501`。

关键事实：
- server / DB **只持久化** `active` + `lastActiveAt`，没有持久化 `thinking`：
  - Prisma schema: `packages/happy-server/prisma/schema.prisma:93-105`
  - `/v1/sessions` 返回字段也没有 `thinking`：`packages/happy-server/sources/app/api/routes/sessionRoutes.ts:14-72`
- server 对 machine connect 有一个“上线即广播”的特例：`packages/happy-server/sources/app/api/socket.ts:103-112`。
- 但对 session **没有**类似的“新 client 连上后立即下发当前 thinking snapshot”的逻辑；session 在线/思考状态只能靠 CLI 下一次 `session-alive` 或下一条 lifecycle/new-message 再次带过来。

因此：
- reconnect 后 app 能从 REST/DB 立刻知道“这个 session 还 online”；
- 但它**不能**从 REST/DB 立刻知道“这个 session 现在正在 babling/thinking”；
- 如果下一次 `session-alive` 没及时到，UI 就只剩 `online`。

## 历史 commit（相关 / 嫌疑回归）
与 BA 既有 H_A-H_D 同层的 commit：
- `5a08be71` — `fix: batch outbox flush (latest-first) and log backoff errors`
- `ae29dd3e` — `fix: prevent permanent message loss from flushOutbox cursor jump`
- `cca7fe27` — `fix: Bug #9 flushOutbox cursor jump causes permanent message loss`
- `22c5e38b` — `fix(sync): detect flushOutbox seq gap and recover missed messages`

这些都在 **flushOutbox / seq-gap / message-loss** 层，不是 session-activity resync 层。

本次更相关的历史：
- `bbf73532` (2026-03-18) — `fix: Bug B — detect degraded WebSocket via ACK timeout + force reconnect`
  - 这是 transport/reconnect 层修复。
- `bf919356` (2026-03-18) — `feat: add disconnect logging for Bug B root cause investigation`
- `7d2bf1fa` (2026-03-21) — `Fix iOS session list freeze and invisible sessions`
  - 这次把 reconnect 时“对所有 session 批量 fetchMessages”的逻辑移除了；
  - commit message 明确说依赖 “SessionView already re-fetches on realtimeStatus change”；
  - 但当前代码里这个 `realtimeStatus` 实际是 voice realtime，不是 websocket reconnect 状态。

我没有找到一个明确“修过 reconnect 后恢复 babbling/status indicator”的 commit。
最可疑的历史拐点是：**`7d2bf1fa` 移除了 reconnect fallback，但替代条件并没有真正挂在 socketStatus 上。**

## 提出的新假设 H_E（layer + target_location + 与已有假设的差异）
**H_E：这是一个 `happy-app` 的“session activity hydrate / reconnect catch-up”层 bug，不是 flushOutbox/message-flush 层 bug。**

### target_layer
- App reconnect / visible-session catch-up / transient activity re-hydration

### target_location
- `packages/happy-app/sources/sync/sync.ts:784-808` — `fetchSessions()` reopen 时把 `thinking` 重置为 `false`
- `packages/happy-app/sources/sync/sync.ts:1647-1729` — `fetchMessages()` 只补 message，不回放 lifecycle 到 `session.thinking`
- `packages/happy-app/sources/-session/SessionView.tsx:278-281` — visible-session catch-up 绑定的是 `realtimeStatus`（voice），不是 `socketStatus`
- `packages/happy-app/sources/sync/sync.ts:1756-1771` — reconnect 后不再全量补 fetchMessages

### H_E 内容
reopen 一个正在跑后台任务的 session 时，当前代码可能走出这条链：
1. app 启动 / reconnect，`sessionsSync` 先把该 session hydrate 成 `active=true, thinking=false`；
2. server 没有 persisted `thinking`，也没有“新连接即下发当前 thinking snapshot”；
3. 如果下一次 volatile `session-alive` 心跳没有立刻补到 app，状态就只显示 `online`，不会显示 babling；
4. 如果**任务完成 / Claude 输出**恰好落在 reconnect gap 内，`new-message` update 会错过；而 reconnect 后又没有一个真正绑定 `socketStatus` 的 visible-session catch-up，于是完成后的文字也不会立刻被拉回来。

### 与 BA 的 H_A-H_D 的差异
- H_A-H_D：都在 **message flush / accumulator / websocket payload drop / backoff** 层。
- H_E：在 **session activity 的重连再水合（rehydration）+ visible-session catch-up 触发条件** 层。
- 不是“消息被 flush 丢了”，而是“重连后 app 没把当前 session 的 transient state 和 reconnect gap 期间的增量重新补齐”。

### 与 prior fix commits（cca7fe27 / ae29dd3e / 22c5e38b / 5a08be71）的差异
- prior fixes 的 target 都是 `flushOutbox` / seq cursor / POST batching；
- H_E 的 target 是 `happy-app` 的 `SessionView + sync reconnect/hydrate` 路径，以及 server 缺失 thinking snapshot；
- layer 和 target_location 都不同。

## 验证方案（怎么 runtime 抓证据排除/确认 H_E）
1. **复现时开浏览器 Network/WS（Preserve log）**
   - 打开一个正在跑 subagent 的 session；
   - 关闭 tab；
   - 重新打开同一 session。

2. **抓 REST hydrate 证据**
   - 看 `/v1/sessions` 响应：应只有 `active/activeAt`，没有 `thinking`；
   - reopen 后立刻在 console 检查 `storage.getState().sessions[SESSION_ID].thinking`，预期先是 `false`。

3. **抓 websocket reconnect 证据**
   - 看 `/v1/updates` connect 时刻；
   - 看 connect 后有没有收到 `ephemeral { type:'activity', id: SESSION_ID, thinking:true }`；
   - 如果没有，这就说明 babbling 没有 snapshot，只能等下一次心跳。

4. **抓“visible-session catch-up 没绑定 socketStatus”证据**
   - 在 reopen 之后，观察 socket 从 `connecting -> connected` 时，是否会自动再发一次 `/v3/sessions/:id/messages?after_seq=...`；
   - 按 H_E，**不会**因为 websocket connected 而自动再拉一次（除非页面 remount / 又来一条 update / 语音 realtime 状态变化）。

5. **抓 completion 落在 reconnect gap 的证据**
   - 让 subagent 在 tab 关闭期间结束；
   - server log 里应能看到该 session 的 `new-message` / 更高 seq；
   - 但 app reopen 后如果没有 post-connect catch-up，请求里的 `after_seq` 不会再推进到那条完成消息。

6. **区分 H_E 与 H_A-H_D**
   - 若 server/DB 已经有完成消息，且 manual refresh/重新进入 session 后能看到，而不是永远丢失，那么更像 H_E；
   - 若 server/DB 根本没有那条消息，才更像 BA 的 flush/message-loss 层。

7. **额外观察点**
   - CLI 在 session socket reconnect 时没有“connect 后立刻 resend 当前 thinking snapshot”的专门逻辑，只有 2s keepAlive timer：
     - `packages/happy-cli/src/api/apiSession.ts:151-155`
     - `packages/happy-cli/src/claude/session.ts:69-73`
   - 这会放大 reconnect 窗口里的 babbling 丢失现象。
