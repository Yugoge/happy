<!-- AUTO-GENERATED VIEW for user | source: docs/dev/specs/spec-20260506-203844.md | extracted: 2026-05-06T20:47:19Z -->

# user view of spec-20260506-203844

**Monolith**: docs/dev/specs/spec-20260506-203844.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> 用户要求“立刻在我面前展示你可以使用的全部tool工具渲染和所有非文本输出形式”。本意不是只看工具是否执行成功，而是要验证 Happy UI 中：
>
> - 哪些工具调用会被渲染成可见卡片；
> - 哪些非文本输出会以内联形式显示；
> - 图片、截图、文件 diff、subagent 生命周期、Playwright 交互、Web 类工具、MCP resource、PTY 流式输出等是否能在 Happy 前端稳定展示；
> - 如果工具结果存在但 Happy 没有显示，要明确区分“工具成功”与“Happy UI 渲染失败”。
>
> > `/spec 将以上全部内容总结为一个超级清单，并且给出我的原文详细反馈以及你对图形渲染和工具调用的反馈`

---

## Section 1: Before

<!-- WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context) -->
<!-- WHAT: Screenshot path + text description of the current state BEFORE any fix attempt. -->
<!-- This establishes the baseline so later cycles can compare. -->

### Cycle 1

当前调查基于用户在 Happy dev 会话中直接观察到的工具渲染结果、用户截图反馈、以及主 agent 对实际工具调用链路的反馈。

#### 1.1 用户最初希望验证的能力

用户要求“立刻在我面前展示你可以使用的全部tool工具渲染和所有非文本输出形式”。本意不是只看工具是否执行成功，而是要验证 Happy UI 中：

- 哪些工具调用会被渲染成可见卡片；
- 哪些非文本输出会以内联形式显示；
- 图片、截图、文件 diff、subagent 生命周期、Playwright 交互、Web 类工具、MCP resource、PTY 流式输出等是否能在 Happy 前端稳定展示；
- 如果工具结果存在但 Happy 没有显示，要明确区分“工具成功”与“Happy UI 渲染失败”。

#### 1.2 用户截图反馈中已确认的实际可见内容

用户先后反馈自己实际只看到：

- 标题变更；
- Terminal 卡；
- MCP/Playwright Browser Navigate 卡；
- MCP/Playwright Browser Take Screenshot 卡，但之前截图结果没有内联预览；
- Terminal 里读取 imagegen skill 或查找生成图片路径的输出；
- apply_patch/update file 卡；
- spawn/wait/close agent 三张 subagent 控制工具卡；
- view_image 卡显示文件名和路径，但未显示真正图片预览；
- MCP/Playwright 交互动作卡。

#### 1.3 用户截图中明确暴露的问题

用户提供的截图显示：

1. Terminal 卡可以显示，但长命令文本横向溢出，需要横向滚动；这暂不作为核心 bug，只记录为可用但观感一般。
2. Update file 卡显示为：顶部 `Update file / patch-demo.md`，下面又显示 `.tool-render-demo/patch-demo.md NEW`，两层信息显得重复且层级/间距像重叠。
3. Spawn Agent / Wait for Agent / Close Agent 三个工具卡即使完成后仍显示 spinner 和持续时间，例如 288s、285s、278s 或 32s、28s、4s，完成态明显错误。
4. View image 卡只显示 `local-preview.png` 和路径 `/dev/shm/dev-workspace/happy-dev/.tool-render-demo/local-preview.png`，下面又显示 JSON `{ "path": ... }`，但没有 inline 图片。
5. image_gen 工具调用没有在 Happy UI 中出现明显图片预览。
6. 用户确认 subagent 内部工具没有泄漏到主 agent 面板，但主 agent 的 `spawn_agent` / `wait_agent` / `close_agent` 三个控制 command 被分别展示在不同位置，并且状态错误。

---

## Section 5: User's Acceptance Criterion

<!-- WHO WRITES: BA (on first analysis) -->
<!-- WHAT: Verbatim quote from user's requirement or focus string. -->
<!-- This is the single source of truth for what "done" means. Do not paraphrase. -->

### 5.1 本次 /spec 原文需求

> `/spec 将以上全部内容总结为一个超级清单，并且给出我的原文详细反馈以及你对图形渲染和工具调用的反馈`

### 5.2 用户原文详细反馈摘录

以下为用户在本轮工具渲染调查中的关键原文反馈，保留为验收依据：

> `立刻在我面前展示你可以使用的全部tool工具渲染和所有非文本输出形式`

> `怎么回事？不运行了？`

> `你是否可以看到我的截图`

> `你给我展示的前两个tool`

> `然后你运行了`

> `然后你运行了。这就是我看到的全部`

> `总结哪些工具成功渲染哪些失败？此外我们先不说happy的渲染质量`

> `/dev 修复以上渲染问题`

> `好的我们是不是需要重启happy dev？`

> `安全吗？`

> `root@life-ai:~# /root/bin/safe-daemon-restart.sh dev --reason "load happy-cli image preview mapper fix"`
>
> `-bash: /root/bin/safe-daemon-restart.sh: No such file or directory`

> `谁告诉你的/root/bin/safe-daemon-restart.sh？`

> `阅读/root/bin/happy-restart.sh，告诉我是不是被安装到了这里`

> `无所谓，我们继续进行刚刚的测试，还有哪些你的特殊渲染和工具没有给我展示？`

> `我只看到了mcp。其他的完全没有看到任何内容。还有别的吗？`

> `继续展示：`
>
> `真正的图片内联预览`
>
> `image_gen.imagegen`
>
> `mcp__playwright__.browser_take_screenshot`
>
> `functions.view_image`
>
> `这是刚才修复的核心，但要让当前会话的 CLI mapper 生效，通常需要 dev daemon/新会话加载新构建。`
>
> `Patch/diff 渲染`
>
> `apply_patch`
>
> `会产生补丁/文件变更类渲染，但会改工作区，所以不建议为演示随便跑。`
>
> `子代理生命周期渲染`
>
> `spawn_agent`
>
> `wait_agent`
>
> `close_agent`
>
> `会展示 subagent start/stop/report 卡；但只有你明确要并行代理测试时才适合跑。`
>
> `交互式输入/选择卡`
>
> `request_user_input`
>
> `只在 Plan mode 可用；当前不一定能直接触发。`
>
> `Web 类工具卡`
>
> `搜索、打开网页、图片搜索、天气、金融、体育、时间等。`
>
> `这些可能只显示普通工具卡，不一定有专门的 Happy UI。`
>
> `Playwright 交互动作卡`
>
> `click/type/fill/hover/select/drag/tabs/resize/upload/dialog/wait 等。`
>
> `其中 click/type/fill 可以安全演示；upload/dialog 需要特定页面状态。`
>
> `长运行终端/PTY 渲染`
>
> `exec_command + write_stdin`
>
> `你之前只看到了普通 Terminal 输出；还没展示“启动一个会话后继续写入 stdin”的流式交互形态。`
>
> `MCP resource 工具`
>
> `list_mcp_resources`
>
> `read_mcp_resource`
>
> `如果当前没有 MCP resources，可能只会显示空结果。`
>
> `如果你担心污染，就新建一个测试文件夹`

> `我只看到了这些和mcp。subagent显示有大问题，同时view image和update file也有重叠显示的问题`

> `还有个问题就是subagent运行时使用后的工具好像会直接展示在主agent面板。你试试`

> `好的我确认我看不到，但是你的三个subagent的command被分别展示到了不同的地方`

