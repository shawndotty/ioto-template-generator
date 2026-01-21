export class TabbedSettings {
	private tabs: HTMLElement;
	private content: HTMLElement;

	constructor(private container: HTMLElement) {
		this.tabs = container.createDiv("settings-tabs");
		this.content = container.createDiv("settings-content");
	}

	addTab(name: string, callback: (content: HTMLElement) => void) {
		const tab = this.tabs.createDiv("settings-tab");
		tab.setText(name);
		tab.onclick = () => {
			this.tabs
				.querySelectorAll(".settings-tab")
				.forEach((t) => t.removeClass("active"));
			this.content.empty();

			tab.addClass("active");

			callback(this.content);
		};

		if (this.tabs.children.length === 1) {
			tab.click();
		}
	}

	activateTab(index: number) {
		const tabs = Array.from(this.tabs.children) as HTMLElement[];
		if (index < 0 || index >= tabs.length) return;
		const tab = tabs[index];
		if (!tab) return;
		tab.click();
	}
}
