import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "../lang/helpers";

export interface ImportModalOptions {
	/** 扫描根：任一命中即可。为空时回落到旧的三段包含式。 */
	roots?: string[];
	/** 额外收窄条件，必须全部命中。 */
	includes?: string[];
}

export class ImportModal extends FuzzySuggestModal<TFile> {
	onChoose: (file: TFile) => void;
	private roots: string[];
	private includes: string[];
	/** 没有根时的老行为（兼容未升级的调用方）。 */
	private static readonly LEGACY_INCLUDES = [
		"MyIOTO",
		"Templates",
		"Templater",
	];

	constructor(
		app: App,
		onChoose: (file: TFile) => void,
		options?: ImportModalOptions,
	) {
		super(app);
		this.modalEl.addClass("import-modal");
		this.onChoose = onChoose;
		this.roots = (options?.roots || [])
			.map((root) => root.replace(/\/+$/, ""))
			.filter((root) => root !== "");
		this.includes = options?.includes || [];
	}

	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) => f.extension === "md")
			.filter((f) => this.inAnyRoot(f.path))
			.filter((f) => this.includes.every((s) => f.path.includes(s)));
	}

	private inAnyRoot(path: string): boolean {
		if (!this.roots.length) {
			return ImportModal.LEGACY_INCLUDES.every((s) => path.includes(s));
		}
		return this.roots.some(
			(root) => path === root || path.startsWith(`${root}/`),
		);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
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
