// obsidian 依赖只提供 .d.ts（package.json 的 "main" 是空串），没有运行时代码。
// 这里给出单测所需的最小可导入实现，**只替 Obsidian 边界，不模拟 Obsidian 行为**。
//
// 本插件只有 `lang/helpers.ts` 用到 obsidian，且只用到 `moment`，所以桩保持最小。
// 必须放在插件目录内：`moment` 是从这里重导出的，模块解析基准在插件目录时才能命中
// node_modules/moment。

// Obsidian 运行环境始终存在 window 全局；补一个最小实现，让源码里按 lint 规则写的
// window.setTimeout 等在 Node 测试里也能运行。
if (typeof globalThis.window === 'undefined') {
	globalThis.window = globalThis;
}

// 重导出**真实** moment：`lang/helpers.ts` 读 moment.locale() 选词典，
// 用假 moment 会掩盖真实语言变体的行为。
import moment from 'moment';

export { moment };

export class App {}

export class Component {}

export class Plugin {}

export class ItemView {}

export class PluginSettingTab {}

export class Setting {}

export class Notice {}

export class TFile {}

export class WorkspaceLeaf {}

export const Platform = { isMobile: false };

export function setIcon() {}

export function debounce(fn) {
	return fn;
}
