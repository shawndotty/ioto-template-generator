import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "../../lang/helpers";

export class FilePickerModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;
	private filterString: string[];

	constructor(
		app: App,
		onChoose: (file: TFile) => void,
		filterString?: string[],
	) {
		super(app);
		this.onChoose = onChoose;
		this.filterString = filterString || [];
	}

	getItems(): TFile[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFile => file instanceof TFile)
			.filter((file) =>
				this.filterString.every((str) => file.path.includes(str)),
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
