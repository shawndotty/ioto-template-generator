import { App, Modal } from "obsidian";

export class ImagePreviewModal extends Modal {
	imageUrl: string;

	constructor(app: App, imageUrl: string) {
		super(app);
		this.imageUrl = imageUrl;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("image-preview-modal");
        
        // Remove default padding to allow image to maximize space if needed, 
        // or keep it but ensure image fits. 
        // Usually modals have padding. Let's center the image.
        
		const container = contentEl.createDiv({ cls: "image-preview-container" });
        container.style.display = "flex";
        container.style.justifyContent = "center";
        container.style.alignItems = "center";

		const img = container.createEl("img", {
			attr: {
				src: this.imageUrl,
			},
		});
		img.style.maxWidth = "100%";
		img.style.maxHeight = "85vh"; // Leave some room
		img.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
