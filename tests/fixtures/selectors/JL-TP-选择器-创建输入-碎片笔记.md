<%*
/*
** type: selector
** for: input
*/

const {inputFolder, LTDListInputSectionHeading, LTDListOutputSectionHeading, taskFolder, useUserTemplate, addLinkToCurrentTDL, defaultTDLDateFormat, inputSelectorExcludesPaths, inputSelectorShowOptionOrder, inputSelectorShowBasePath, inputSelectorFolderOptionTemplate, newInputNoteFollowUpAction, inputNoteNamePrefix, inputNoteNamePostfix, inputNoteDefaultExcalidrawTemplate, defaultTDLHeadingLevel, newInputNoteAddedToTDLFollowUpAction, addNewInputNoteToTDL} = app.plugins.plugins["ioto-settings"].settings;

const ml = new (tp.user.IOTOMultiLangs(tp))(tp);

const folderSettings = {
	excludesPaths: [],
	folderPath: "1-输入/碎片笔记",
	optionContentTemplate: `${inputSelectorFolderOptionTemplate}`,
	showBasePathInOption: false,
	showOptionOrder: true,
	showSubFolders: false,
}

const switcherTemplate = await tp.user.IOTOLoadTemplate(tp, tR, this.app, ml.t("IOTODefaultInputSwitcherTemplate"), false);

const noteSettings = {
	addLinkToTDL: true,
	addLinkToTDLFollowUpAction: parseInt(2),
	assignedNoteName: `${tp.file.selection() ? tp.file.selection() : ""}`,
	defaultExcalidrawTemplate: `${inputNoteDefaultExcalidrawTemplate}`,
	defaultNewNoteFollowUpAction: parseInt(1),
	noteNamePostfix: `${inputNoteNamePostfix}`,
	noteNamePrefix: `${inputNoteNamePrefix}`,
	template: "My-TP-输入-碎片笔记",
}


let folderPath = "";

if(folderSettings.showSubFolders) {
	folderPath = await tp.user.IOTOGetFolderOption(tp, folderSettings);
} else {
	folderPath = folderSettings.folderPath;
}

const newNoteLink = await tp.user.IOTOCreateOrOpenNote(tp, tR, folderPath, noteSettings);


if(noteSettings.addLinkToTDL) {
	const addLinkToTDLSettings = {
		taskFolder: taskFolder,
		targetHeading: LTDListInputSectionHeading,
		headingLevel: defaultTDLHeadingLevel,
		tdlDateFormat: defaultTDLDateFormat,
		followUpAction: parseInt(noteSettings.addLinkToTDLFollowUpAction)
	}
	tR += await tp.user.IOTOAddLinkToTDL(tp, newNoteLink, addLinkToTDLSettings);
} else {
	tR += newNoteLink.tR;
}

_%>