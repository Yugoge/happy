<!-- AUTO-GENERATED VIEW for ui-specialist | source: docs/dev/specs/spec-20260506-203844.md | extracted: 2026-05-06T20:47:19Z -->

# ui-specialist view of spec-20260506-203844

**Monolith**: docs/dev/specs/spec-20260506-203844.md
**Extraction**: content-block level (no section-level mapping)

---

#### B. 图片/图形渲染

- [ ] `functions.view_image` 应显示真正 inline 图片。
- [ ] `functions.view_image` 不应只显示文件名和路径。
- [ ] `functions.view_image` 不应在同一卡片下方重复显示原始 JSON `{ "path": ... }`，除非用户展开 details。
- [ ] `mcp__playwright__.browser_take_screenshot` 应在 Happy UI 中显示截图预览，而不只是工具卡或文件 link。
- [ ] `image_gen.imagegen` 应在 Happy UI 中显示生成图片，至少显示缩略图/预览卡。
- [ ] 图片预览应支持 data URI、file path、markdown link、generated image status text 等来源。
- [ ] 旧消息不能 retroactive 修复时，应明确提示需要新会话或 dev daemon reload 后重新触发。
- [ ] 图片卡在 desktop/mobile 都不应撑破布局。
- [ ] 图片卡应区分：文件名、路径、预览、原始工具输出 details。

#### C. Patch / diff / Update file 渲染

- [ ] `apply_patch` 产生的 update file 卡应显示清晰的文件变更摘要。
- [ ] Header 与文件行不能重复/重叠。
- [ ] 新文件应显示 `NEW`，但不要和 header 混成两层重复标题。
- [ ] 支持展开查看 patch/diff 详情。
- [ ] 默认折叠态应简洁：文件名、状态、路径；不要过多重复。
- [ ] 多文件 patch 应显示文件列表，而不是多个互相挤压的 header。

#### D. Subagent 生命周期渲染

- [ ] `spawn_agent`、`wait_agent`、`close_agent` 不应长期显示 spinner。
- [ ] 完成后应显示明确 completed/succeeded 状态。
- [ ] 耗时应停止计时，不应出现完成后仍不断增加的 288s/285s/278s 之类状态。
- [ ] 三个 subagent 控制工具不应分散成误导性的三个普通 running command 卡。
- [ ] 最佳形态：合并为一个 subagent lifecycle 卡，展示 agent nickname/id、started、completed、final summary。
- [ ] 如果仍保留三张卡，也必须各自完成态正确、spinner 停止、位置稳定。
- [ ] subagent 内部工具调用默认不泄漏到主 agent 面板。
- [ ] 如果用户展开 subagent details，才显示子代理内部工具轨迹。
- [ ] 主面板最终应只显示 subagent 生命周期摘要和最终输出，而不是控制工具噪音。

#### E. Terminal / PTY 渲染

- [ ] 普通 `exec_command` Terminal 卡已能显示。
- [ ] PTY `exec_command + write_stdin` 应显示为同一会话/流式输出，而不是让用户误解为普通一次性命令。
- [ ] 长命令应换行或合理横向滚动，避免第一行命令挤出容器。
- [ ] `exit 0` 等状态信息应清晰但不喧宾夺主。

#### F. MCP / Playwright 工具渲染

- [ ] MCP tool cards 当前可见，是目前最稳定的非 Terminal 工具展示。
- [ ] Playwright navigate/snapshot/console/network/evaluate/click/fill/hover/select/upload/dialog/resize/wait/type/press/drag 等卡片已能显示工具行为。
- [ ] Playwright screenshot 应从普通工具卡进一步升级为可见截图预览。
- [ ] Playwright 交互卡应避免显示过长 data URL 或超长 encoded HTML。
- [ ] 对 data URL 页面，应在卡片中折叠输入，默认显示短摘要。

#### G. Web 类工具渲染

- [ ] `web.search_query` 和 `web.open` 被调用后，应确认 Happy 是否显示结果。
- [ ] 如果 Happy 不显示 web 工具卡，应记录为 UI 不支持或 mapper 未接入。
- [ ] web tool 结果应显示 source/title/snippet，而不只出现在 assistant 的后续文本总结里。
- [ ] 时间/天气/金融/体育等专用 web 工具如后续测试，应同样纳入工具矩阵。

#### H. MCP Resource 工具

- [ ] `list_mcp_resources` 返回空时，应显示“无资源”或简洁空状态。
- [ ] `list_mcp_resource_templates` 返回空时，应显示“无模板”或简洁空状态。
- [ ] 不应让空数组结果完全不可见，否则用户无法判断是否运行过。

#### I. 交互式输入工具

- [ ] `request_user_input` 在 Default mode 不可用，应明确显示不可用原因，而不是静默失败。
- [ ] 如在 Plan mode 可用，应测试选项卡是否在 Happy UI 中可点击/可返回。

#### J. 状态/计时/完成态通用要求

- [ ] 所有工具卡必须收到 end/completed 后停止 spinner。
- [ ] 耗时应为最终 duration，而不是持续计时。
- [ ] failed/unavailable 工具应显示失败状态与原因。
- [ ] completed 但无可视 payload 的工具应显示短完成摘要。
- [ ] 输入/输出 details 应默认折叠，避免把 JSON 与预览混在一起。

---

### 5.4 Assistant 对图形渲染的反馈

主 agent 对图形/图片渲染的当前判断：

- 图片生成、截图、本地图片查看这些工具在底层工具系统中可以成功产生图片或图片路径。
- Happy UI 是否显示图片是独立问题：需要 message mapper 产出 app renderer 能识别的 `preview_uri` / attachment payload。
- `view_image` 的当前 UI 表现说明 app 已识别到“这是图片类工具”，但缺少真正 image source 或未将 source 交给 image component。
- `image_gen` 没有显示，可能是：
  - tool 名未映射；
  - 生成路径文本未被 mapper 捕获；
  - dev daemon 未加载新 mapper；
  - app renderer 没有 image_gen 专门映射；
  - tool result 在当前 harness 中没有进入 Happy message envelope。
- Playwright screenshot 在 tool result 中已经可见，但用户侧 Happy 是否 inline 仍需以截图确认，不能只看 tool output。
- 后续修复应以真实 Happy UI 截图为准，而不是以本地工具成功为准。

### 5.5 Assistant 对工具调用/Happy 显示的反馈

主 agent 对工具调用与 Happy 渲染链路的当前判断：

- Terminal 与 MCP 是当前 Happy 中最稳定的工具显示形态。
- 许多 Codex internal tools 在 backend/harness 层确实执行，但 Happy 未必有对应 renderer。
- 工具卡状态 bug 与 payload renderer bug 是两类问题：
  - 状态 bug：spinner、duration、completed/failed 状态；
  - payload bug：图片、JSON、diff、附件预览如何显示。
- Subagent 问题目前不是“子代理内部工具泄漏”，而是主控工具本身被错误地显示成普通 running command。
- `update_plan`、`request_user_input`、MCP resources、web tools 等应决定：要么提供 renderer，要么提供明确 fallback；不应让用户误以为没有运行。
- 所有工具卡都需要统一设计规则：标题、状态、duration、summary、preview、details、raw JSON fallback。
