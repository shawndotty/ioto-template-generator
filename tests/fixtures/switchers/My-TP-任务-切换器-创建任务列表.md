<%*
/*
** type: switcher
** for: task
*/
_%>
<%*

const ml = new (tp.user.IOTOMultiLangs(tp))(tp);
const {LTDListInputSectionHeading, LTDListOutputSectionHeading, LTDListOutcomeSectionHeading, defaultTDLDateFormat, projectNameFormat, defaultTDLHeadingLevel} = app.plugins.plugins["ioto-settings"].settings;

const utilClass = tp.user.IOTOUtility(tp, app);
const util = new utilClass(tp, app);
const folder = tp.file.folder(true);
const pathMode = false; 
const prefix = pathMode ? folder : folder.split("/").last();
const activeFileFrontmatter = app.metadataCache.getFileCache(tp.config.active_file)?.frontmatter;
const projectName = await tp.user.IOTOCreateProjectName(tp.file.folder(true), projectNameFormat);
const subjectName = activeFileFrontmatter?.Subject;
const planName = activeFileFrontmatter?.Plan;

const frontMatter = {
	Project: `["${projectName}"]`,
	cssclasses: '["hideProperties", "iotoTDL"]'
}

const taskMetaStore = app.plugins.plugins["ioto-settings"].__iotoTaskMeta;
const taskMetaKey = tp.file.path(true);
const pendingMeta = (taskMetaStore && taskMetaStore[taskMetaKey]) || null;
if (pendingMeta && pendingMeta.upTask) {
        frontMatter.UpTask = pendingMeta.upTask;
}
if (taskMetaStore) delete taskMetaStore[taskMetaKey];

const switchers = [
    { match: "Demo", template: `My-TP-${ml.t("Task")}-Demo` }
];

const matched = switchers.find(item => prefix.includes(item.match));

const templates = {
  note: "IOTODefaultTaskNoteTemplate",
  subject: "IOTODefaultSubjectNoteTemplate",
  plan: "IOTODefaultPlanNoteTemplate",
  normal: "IOTODefaultNormalNoteTemplate",
};

// 四个模板并行加载；每一项都自带 file，属性不会退化成「最后一次 include 的那个」
const [noteTpl, subjectTpl, planTpl, normalTpl] = await Promise.all(
  Object.values(templates).map(key => tp.user.IOTOLoadTemplate.load(tp, app, ml.t(key)))
);

let usedTemplate = null;
if (matched) {
	const demoTpl = await tp.user.IOTOLoadTemplate.load(tp, app, matched.template);
	usedTemplate = demoTpl.file ? demoTpl : noteTpl;
} else if(tp.file.title.includes(`-${ml.t("Subject")}-`)) {
	frontMatter.Subject = [`"${tp.file.title.split("-").last()}"`];
	usedTemplate = subjectTpl;
} else if(tp.file.title.includes(`-${ml.t("Plan")}-`)) {
	frontMatter.Plan = [`"${tp.file.title.split("-").last()}"`];
	if (subjectName) {
    	frontMatter.Subject = `["${subjectName}"]`;
	}
	usedTemplate = planTpl;
} else if(!tp.file.title.startsWith(`${projectName}-`)) {
    if (subjectName) {
        frontMatter.Subject = `["${subjectName}"]`
    }
    if (planName) {
        frontMatter.Plan = `["${planName}"]`;
    }
	usedTemplate = normalTpl;
} else {
	usedTemplate = noteTpl;
}

const includedNote = usedTemplate.content;
const templateLink = tp.user.IOTOLoadTemplate.linkValue(app, usedTemplate.file);
if (templateLink) frontMatter.iotoTemplate = templateLink;

tR += util.noteFrontMatterCooker(frontMatter, includedNote);
_%>
