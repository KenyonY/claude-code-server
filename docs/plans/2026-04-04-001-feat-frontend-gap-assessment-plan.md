---
title: "feat: Frontend Feature Gap Assessment & Improvement Roadmap"
type: feat
status: active
date: 2026-04-04
---

# Frontend Feature Gap Assessment & Improvement Roadmap

## Overview

对 claude-code-server 前端进行功能完整性评估，识别关键缺失功能并给出优先级排序的改进方案。

## 现状总结

项目有两套前端入口：

| 入口 | 位置 | 用途 | 关键能力 |
|------|------|------|----------|
| **Bundled Frontend** | `frontend/src/main.tsx` | `pip install` 后随 server 提供 | 登录页, 基础 Chat, 无 Sidebar |
| **Example App** | `app/src/App.tsx` | npm 库使用示例 | Sidebar, 主题切换, 响应式, 无登录 |

核心问题：**两套前端各缺一半功能，没有一个完整的产品级体验。**

## Gap 分析（按优先级排序）

### P0 — 影响基本可用性

#### Gap 1: Bundled Frontend 功能严重不足

**现状：** `main.tsx` (随 pip install 分发) 仅有登录页 + 基础 Chat，缺少：
- Sidebar / 多会话管理
- 主题切换 (light/dark/system)
- 响应式布局 (mobile 支持)
- 快捷键提示

**影响：** 用户 `pip install claude-code-server` 后看到的是一个功能残缺的界面，完整体验需要自行用 npm 库搭建。

**建议：** 将 `app/src/App.tsx` 的功能（Sidebar + 主题 + 响应式）合并进 `main.tsx`，使 bundled frontend 成为开箱即用的完整产品。

**Files:**
- Modify: `frontend/src/main.tsx`
- Reference: `app/src/App.tsx`

---

#### Gap 2: Token 过期无处理 — 401 错误静默吞没

**现状：** 
- Token 合法性仅在页面加载时检查一次 (`main.tsx:16-22`)
- 服务端 token 存储在内存 set 中 (`router.py:46`)，服务重启后所有 token 失效
- SSE 请求返回 401 时，前端显示 `"Request failed: Unauthorized"`，无引导用户重新登录

**影响：** 服务端重启或 token 失效后，用户看到模糊的错误提示，不知道需要重新登录。

**建议：** 
- 在 `useChat` 中检测 401 响应，触发登出回调
- Chat 组件增加 `onAuthError?: () => void` 回调
- main.tsx 收到回调后清除 token 并显示登录页

**Files:**
- Modify: `frontend/src/hooks/useChat.ts` (401 检测)
- Modify: `frontend/src/components/Chat.tsx` (新增 onAuthError prop)
- Modify: `frontend/src/main.tsx` (处理回调)

---

#### Gap 3: SSE 中断无恢复 — 消息停在流式状态

**现状：**
- 网络断开或 SSE 连接超时后，最后一条消息停在 `isStreaming: true` 状态
- 无自动重试机制
- 无 "重试" 按钮
- 用户必须手动重新输入消息

**影响：** 长时间运行的 agent 任务（常见）中网络波动会导致结果丢失，用户无从恢复。

**建议：**
- 发送失败时，在最后一条 user 消息旁显示 "Retry" 按钮
- 流式中断时，清除 `isStreaming` 状态并显示 "Connection lost, click to retry"
- 利用已有的 `session_id` + `resume` 机制实现重试（后端已支持 `--resume`）

**Files:**
- Modify: `frontend/src/hooks/useChat.ts` (错误恢复逻辑)
- Modify: `frontend/src/components/ChatMessages.tsx` (重试 UI)

---

### P1 — 影响日常使用体验

#### Gap 4: 消息持久化脆弱 — 关标签页丢全部历史

**现状：**
- 消息存储在 `sessionStorage`（关闭标签页即丢失）
- `sessionStorage` 有 ~5MB 限制，长对话易超出
- 存储超额时仅有 `console.warn`，无用户提示
- `session_id` 保存在 `localStorage`（持久），但消息历史在 `sessionStorage`（非持久）

**影响：** 
- 关闭标签页后重新打开，Sidebar 显示会话列表但消息为空
- Claude 仍记得上下文（session_id 有效），但用户看不到历史 —— UX 很混乱

**建议：**
- 方案 A（推荐）：将消息存储从 `sessionStorage` 改为 `localStorage` 或 IndexedDB
- 方案 B：后端增加 `/api/sessions/:id/history` 端点，从 claude CLI session 恢复历史
- 至少应该：当 sessionStorage 消息为空但 session_id 存在时，在 UI 上提示 "Session context preserved, but chat history was cleared"

**Files:**
- Modify: `frontend/src/store/chat.ts` (存储策略)
- 可选新增: `frontend/src/utils/storage.ts` (IndexedDB 封装)

---

#### Gap 5: 费用追踪仅显示单轮 — 无会话累计

**现状：**
- `CostBadge` 仅显示最后一轮的 cost/tokens/duration
- `setCostInfo` 每次覆盖而非累加 (`store/chat.ts:247`)
- 无会话总费用、总 token 消耗统计

**影响：** 用户无法了解一个会话的总花费和 token 消耗，不利于成本控制。

**建议：**
- 在 store 中增加 `totalCost`、`totalInputTokens`、`totalOutputTokens` 累计字段
- CostBadge 显示当轮 + 累计两组数据
- 可选：在 Sidebar 的会话列表中显示每个会话的总费用

**Files:**
- Modify: `frontend/src/store/chat.ts` (累计逻辑)
- Modify: `frontend/src/components/ChatMessages.tsx` (CostBadge 扩展)

---

#### Gap 6: 无消息重发/编辑能力

**现状：**
- 发送的消息不可编辑
- 失败的消息无法重发
- 无 "编辑并重发" 功能（ChatGPT/Claude.ai 已有此功能）

**影响：** 发送有误或失败时，用户只能重新打字。对于包含大段代码或复杂问题的消息尤为不便。

**建议：**
- 在 user 消息的 hover actions 中增加 "Edit" 和 "Resend" 按钮
- Edit：将消息内容填回输入框，允许修改后发送（作为新消息或替换）
- Resend：原样重发最后一条 user 消息

**Files:**
- Modify: `frontend/src/components/ChatMessages.tsx` (user 消息 hover actions)
- Modify: `frontend/src/hooks/useChat.ts` (resend 逻辑)
- Modify: `frontend/src/components/ChatInput.tsx` (接收 prefill 内容)

---

### P2 — 影响产品完整度

#### Gap 7: 无前端测试

**现状：** 零测试覆盖，无 vitest/jest 配置，无 E2E 测试框架。作为发布的 npm 库，这个风险较高。

**建议：**
- 配置 vitest + @testing-library/react
- 优先覆盖：SSE 解析 (`parseSSEEvent`)、store 逻辑 (conversation CRUD)、`useChat` 核心流程
- 可选：Playwright E2E 测试

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/__tests__/` (测试文件)
- Modify: `frontend/package.json` (添加 test 依赖和脚本)

---

#### Gap 8: Sidebar 会话管理缺少批量操作

**现状：** 会话只能逐个删除，无批量清理、全部删除、导出等功能。

**建议：**
- 增加 "Clear all conversations" 功能
- 增加按时间范围批量删除
- 可选：全量导出为 JSON

---

#### Gap 9: 无 Accessibility (a11y)

**现状：**
- 无 `aria-*` 属性
- 无语义化 HTML `role`
- 输入框无 `<label>` 关联
- 键盘导航仅限 slash command 菜单

**影响：** 屏幕阅读器用户无法使用，不符合 WCAG 标准。

---

## 推荐实施顺序

```
Phase 1 (P0 — 基本可用):
  1. Gap 1: 统一 Bundled Frontend 功能
  2. Gap 2: 401 Token 过期处理
  3. Gap 3: SSE 中断恢复 + 重试按钮

Phase 2 (P1 — 日常体验):
  4. Gap 4: 消息持久化升级
  5. Gap 5: 费用累计追踪
  6. Gap 6: 消息重发/编辑

Phase 3 (P2 — 产品完整):
  7. Gap 7: 前端测试
  8. Gap 8: Sidebar 批量操作
  9. Gap 9: Accessibility
```

## Sources & References

- Bundled frontend entry: `frontend/src/main.tsx`
- Example app: `app/src/App.tsx`
- Chat component: `frontend/src/components/Chat.tsx`
- SSE streaming hook: `frontend/src/hooks/useChat.ts`
- State store: `frontend/src/store/chat.ts`
- Backend auth: `claude_code_server/router.py:46-61`
- Backend agent: `claude_code_server/agent.py`
