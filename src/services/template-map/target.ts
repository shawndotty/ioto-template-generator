/**
 * 地图行 → 生成器规则行的定位（Plan-20261018-105535 §3.2）。
 *
 * 三种降级分支是唯一会静默出错的地方：模板值唯一命中 → 规则序号 → 整块回退。
 * 本文件不依赖 obsidian / DOM，便于 jiti 直接导入做单测。
 */

/** 地图侧构造、生成器侧消费。 */
export interface SwitcherTarget {
	/** 1 起；null = 该行走的是「默认模板」 */
	ruleIndex: number | null;
	/** 规则脚本里的模板原文（反引号内），用于主键匹配 */
	template: string | null;
}

export interface SwitcherRowRef {
	/** 与地图 `#n` 同口径：1 起 */
	index: number;
	template: string;
}

/**
 * 严格按顺序尝试，不许合并：
 * 1. 模板原文恰好命中一行 → 用它（行内注释等写法会让序号偏移，模板值才是硬主键）；
 * 2. 否则退回规则序号；
 * 3. 都不行 → null（调用方整块高亮 + Notice）。
 */
export function pickSwitcherRow(
	rows: SwitcherRowRef[],
	target: SwitcherTarget,
): SwitcherRowRef | null {
	const template = target.template;
	if (template !== null && template !== "") {
		const hits = rows.filter((row) => row.template === template);
		if (hits.length === 1) return hits[0] ?? null;
	}

	if (target.ruleIndex !== null) {
		const byIndex = rows.find((row) => row.index === target.ruleIndex);
		if (byIndex) return byIndex;
	}

	return null;
}
