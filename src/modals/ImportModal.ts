import { App, FuzzySuggestModal, TFile } from "obsidian";

export class ImportModal extends FuzzySuggestModal<TFile> {
    onChoose: (file: TFile) => void;

    constructor(app: App, onChoose: (file: TFile) => void) {
        super(app);
        this.onChoose = onChoose;
    }

    getItems(): TFile[] {
        return this.app.vault.getFiles().filter(f => f.extension === "md");
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
        this.onChoose(file);
    }
}
