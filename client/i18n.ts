export type UiLanguage = "en" | "zh-CN";
export type UiLanguagePreference = "auto" | UiLanguage;

const chinese: Record<string, string> = {
  "Activity": "活动",
  "Agent": "智能体",
  "Automatic": "自动",
  "Behavior": "交互行为",
  "Branch": "分支",
  "Bytes": "字节数",
  "Canceled": "已取消",
  "CHANGES": "改动",
  "Changes": "改动",
  "Collapse diff": "收起差异",
  "Command": "命令",
  "Content": "内容",
  "Copied": "已复制",
  "Copy": "复制",
  "Could not copy": "复制失败",
  "Could not copy diff": "差异复制失败",
  "Decrease tool grouping threshold": "降低工具分组阈值",
  "Delegated task": "委派任务",
  "Details": "详情",
  "Diff copied": "差异已复制",
  "Done": "已完成",
  "Duration": "耗时",
  "Edit file": "编辑文件",
  "Enabled": "已启用",
  "Error": "错误",
  "Exit code": "退出码",
  "Failed": "失败",
  "Fetch": "获取",
  "File": "文件",
  "Files": "文件数",
  "Find in details": "在详情中查找",
  "Group at": "折叠阈值",
  "Group long tool runs": "折叠连续工具调用",
  "Increase tool grouping threshold": "提高工具分组阈值",
  "Input": "输入",
  "Implementation plan": "实施计划",
  "Interface language": "界面语言",
  "Language": "语言",
  "Limit": "数量限制",
  "Loading settings…": "正在加载设置…",
  "Matches": "匹配数",
  "No matches": "没有匹配项",
  "No output": "没有输出",
  "Offset": "起始位置",
  "Plan": "计划",
  "Prepare worktree": "准备工作树",
  "Preparing tool group…": "正在整理工具调用…",
  "Query": "查询",
  "Raw details": "原始详情",
  "Read file": "读取文件",
  "Reasoning": "思考",
  "Remote resource": "远程资源",
  "Response": "响应",
  "Restore defaults": "恢复默认设置",
  "Result": "结果",
  "Results": "结果",
  "Running": "运行中",
  "Search": "搜索",
  "Search details": "搜索详情",
  "Search workspace": "搜索工作区",
  "Settings need to be reset": "设置需要重置",
  "Settings unavailable": "设置暂不可用",
  "Setup log": "准备日志",
  "Shell command": "Shell 命令",
  "Show full diff": "显示完整差异",
  "Show less": "收起",
  "Stable timeline position": "稳定时间线位置",
  "Status": "状态",
  "Subagent": "子智能体",
  "Task": "任务",
  "Thinking…": "思考中…",
  "Tool": "工具",
  "Tool activity": "工具活动",
  "Tool calls": "工具调用",
  "Tool details": "工具详情",
  "Try again": "重试",
  "URL": "网址",
  "Worktree": "工作树",
  "Working directory": "工作目录",
  "Write file": "写入文件",
};

export function resolveUiLanguage(preference: UiLanguagePreference): UiLanguage {
  if (preference !== "auto") return preference;
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLocaleLowerCase();
    return locale.startsWith("zh") ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

export function tr(language: UiLanguage, english: string) {
  return language === "zh-CN" ? chinese[english] ?? english : english;
}
