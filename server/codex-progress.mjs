const itemLabels = {
  reasoning: { id: "reasoning", label: "分析内容与约束", detail: "Codex 正在理解选题、文风和结构要求" },
  agent_message: { id: "compose", label: "整理生成结果", detail: "Codex 正在把结果整理成可编辑内容" },
  command_execution: { id: "command", label: "运行本地工具", detail: "Codex 正在执行本地任务" },
  file_change: { id: "file", label: "写入临时结果", detail: "Codex 正在更新本次任务的临时文件" },
  mcp_tool_call: { id: "tool", label: "调用已连接工具", detail: "Codex 正在使用本地已连接的能力" },
  web_search: { id: "search", label: "搜索资料", detail: "Codex 正在进行实时资料搜索" },
  plan_update: { id: "plan", label: "调整执行计划", detail: "Codex 正在更新本次任务的处理步骤" },
};

export function progressFromCodexEvent(event, profile = {}) {
  if (!event || typeof event !== "object") return [];
  if (event.type === "thread.started") {
    return [
      { id: "connect", label: "连接 Codex CLI", detail: "本地 Agent 已接收任务", status: "done", category: "connect" },
      { id: "reasoning", label: profile.reasoning || "分析内容与约束", detail: profile.reasoningDetail || "Codex 正在理解本次任务", status: "active", category: "reasoning" },
    ];
  }
  if (event.type === "turn.started") {
    return [{ id: "reasoning", label: profile.reasoning || "分析内容与约束", detail: profile.reasoningDetail || "Codex 正在理解本次任务", status: "active", category: "reasoning" }];
  }
  if (event.type === "item.started" || event.type === "item.completed" || event.type === "item.updated") {
    const item = event.item || {};
    const mapped = itemLabels[item.type];
    if (!mapped) return [];
    const override = item.type === "reasoning"
      ? { label: profile.reasoning || mapped.label, detail: profile.reasoningDetail || mapped.detail }
      : item.type === "agent_message"
        ? { label: profile.compose || mapped.label, detail: profile.composeDetail || mapped.detail }
        : {};
    return [{
      ...mapped,
      ...override,
      id: mapped.id,
      status: event.type === "item.completed" ? "done" : "active",
      category: item.type,
    }];
  }
  if (event.type === "turn.completed") {
    return [{ id: "codex-result", label: profile.complete || "生成内容", detail: "Codex 已返回完整结果", status: "done", category: "complete" }];
  }
  if (event.type === "turn.failed" || event.type === "error") {
    return [{ id: "codex-error", label: "Codex 执行中断", detail: event.error?.message || event.message || "本地 Agent 未能完成任务", status: "error", category: "error" }];
  }
  return [];
}
