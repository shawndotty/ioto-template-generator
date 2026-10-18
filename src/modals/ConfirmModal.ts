import { App, Modal, Setting } from "obsidian";
import { t } from "../lang/helpers";

/**
 * 通用二分确认（Plan-20261018-105535 §4.5）。
 *
 * 关键约定：点 X / Esc / 点遮罩一律 resolve(false)——`onClose` 是唯一的收口，
 * 所以「关掉弹窗」永远不会被当成同意。
 */
export class ConfirmModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private title: string,
		private message: string,
		private onResolve: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(this.title);
		this.contentEl.createEl("p", { text: this.message });

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(t("MAP_EDIT_DIRTY_CANCEL"))
					.onClick(() => this.finish(false)),
			)
			.addButton((btn) =>
				btn
					.setButtonText(t("MAP_EDIT_DIRTY_CONFIRM"))
					.setWarning()
					.onClick(() => this.finish(true)),
			);
	}

	onClose() {
		this.contentEl.empty();
		this.finish(false);
	}

	private finish(ok: boolean) {
		if (this.settled) return;
		this.settled = true;
		this.onResolve(ok);
		this.close();
	}
}
