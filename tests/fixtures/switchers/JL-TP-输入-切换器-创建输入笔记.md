<%*
/*
** type: switcher
** for: input
*/


const ml = new (tp.user.IOTOMultiLangs(tp))(tp);
const utilClass = tp.user.IOTOUtility(tp, app);
const util = new utilClass(tp, app);
const folder = tp.file.folder(true);
const activeFileFrontmatter = app.metadataCache.getFileCache(tp.config.active_file)?.frontmatter;
const projectName = activeFileFrontmatter?.Project;
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
		"match": `${ml.t("OriginalSource")}`,
		"template": `TP-${ml.t("Input")}-${ml.t("OriginalSource")}`
	},
	{
		"match": `${ml.t("Clips")}`,
		"template": `TP-${ml.t("Input")}-${ml.t("Clips")}`
	},
	{
		"match": `AI生成`,
		"template": `JL-TP-输入-AI生成`
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
	usedTemplate = await tp.user.IOTOLoadTemplate.load(tp, app, ml.t("IOTODefaultInputNoteTemplate"));
}

const includedNote = usedTemplate.content;
const templateLink = tp.user.IOTOLoadTemplate.linkValue(app, usedTemplate.file);
if (templateLink) frontMatter.iotoTemplate = templateLink;

tR += util.noteFrontMatterCooker(util.addIOOLinkPropertyToFrontMatter(frontMatter, tp.config.active_file), includedNote);


_%>