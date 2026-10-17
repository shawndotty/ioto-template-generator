<%*
/*
** type: selector
** for: custom
*/

const {inputFolder, outputFolder, taskFolder, outcomeFolder, extraFolder, IOTOFrameworkPath} = app.plugins.plugins["ioto-settings"].settings;

const ml = new (tp.user.IOTOMultiLangs(tp))(tp);

const folderSettings = {
	excludesPaths: [],
	folderPath: "5-其他",
	optionContentTemplate: "在{{folder}}中创建笔记",
	showBasePathInOption: false,
	showOptionOrder: true,
	showSubFolders: true,
}

const switcherTemplate = ""

const noteSettings = {
	addLinkToTDL: false,
	addLinkToTDLFollowUpAction: parseInt(2),
	assignedNoteName: `${tp.file.selection() ? tp.file.selection() : ""}`,
	defaultExcalidrawTemplate: "",
	defaultNewNoteFollowUpAction: parseInt(1),
	noteNamePostfix: "",
	noteNamePrefix: "",
	template: "JL-TP-自定义-切换器-其他",
}


let folderPath = "";

if(folderSettings.showSubFolders) {
	folderPath = await tp.user.IOTOGetFolderOption(tp, folderSettings);
} else {
	folderPath = folderSettings.folderPath;
}

const newNoteLink = await tp.user.IOTOCreateOrOpenNote(tp, tR, folderPath, noteSettings);

tR += newNoteLink.tR;

_%>