<%*
/*
** type: switcher
** for: custom
*/


const ml = new (tp.user.IOTOMultiLangs(tp))(tp);
const utilClass = tp.user.IOTOUtility(tp, app);
const util = new utilClass(tp, app);
const folder = tp.file.folder(true);
const {projectNameFormat} = app.plugins.plugins["ioto-settings"].settings;
const activeFileFrontmatter = app.metadataCache.getFileCache(tp.config.active_file)?.frontmatter;
const projectName = activeFileFrontmatter?.Project || await tp.user.IOTOCreateProjectName(tp.file.folder(true), projectNameFormat);
const subjectName = activeFileFrontmatter?.Subject;
const planName = activeFileFrontmatter?.Plan;

const pathMode = false; 
const prefix = pathMode ? folder : folder.split("/").last();

const frontMatter = {
	Project: `["${projectName}"]`,
};

if (subjectName) {
	frontMatter.Subject = `["${subjectName}"]`;
}

if (planName) {
	frontMatter.Plan = `["${planName}"]`;
}

const switchers = [
	{
		"match": `人物`,
		"template": `JL-TP-自定义-人物`
	}
];



const matched = switchers.find(item => prefix.includes(item.match));
let usedTemplate = null;

if (matched) {
	usedTemplate = await tp.user.IOTOLoadTemplate.load(tp, app, matched.template);
	if (!usedTemplate.file) {
		new tp.obsidian.Notice(ml.t("TemplateNotExist", { template: matched.template }));
	}
}

if (!usedTemplate || !usedTemplate.file) {
	usedTemplate = await tp.user.IOTOLoadTemplate.load(tp, app, ml.t("IOTODefaultCustomNoteTemplate"));
}

const includedNote = usedTemplate.content;
const templateLink = tp.user.IOTOLoadTemplate.linkValue(app, usedTemplate.file);
if (templateLink) frontMatter.iotoTemplate = templateLink;

tR += util.noteFrontMatterCooker(util.addIOOLinkPropertyToFrontMatter(frontMatter, tp.config.active_file), includedNote);


_%>