import { App, FuzzySuggestModal, TFolder } from "obsidian";
import { t } from "../../lang/helpers";

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	private onChoose: (folder: TFolder) => void;
	private filterPath: string[];

	constructor(
		app: App,
		onChoose: (folder: TFolder) => void,
		filterPath?: string[],
	) {
		super(app);
		this.onChoose = onChoose;
		this.filterPath = filterPath || [];
	}

	getItems(): TFolder[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder)
			.filter((folder) =>
				this.filterPath.every((path) => folder.path.includes(path)),
			);
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}

	onNoSuggestion() {
		this.resultContainerEl.empty();
		this.resultContainerEl.createDiv({
			cls: "suggestion-empty",
			text: t("PICKER_NO_FOLDERS_FOUND"),
		});
	}
}
