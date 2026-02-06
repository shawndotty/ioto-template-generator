import {
	App,
	Modal,
	ButtonComponent,
	DropdownComponent,
	ToggleComponent,
	TextComponent,
	setIcon,
} from "obsidian";
import { ArrayEditModal } from "./ArrayEditModal";
import { t } from "../lang/helpers";

interface ObjectItem {
	id: string;
	key: string;
	value: any;
	type: "string" | "number" | "boolean" | "array" | "date" | "datetime";
}

export class ObjectEditModal extends Modal {
	private data: Record<string, any>;
	private items: ObjectItem[];
	private onSave: (result: Record<string, any>) => void;
	private title: string;

	constructor(
		app: App,
		title: string,
		data: Record<string, any>,
		onSave: (result: Record<string, any>) => void,
	) {
		super(app);
		this.title = title;
		this.data = data || {};
		this.onSave = onSave;
		this.items = this.parseDataToItems(this.data);
	}

	private parseDataToItems(data: Record<string, any>): ObjectItem[] {
		return Object.entries(data).map(([key, value]) => {
			let type:
				| "string"
				| "number"
				| "boolean"
				| "array"
				| "date"
				| "datetime" = "string";
			if (Array.isArray(value)) type = "array";
			else if (typeof value === "boolean") type = "boolean";
			else if (typeof value === "number") type = "number";
			else if (value instanceof Date)
				type = "date"; // Default to date if it's a Date object, can't easily distinguish unless we check hours/mins
			else if (typeof value === "string") {
				if (/^\d{4}-\d{2}-\d{2}$/.test(value)) type = "date";
				else if (
					/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?/.test(
						value,
					)
				)
					type = "datetime";
			}

			return {
				id: Math.random().toString(36).substr(2, 9),
				key,
				value,
				type,
			};
		});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("object-edit-modal");

		contentEl.createEl("h2", {
			text: t("OBJECT_EDIT_TITLE").replace("${title}", this.title),
		});

		const itemsContainer = contentEl.createDiv({
			cls: "object-edit-items",
		});

		this.renderItems(itemsContainer);

		// Footer Actions
		const footer = contentEl.createDiv({ cls: "object-edit-footer" });

		new ButtonComponent(footer)
			.setButtonText(t("OBJECT_EDIT_BTN_ADD_ENTRY"))
			.onClick(() => {
				this.items.push({
					id: Math.random().toString(36).substr(2, 9),
					key: "",
					value: "",
					type: "string",
				});
				this.renderItems(itemsContainer);
			});

		const actionButtons = footer.createDiv({ cls: "object-edit-actions" });

		new ButtonComponent(actionButtons)
			.setButtonText(t("OBJECT_EDIT_BTN_CANCEL"))
			.onClick(() => this.close());

		new ButtonComponent(actionButtons)
			.setButtonText(t("OBJECT_EDIT_BTN_SAVE"))
			.setCta()
			.onClick(() => this.save());
	}

	private renderItems(container: HTMLElement) {
		container.empty();

		if (this.items.length === 0) {
			container.createDiv({
				cls: "object-edit-empty",
				text: t("OBJECT_EDIT_EMPTY_STATE"),
			});
			return;
		}

		this.items.forEach((item, index) => {
			const row = container.createDiv({ cls: "object-edit-row" });
			row.style.display = "flex";
			row.style.gap = "10px";
			row.style.marginBottom = "10px";
			row.style.alignItems = "center";

			// Key Input
			const keyInput = new TextComponent(row);
			keyInput.inputEl.addClass("object-edit-key");
			keyInput
				.setPlaceholder(t("OBJECT_EDIT_PLACEHOLDER_KEY"))
				.setValue(item.key)
				.onChange((val) => {
					item.key = val;
				});
			keyInput.inputEl.style.flex = "1";

			// Type Dropdown
			const typeDropdown = new DropdownComponent(row);
			typeDropdown
				.addOptions({
					string: t("OBJECT_EDIT_TYPE_STRING"),
					number: t("OBJECT_EDIT_TYPE_NUMBER"),
					boolean: t("OBJECT_EDIT_TYPE_BOOLEAN"),
					array: t("OBJECT_EDIT_TYPE_ARRAY"),
					date: t("OBJECT_EDIT_TYPE_DATE"),
					datetime: t("OBJECT_EDIT_TYPE_DATETIME"),
				})
				.setValue(item.type)
				.onChange((val) => {
					const newType = val as
						| "string"
						| "number"
						| "boolean"
						| "array"
						| "date"
						| "datetime";
					if (newType !== item.type) {
						item.type = newType;
						// Reset value to default for new type
						if (newType === "array") item.value = [];
						else if (newType === "boolean") item.value = false;
						else if (newType === "number") item.value = 0;
						else if (newType === "date")
							item.value = new Date().toISOString().split("T")[0];
						else if (newType === "datetime")
							item.value = new Date().toISOString().slice(0, 16);
						else item.value = "";

						// Re-render this row or whole list? Re-rendering list is safer/easier
						this.renderItems(container);
					}
				});

			// Value Input (Dynamic based on type)
			const valueContainer = row.createDiv({
				cls: "object-edit-value-container",
			});
			valueContainer.style.flex = "2";
			valueContainer.style.display = "flex";
			valueContainer.style.alignItems = "center";
			valueContainer.style.justifyContent = "flex-end";

			if (item.type === "boolean") {
				const toggle = new ToggleComponent(valueContainer);
				toggle
					.setValue(!!item.value)
					.onChange((val) => (item.value = val));
			} else if (item.type === "array") {
				valueContainer.style.gap = "5px";

				const arrayInput = new TextComponent(valueContainer);
				arrayInput.inputEl.addClass("object-edit-value");
				arrayInput.inputEl.style.flex = "1";
				arrayInput
					.setPlaceholder("[]")
					.setValue(JSON.stringify(item.value))
					.onChange((val) => {
						try {
							const parsed = JSON.parse(val);
							if (Array.isArray(parsed)) {
								item.value = parsed;
							}
						} catch (e) {
							// Ignore invalid JSON while typing
						}
					});

				new ButtonComponent(valueContainer)
					.setIcon("pencil")
					.setTooltip(t("OBJECT_EDIT_TOOLTIP_OPEN_ARRAY_EDITOR"))
					.onClick(() => {
						new ArrayEditModal(
							this.app,
							`Array for ${item.key || "key"}`,
							item.value,
							(newArray) => {
								item.value = newArray;
								arrayInput.setValue(JSON.stringify(newArray));
							},
						).open();
					});
			} else if (item.type === "number") {
				const numInput = new TextComponent(valueContainer);
				numInput.inputEl.type = "number";
				numInput.inputEl.addClass("object-edit-value");
				numInput.inputEl.style.width = "100%";
				numInput
					.setPlaceholder("0")
					.setValue(String(item.value))
					.onChange((val) => {
						item.value = Number(val);
					});
			} else if (item.type === "date") {
				const dateInput = new TextComponent(valueContainer);
				dateInput.inputEl.type = "date";
				dateInput.inputEl.addClass("object-edit-value");
				dateInput.inputEl.style.width = "100%";

				let val = item.value;
				if (val instanceof Date) {
					val = val.toISOString().split("T")[0];
				}
				dateInput.setValue(String(val)).onChange((val) => {
					item.value = val;
				});
			} else if (item.type === "datetime") {
				const dateInput = new TextComponent(valueContainer);
				dateInput.inputEl.type = "datetime-local";
				dateInput.inputEl.addClass("object-edit-value");
				dateInput.inputEl.style.width = "100%";

				let val = item.value;
				if (val instanceof Date) {
					// datetime-local needs YYYY-MM-DDTHH:mm
					val = val.toISOString().slice(0, 16);
				}
				dateInput.setValue(String(val)).onChange((val) => {
					item.value = val;
				});
			} else {
				// String
				const strInput = new TextComponent(valueContainer);
				strInput.inputEl.addClass("object-edit-value");
				strInput.inputEl.style.width = "100%";
				strInput
					.setPlaceholder(t("OBJECT_EDIT_PLACEHOLDER_VALUE"))
					.setValue(String(item.value))
					.onChange((val) => {
						item.value = val;
					});
			}

			// Delete Button
			const delBtn = new ButtonComponent(row)
				.setIcon("trash")
				.setTooltip(t("OBJECT_EDIT_TOOLTIP_DELETE"));
			delBtn.buttonEl.classList.add("clickable-icon", "danger-icon");
			delBtn.onClick(() => {
				this.items.splice(index, 1);
				this.renderItems(container);
			});
		});
	}

	private save() {
		const result: Record<string, any> = {};

		for (const item of this.items) {
			if (!item.key.trim()) continue;
			result[item.key] = item.value;
		}

		this.onSave(result);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
