import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "../lang/helpers";

export class ImportModal extends FuzzySuggestModal<TFile> {
	onChoose: (file: TFile) => void;
	private filterString: string[] = ["MyIOTO", "Templates", "Templater"];

	constructor(
		app: App,
		onChoose: (file: TFile) => void,
		extraFilter?: string[],
	) {
		super(app);
		this.onChoose = onChoose;
		if (extraFilter) {
			this.filterString = [...this.filterString, ...extraFilter];
		}
	}

	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) => f.extension === "md")
			.filter((f) => this.filterString.every((s) => f.path.includes(s)));
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
