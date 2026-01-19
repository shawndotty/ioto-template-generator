import { App, Modal, ButtonComponent } from "obsidian";
import { t } from "../lang/helpers";

interface ArrayItem {
	id: string;
	value: string;
}

export class ArrayEditModal extends Modal {
	private data: any[];
	private items: ArrayItem[];
	private onSave: (result: any[]) => void;
	private title: string;

	constructor(
		app: App,
		title: string,
		data: any[],
		onSave: (result: any[]) => void,
	) {
		super(app);
		this.title = title;
		this.data = Array.isArray(data) ? data : [];
		this.onSave = onSave;
		this.items = this.parseDataToItems(this.data);
	}

	private parseDataToItems(data: any[]): ArrayItem[] {
		return data.map((value) => {
			let displayValue = value;
			if (typeof value !== "string") {
				displayValue = JSON.stringify(value);
			}
			return {
				id: Math.random().toString(36).substr(2, 9),
				value: displayValue,
			};
		});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("array-edit-modal");

		contentEl.createEl("h2", {
			text: t("ARRAY_EDIT_TITLE").replace("${title}", this.title),
		});

		const itemsContainer = contentEl.createDiv({ cls: "array-edit-items" });

		// Render existing items
		this.renderItems(itemsContainer);

		// Footer Actions
		const footer = contentEl.createDiv({ cls: "array-edit-footer" });

		new ButtonComponent(footer)
			.setButtonText(t("ARRAY_EDIT_BTN_ADD_ITEM"))
			.onClick(() => {
				this.items.push({
					id: Math.random().toString(36).substr(2, 9),
					value: "",
				});
				this.renderItems(itemsContainer);
			});

		const actionButtons = footer.createDiv({ cls: "array-edit-actions" });

		new ButtonComponent(actionButtons)
			.setButtonText(t("ARRAY_EDIT_BTN_CANCEL"))
			.onClick(() => this.close());

		new ButtonComponent(actionButtons)
			.setButtonText(t("ARRAY_EDIT_BTN_SAVE"))
			.setCta()
			.onClick(() => this.save());
	}

	private renderItems(container: HTMLElement) {
		container.empty();

		if (this.items.length === 0) {
			container.createDiv({
				cls: "array-edit-empty",
				text: "No items. Click 'Add Item' to start.",
			});
			return;
		}

		this.items.forEach((item, index) => {
			const row = container.createDiv({ cls: "array-edit-row" });

			// Value Input
			const valInput = row.createEl("input", {
				type: "text",
				placeholder: t("ARRAY_EDIT_PLACEHOLDER_VALUE"),
				cls: "array-edit-value",
			});
			valInput.value = item.value;
			valInput.onchange = (e) => {
				item.value = (e.target as HTMLInputElement).value;
			};

			// Delete Button
			const delBtn = new ButtonComponent(row)
				.setIcon("trash")
				.setTooltip(t("ARRAY_EDIT_TOOLTIP_DELETE"));
			delBtn.buttonEl.classList.add("clickable-icon", "danger-icon");
			delBtn.onClick(() => {
				this.items.splice(index, 1);
				this.renderItems(container);
			});
		});
	}

	private save() {
		const result: any[] = [];

		for (const item of this.items) {
			// Allow empty strings if desired, or skip? Assuming we want everything the user typed.
			// But usually empty strings in configuration arrays might be ignored.
			// Let's keep them if they are explicitly added, unless they are completely empty and likely a mistake?
			// User can delete if they don't want it.

			let finalValue: any = item.value;

			// Try to parse JSON for array/object values or numbers/booleans
			const trimmed = item.value.trim();
			if (
				(trimmed.startsWith("[") && trimmed.endsWith("]")) ||
				(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
				trimmed === "true" ||
				trimmed === "false" ||
				(!isNaN(Number(trimmed)) && trimmed !== "")
			) {
				try {
					finalValue = JSON.parse(trimmed);
				} catch (e) {
					// Fallback to string
					finalValue = item.value;
				}
			}

			result.push(finalValue);
		}

		this.onSave(result);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
