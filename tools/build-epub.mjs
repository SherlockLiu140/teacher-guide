// 生成 EPUB 3 电子书：dist/中国教师生活指南.epub
// 用法：node tools/build-epub.mjs
//
// 结构：封面 / 目录页 / 怎么读 / 10 节正文 / 三个附录清单
// 同时写 nav.xhtml（EPUB3）与 toc.ncx（EPUB2 兼容，Kindle 用），兼容面更宽。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeZip } from "./lib/zip.mjs";
import { inlineMD, esc, GRADE_LABEL, KOUMAP } from "./lib/book.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(root, "dist", "book.json");
if(!existsSync(dataPath)){
  throw new Error("缺少 dist/book.json，请先运行：node tools/build-data.mjs");
}
const B = JSON.parse(readFileSync(dataPath, "utf8"));

const BOOK_ID = "teacher-guide-" + B.buildTime;
const secFile = (sec) => "sec-" + String(sec).padStart(2, "0") + ".xhtml";

// 互链映射：把「第X节第Y条」变成 EPUB 内部可点的锚点
const entryIndex = new Map();
B.sections.forEach((s) => s.entries.forEach((e) => entryIndex.set(e.id, { file: secFile(s.sec), id: "e-" + e.id })));
function anchorFor(sec, no){
  const hit = entryIndex.get(sec + "-" + no);
  return hit ? hit.file + "#" + hit.id : null;
}
const md = (s, selfSec) => inlineMD(s, selfSec, "doc", anchorFor);

/* ---------- 样式 ---------- */
const CSS = `@charset "utf-8";
html{font-family:"Songti SC","Songti TC",serif;}
body{line-height:1.75;margin:0 1em;}
h1,h2,h3{font-family:"Heiti SC","PingFang SC",sans-serif;font-weight:600;line-height:1.45;}
a{color:#2f4bb0;text-decoration:none;}
.cover{text-align:center;padding:22% 0;}
.cover h1{font-size:2.1em;margin:0 0 .5em;}
.cover .sub{font-size:1.05em;color:#555;}
.cover .meta{font-size:.9em;color:#777;margin-top:3em;line-height:2;}
nav[epub|type="toc"] ol{list-style:none;padding-left:1em;}
nav[epub|type="toc"] ol ol{font-size:.92em;}
nav[epub|type="toc"] li{margin:.25em 0;}
.sec-h{border-bottom:2px solid #222;padding-bottom:.4em;margin:1.6em 0 .8em;}
.sec-no{font-size:.82em;color:#888;margin:0;}
.sec-h h1{font-size:1.5em;margin:.1em 0 0;}
.sec-pre{font-size:.93em;color:#666;margin:.6em 0 1.4em;}
.sec-pre p{margin:.35em 0;}
.lens{display:inline;color:#555;}
.ent{margin:0 0 2em;padding-bottom:1em;border-bottom:1px solid #e2e2e2;}
.ent-t{font-size:1.12em;margin:0 0 .35em;}
.ent-t .no{color:#999;font-weight:400;font-size:.85em;margin-right:.5em;}
.tags{margin:0 0 .7em;}
.tg{font-size:.78em;padding:.1em .5em;border:1px solid #999;border-radius:.25em;margin-right:.4em;white-space:nowrap;}
.tgA{border-color:#166a44;color:#166a44;}
.tgB{border-color:#2f4bb0;color:#2f4bb0;}
.tgC{border-color:#8a5320;color:#8a5320;}
.tgD{border-color:#777;color:#666;}
.tgx{font-size:.78em;color:#888;font-family:monospace;}
.plain{margin:0 0 .8em;padding-left:.8em;border-left:3px solid #ccc;font-size:1.02em;}
dl.flds{margin:0;font-size:.95em;}
dl.flds dt{font-weight:600;color:#444;font-size:.85em;margin-top:.6em;}
dl.flds dd{margin:.15em 0 0;color:#333;}
dl.flds dd.src{font-size:.85em;color:#666;word-break:break-all;}
.ref{font-weight:inherit;}
.refext{color:#888;}
.appendix h2{border-top:2px solid #222;padding-top:.5em;margin-top:1.8em;}
.appendix ol{padding-left:1.4em;}
.appendix li{margin:.3em 0;}
.appendix .note{font-size:.92em;color:#666;}
`;

/* ---------- XHTML 片段 ---------- */
function page(title, body, extraClass){
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body${extraClass ? ' class="' + extraClass + '"' : ""}>
${body}
</body>
</html>
`;
}

function coverPage(){
  const s = B.stats;
  return page("封面", `<section class="cover" epub:type="frontmatter">
  <h1>${esc(B.title)}</h1>
  <p class="sub">${esc(B.subtitle)}</p>
  <p class="meta">${s.sections} 节 · ${s.entries} 条<br/>
  A 级 ${s.byGrade.A} · B 级 ${s.byGrade.B} · C 级 ${s.byGrade.C} · D 级 ${s.byGrade.D}<br/>
  生成日期 ${esc(B.buildTime)}</p>
</section>`);
}

function frontPage(){
  return page("怎么读", `<section epub:type="preface">
<h1>怎么读</h1>
<p>写给从小学到大学的教师。每一条都回答两个问题：<strong>这事有多普遍，我能做什么。</strong></p>
<h2>不用全做</h2>
<p>这是一份按性价比排好的备选单，不是任务清单。挑走一两条就算数，剩下的放着，需要时再回来查。本节内的条目按性价比从高到低排列。</p>
<h2>不必通读，按学段和需要挑</h2>
<p>全书 ${B.stats.sections} 节 ${B.stats.entries} 条。其中 ${(B.stats.segments||{})["全学段"]||0} 节对小学到大学都适用，${(B.stats.segments||{})["中小学"]||0} 节专门写给中小学教师，${(B.stats.segments||{})["高校"]||0} 节专门写给高校教师。每节标题下方都标了适用学段——<strong>如果时间有限，先读标着「全学段」的那几节。</strong></p>
<h2>四条互补的读法</h2>
<p><strong>想先保命</strong>——先读第 2、3 节（身体信号、心理与求助）。这两节不花什么钱，也不需要毅力，但不读的代价最大。</p>
<p><strong>想先省时间</strong>——读第 4 节。那里列的每一条都是现行文件里的硬规定，是能直接引用的，不是道理。</p>
<p><strong>想做职业规划</strong>——读第 7 到 10 节。这四节按学段分开，中小学和高校的规则几乎不重叠。</p>
<p><strong>不花钱也不要毅力的</strong>——共 ${B.stats.picks.free} 条，见书末附录一。</p>
<p><strong>只看证据最硬的</strong>——证据等级 A，共 ${B.stats.byGrade.A} 条。A 级的意思是：有具体数字，而且来自随机试验、荟萃分析或官方文件。</p>
<p><strong>只看证据边界</strong>——证据等级 D，共 ${B.stats.picks.edge} 条，见附录三。这些条目没有对照研究支持，每条都在备注里写明了哪一半有出处、哪一半是作者的判断。别把 D 级当成警告，它只是诚实。</p>
<h2>字段说明</h2>
<p>每条包含六栏，一栏都不省。</p>
<dl class="flds">
<dt>成本</dt><dd>按钱、时间、毅力三个维度给。条目标签里的 <span class="tgx">钱=0 时间=少 毅力=否</span> 就是这三项。</dd>
<dt>说人话</dt><dd>把「收益」栏里的研究口径翻成日常说法。只用「收益」栏已有的内容，不添新数字。只想拿主意的话，看这一栏就够。</dd>
<dt>收益</dt><dd>具体数字、研究设计和可信范围。原样保留研究的写法，想自己核对就看这一栏。</dd>
<dt>证据等级</dt><dd><strong>A</strong> 有具体数字，来自随机试验、荟萃分析或官方文件；<strong>B</strong> 有具体数字，但来自观察性研究或官方统计；<strong>C</strong> 有明文规定或公开数据，但没有量化效果；<strong>D</strong> 没有直接证据，来自明文规定或公开共识，并写明为什么只到 D。</dd>
<dt>来源</dt><dd>原始出处，可直接查证。一句话里有两层不同强度的结论时，等级会写成两个。</dd>
<dt>备注</dt><dd>为什么给这个等级、与原文的分歧、以及待核实项。</dd>
</dl>
<h2>数据来源</h2>
<p>全书引用 <strong>${(B.sources||{}).urlCount||0} 个来源链接</strong>，覆盖 ${B.stats.entries} 条中的 ${(B.sources||{}).entriesWithUrl||0} 条；
其余条目依据的是法规条文本身（如《中华人民共和国教师法》《中小学教育惩戒规则（试行）》），条文本身即出处。
每条的「来源」栏都给出了可点击的链接，完整清单见仓库根目录的 SOURCES.md。</p>

<h2>体例来源与许可</h2>
<p>本书改编的只是<strong>体例</strong>：条目模板（成本／说人话／收益／证据等级／来源／备注）与证据等级体系，借鉴自
eternity4719《高性价比人生指南》（<a href="https://github.com/eternity4719/HowToLiveBetter">github.com/eternity4719/HowToLiveBetter</a>）。
<strong>本书正文为独立撰写，与该作品的内容没有引用关系。</strong>本书以「知识共享 署名 4.0 国际（CC BY 4.0）」发布，
完整许可文本见仓库根目录的 LICENSE。</p>
<h2>免责</h2>
<p><strong>免责：</strong>本书是科普性的信息整理，<strong>不是法律意见、医疗建议或官方口径</strong>。
文中涉及的法律法规、政策数字、比例、时限均可能随时间和地区变化，引用前请以官方最新文件为准。
凡标注「草案」的均为未生效文本，不得当作现行规定使用。涉及心理危机的内容不能替代专业诊疗——
有立即危险时请拨打 120 或 110，心理支持请拨 12356。</p>
</section>`);
}

function colophonPage(){
  const s = B.stats;
  return page("关于这本书", `<section epub:type="colophon">
<h1>关于这本书</h1>
<p>《中国教师生活指南》· ${s.sections} 节 ${s.entries} 条 · 生成日期 ${esc(B.buildTime)}</p>
<dl class="flds">
<dt>体例借鉴自</dt><dd>eternity4719《高性价比人生指南》<br/><a href="https://github.com/eternity4719/HowToLiveBetter">github.com/eternity4719/HowToLiveBetter</a><br/>（本书正文独立撰写，无内容引用关系）</dd>
<dt>原作在线阅读</dt><dd><a href="https://eternity4719.github.io/HowToLiveBetter/">eternity4719.github.io/HowToLiveBetter</a></dd>
<dt>许可</dt><dd>知识共享 署名 4.0 国际（CC BY 4.0）<br/><a href="https://creativecommons.org/licenses/by/4.0/">creativecommons.org/licenses/by/4.0/</a></dd>
<dt>数据来源</dt><dd>来源清单见仓库根目录的 SOURCES.md；完整许可文本见 LICENSE。</dd>
<dt>等级分布</dt><dd>A ${s.byGrade.A} · B ${s.byGrade.B} · C ${s.byGrade.C} · D ${s.byGrade.D}</dd>
<dt>免责</dt><dd>决策参考，不构成法律意见、医疗建议或官方口径。政策数字随时间和地区变化，引用前请以官方最新文件为准。</dd>
</dl>
</section>`);
}

function tocPage(){
  const items = B.sections.map((s) => `<li><a href="${secFile(s.sec)}">第 ${s.sec} 节　${esc(s.title)}（${s.count} 条）</a>
<ol>${s.entries.map((e) => `<li><a href="${secFile(s.sec)}#e-${e.id}">${e.sec}-${e.no}　${esc(e.title)}</a></li>`).join("")}</ol>
</li>`).join("\n");
  return page("目录", `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${items}
<li><a href="appendix.xhtml">附录　三份速查清单</a></li>
<li><a href="colophon.xhtml">关于这本书（署名与许可）</a></li>
</ol></nav>`);
}

function sectionPage(s){
  const preHTML = s.pre
    ? `<div class="sec-pre">${s.pre.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const lm = l.match(/^\*\*口径\*\*：\s*(.+)$/);
        return lm ? `<p><span class="lens">口径：</span>${md(lm[1], s.sec)}</p>` : `<p>${md(l, s.sec)}</p>`;
      }).join("")}</div>`
    : "";

  const entries = s.entries.map((e) => {
    const rows = [];
    const row = (k, v, cls) => { if(v) rows.push(`<dt>${k}</dt><dd${cls ? ' class="' + cls + '"' : ""}>${md(v, e.sec)}</dd>`); };
    row("成本", e.cost);
    row("收益", e.benefit);
    row("路径", e.path);
    row("备注", e.note);
    row("来源", e.source, "src");
    return `<article class="ent" id="e-${e.id}" epub:type="subsection">
<h2 class="ent-t"><span class="no">${e.sec}-${e.no}</span>${esc(e.title)}</h2>
<p class="tags"><span class="tg tg${e.gkey}">${esc(e.gradeLabel)}</span><span class="tgx">${esc(e.tagList.join(" "))}</span></p>
<p class="plain">${md(e.plain, e.sec)}</p>
<dl class="flds">${rows.join("")}</dl>
</article>`;
  }).join("\n");

  return page("第 " + s.sec + " 节 " + s.title, `<section class="sec" id="s-${s.sec}" epub:type="chapter">
<div class="sec-h"><p class="sec-no">第 ${s.sec} 节</p><h1>${esc(s.title)}</h1></div>
${preHTML}
${entries}
</section>`);
}

function appendixPage(){
  const find = (id) => {
    for(const s of B.sections) for(const e of s.entries) if(e.id === id) return { s, e };
    return null;
  };
  const list = (ids) => `<ol>${ids.map((id) => {
    const hit = find(id);
    if(!hit) return "";
    return `<li><a href="${secFile(hit.s.sec)}#e-${hit.e.id}">${esc(hit.e.title)}</a>　<span class="tgx">${esc(hit.e.gradeLabel)}</span></li>`;
  }).join("")}</ol>`;

  return page("附录", `<section class="appendix">
<h1>附录　三份速查清单</h1>
<h2>附录一　不花钱、也不要毅力的 ${B.stats.picks.free} 条</h2>
<p class="note">这一组是成本最低的一批：不需要额外花钱，也不需要靠毅力撑。如果现在状态不好，从这里面挑一条开始。</p>
${list(B.picks.free)}
<h2>附录二　法律与权益：有条文可引用的 ${B.stats.picks.law} 条</h2>
<p class="note">这一组不看性价比，看依据。每一条背后都是可以逐字引用的法规或文件，在和学校、家长出现分歧时最用得上。</p>
${list(B.picks.law)}
<h2>附录三　证据边界：没有直接证据的 ${B.stats.picks.edge} 条</h2>
<p class="note">这 ${B.stats.picks.edge} 条没有随机试验或大型研究支持，来源是明文规定或公开共识。它们的价值在于提醒你别漏掉某个变量，不是给你结论。每条的备注里都写明了哪一半有出处、哪一半是作者的判断。</p>
${list(B.picks.edge)}
</section>`);
}

/* ---------- OPF / NCX ---------- */
const manifestItems = [];
const spineItems = [];
function add(id, href, media, extra){
  manifestItems.push(`<item id="${id}" href="${href}" media-type="${media}"${extra || ""}/>`);
}
function spine(id, linear){
  spineItems.push(`<itemref idref="${id}"${linear === false ? ' linear="no"' : ""}/>`);
}

add("nav", "text/nav.xhtml", "application/xhtml+xml", ' properties="nav"');
add("ncx", "toc.ncx", "application/x-dtbncx+xml");
add("css", "style.css", "text/css");
add("cover", "text/cover.xhtml", "application/xhtml+xml");
add("front", "text/front.xhtml", "application/xhtml+xml");
add("appendix", "text/appendix.xhtml", "application/xhtml+xml");
add("colophon", "text/colophon.xhtml", "application/xhtml+xml");
B.sections.forEach((s) => add("sec" + s.sec, "text/" + secFile(s.sec), "application/xhtml+xml"));

spine("cover");
spine("nav");
spine("front");
B.sections.forEach((s) => spine("sec" + s.sec));
spine("appendix");
spine("colophon");

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${BOOK_ID}</dc:identifier>
<dc:title>${esc(B.title)}</dc:title>
<dc:language>zh-CN</dc:language>
<dc:description>${esc(B.subtitle)}。${B.stats.entries} 条，每条写明成本、收益、证据等级与原始出处。</dc:description>
<dc:date>${B.buildTime}</dc:date>
<meta property="dcterms:modified">${B.buildTime}T00:00:00Z</meta>
</metadata>
<manifest>
${manifestItems.join("\n")}
</manifest>
<spine toc="ncx">
${spineItems.join("\n")}
</spine>
</package>
`;

const navPoints = B.sections.map((s, i) => `<navPoint id="np${s.sec}" playOrder="${i + 1}">
<navLabel><text>第 ${s.sec} 节 ${esc(s.title)}</text></navLabel>
<content src="text/${secFile(s.sec)}"/>
${s.entries.map((e, j) => `<navPoint id="np${e.id}" playOrder="${i + 1}.${j + 1}">
<navLabel><text>${e.sec}-${e.no} ${esc(e.title)}</text></navLabel>
<content src="text/${secFile(s.sec)}#e-${e.id}"/>
</navPoint>`).join("\n")}
</navPoint>`).join("\n");

const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh-CN">
<head>
<meta name="dtb:uid" content="${BOOK_ID}"/>
<meta name="dtb:depth" content="2"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${esc(B.title)}</text></docTitle>
<navMap>
<navPoint id="npfront" playOrder="0"><navLabel><text>怎么读</text></navLabel><content src="text/front.xhtml"/></navPoint>
${navPoints}
<navPoint id="npapp" playOrder="99"><navLabel><text>附录　三份速查清单</text></navLabel><content src="text/appendix.xhtml"/></navPoint>
<navPoint id="npcol" playOrder="100"><navLabel><text>关于这本书</text></navLabel><content src="text/colophon.xhtml"/></navPoint>
</navMap>
</ncx>
`;

const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

/* ---------- 打包 ---------- */
const files = [
  { name: "mimetype", data: "application/epub+zip", store: true }, // 必须第一条且不压缩
  { name: "META-INF/container.xml", data: container },
  { name: "OEBPS/content.opf", data: opf },
  { name: "OEBPS/toc.ncx", data: ncx },
  { name: "OEBPS/style.css", data: CSS },
  { name: "OEBPS/text/nav.xhtml", data: tocPage() },
  { name: "OEBPS/text/cover.xhtml", data: coverPage() },
  { name: "OEBPS/text/front.xhtml", data: frontPage() },
  { name: "OEBPS/text/appendix.xhtml", data: appendixPage() },
  { name: "OEBPS/text/colophon.xhtml", data: colophonPage() }
];
B.sections.forEach((s) => files.push({ name: "OEBPS/text/" + secFile(s.sec), data: sectionPage(s) }));

mkdirSync(join(root, "dist"), { recursive: true });
const outPath = join(root, "dist", "中国教师生活指南.epub");
const buf = makeZip(files);
writeFileSync(outPath, buf);

const kb = (buf.length / 1024).toFixed(0);
console.log("已生成：" + outPath);
console.log("  " + files.length + " 个文件，体积约 " + kb + " KB");
console.log("  " + B.sections.length + " 节 " + B.stats.entries + " 条 · 目录页 + 3 个附录 · nav.xhtml + toc.ncx");
