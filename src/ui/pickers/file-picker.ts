import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "../../lang/helpers";

export interface FilePickerOptions {
	/** 任一命中即可：`path === root` 或 `path` 以 `root/` 开头。 */
	roots?: string[];
	/** 必须全部命中：沿用 `path.includes`。 */
	includes?: string[];
}

export class FilePickerModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;
	private roots: string[];
	private includes: string[];

	/**
	 * 第三个参数兼容旧的「全部命中」字符串数组写法（settings.ts 仍这样调用）；
	 * 新代码请传 `{ roots, includes }`——模板目录已按前缀分流，单一 `MyIOTO`
	 * 包含式会让 `<前缀>IOTO` 下的文件彻底看不见。
	 */
	constructor(
		app: App,
		onChoose: (file: TFile) => void,
		filter?: FilePickerOptions | string[],
	) {
		super(app);
		this.onChoose = onChoose;
		const options: FilePickerOptions = Array.isArray(filter)
			? { includes: filter }
			: filter || {};
		this.roots = (options.roots || [])
			.map((root) => root.replace(/\/+$/, ""))
			.filter((root) => root !== "");
		this.includes = options.includes || [];
	}

	getItems(): TFile[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFile => file instanceof TFile)
			.filter((file) => this.inAnyRoot(file.path))
			.filter((file) =>
				this.includes.every((str) => file.path.includes(str)),
			);
	}

	private inAnyRoot(path: string): boolean {
		if (!this.roots.length) return true;
		return this.roots.some(
			(root) => path === root || path.startsWith(`${root}/`),
		);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}

	onNoSuggestion() {
		this.resultContainerEl.empty();
		this.resultContainerEl.createDiv({
			cls: "suggestion-empty",
			text: t("PICKER_NO_FILES_FOUND"),
		});
	}
}
