// 生成 SOURCES.md：全书数据来源清单。
// 用小脚本生成而不是手写，是为了让「哪一条引了哪个来源」随正文自动保持准确——
// 手写的来源清单迟早会和正文脱节，而科普指南里这正是最不该出错的地方。
import { writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readBook, FILES, GRADE_LABEL, sourceUrls, domainOf } from "./lib/book.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const book = readBook(root);

const entries = book.entries;

// 来源清单：URL → 引用了它的条目
const byUrl = new Map();
entries.forEach((e) => {
  sourceUrls(e).forEach((u) => {
    if(!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u).push(e.id);
  });
});

// 按域名归类
const byDomain = new Map();
byUrl.forEach((ids, url) => {
  const d = domainOf(url);
  if(!byDomain.has(d)) byDomain.set(d, []);
  byDomain.get(d).push({ url, ids });
});
const domains = [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length);

const gradeCount = { A: 0, B: 0, C: 0, D: 0 };
entries.forEach((e) => { if(gradeCount[e.gkey] !== undefined) gradeCount[e.gkey]++; });

const withUrl = entries.filter((e) => sourceUrls(e).length > 0).length;
const noUrl = entries.filter((e) => sourceUrls(e).length === 0);

// 域名分类，便于读者判断来源性质
const KINDS = [
  [/^(www\.)?(gov\.cn|moe\.gov\.cn|gov\.|.*\.gov\.cn)$/, "政府与部委官网", "政策原文与官方统计"],
  [/^(big5\.)?(moe\.gov\.cn|gov\.cn)$/, "政府与部委官网", "政策原文与官方统计"],
  [/\.(edu\.cn|ac\.cn)$/, "高校与学术机构", "学术研究、元分析、校方公开信息"],
  [/^(doi\.org|.*\.org)$/, "学术与行业组织", "期刊论文、行业标准、专业机构"],
  [/^(news\.|.*\.com\.cn|.*\.cn)$/, "新闻媒体", "报道与访谈（本书记为 B 级）"],
  [/.*/, "其他", "其他公开来源"]
];
function kindOf(domain){
  for(const [re, name] of KINDS) if(re.test(domain)) return name;
  return "其他";
}
const byKind = new Map();
domains.forEach(([d, list]) => {
  const k = kindOf(d);
  if(!byKind.has(k)) byKind.set(k, []);
  byKind.get(k).push([d, list]);
});

const md = `# 数据来源清单（SOURCES）

本书《中国教师生活指南》共 ${book.sections.length} 节 ${entries.length} 条，其中 **${withUrl} 条给出了可点击的来源链接**，
去重后共 **${byUrl.size} 个来源**。其余 ${noUrl.length} 条依据的是法规条文本身（如《中华人民共和国教师法》
《中小学教育惩戒规则（试行）》的条款），**条文本身即出处**，在条目的「来源」栏里标注了法规名称与条号。

证据等级分布：**A ${gradeCount.A} 条 · B ${gradeCount.B} 条 · C ${gradeCount.C} 条 · D ${gradeCount.D} 条**。

> 本文件由 \`node tools/build-sources.mjs\` 从正文自动生成，不是手写的——手写的来源清单迟早会和正文脱节。

## 怎么用这份清单

- **想核对某个数字**：先在正文里找到那一条，看「来源」栏，再回到这里对照。
- **想判断一条靠不靠谱**：看它的证据等级。**A** = 有具体数字且来自随机试验、荟萃分析或官方文件；
  **B** = 有具体数字但来自观察性研究或官方统计；**C** = 有明文规定或公开数据但没有量化效果；
  **D** = 没有直接证据，来自明文规定或公开共识，并在备注里写明为什么只到 D。
- **看到「草案」二字要当心**：标注为草案的（如《教师法（修订草案）（征求意见稿）》）**尚未生效**，
  不能当作现行规定使用。

## 来源按性质分类

| 性质 | 域名数 | 说明 |
|---|---|---|
${[...byKind.entries()].map(([k, list]) => {
  const cnt = list.reduce((a, x) => a + x[1].length, 0);
  const desc = (KINDS.find(([re, name]) => name === k) || [])[2] || "";
  return "| " + k + " | " + list.length + " | " + desc + "（" + cnt + " 个链接） |";
}).join("\n")}

## 完整来源清单

${[...byKind.entries()].map(([k, list]) => {
  return "### " + k + "\n\n" + list
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([d, items]) => items
      .map((x) => "- <" + x.url + ">　<span>用于 " + [...new Set(x.ids)].map((i) => "第 " + i.split("-")[0] + " 节第 " + i.split("-")[1] + " 条").join("、") + "</span>")
      .join("\n"))
    .join("\n");
}).join("\n\n")}

## 没有链接、依据法规条文的条目

以下几条的「来源」是法规原文本身，因此没有外链。读者可直接搜索法规名称核对。

${noUrl.map((e) => "- " + e.id + "　" + e.title + "（" + (GRADE_LABEL[e.gkey] || e.gkey) + "）").join("\n")}

## 免责

本书是科普性的信息整理，**不是法律意见、医疗建议或官方口径**。文中涉及的法律法规、政策数字、比例、
时限均可能随时间和地区变化，**引用前请以官方最新文件为准**。凡标注「草案」的均为未生效文本。
涉及心理危机的内容不能替代专业诊疗——有立即危险时请拨打 120 或 110，心理支持请拨 12356。
`;

const out = join(root, "SOURCES.md");
writeFileSync(out, md, "utf8");
console.log("已生成：" + out);
console.log("  来源 " + byUrl.size + " 个（去重），覆盖 " + withUrl + " / " + entries.length + " 条");
console.log("  域名 " + domains.length + " 个，分 " + byKind.size + " 类；无外链条目 " + noUrl.length + " 条");
