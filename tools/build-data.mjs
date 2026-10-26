// 把 book/ 里的正文规范化成 dist/book.json，供 EPUB 与 PDF 生成器共用。
// 目的：解析逻辑只写一遍（tools/lib/book.mjs），两个渲染器吃同一份数据，
// 保证电子书和纸质版的条目、顺序、字段完全一致。
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readBook, FILES, GRADE_LABEL, DIM_LABEL, KOUMAP, SEGMENT, sourceUrls, domainOf } from "./lib/book.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });

const book = readBook(root);
if(book.missing.length){
  throw new Error("book/ 里缺少这些文件：" + book.missing.join("、"));
}
if(book.extra.length){
  console.warn("提示：book/ 里有未登记进 FILES 的文件，会被忽略：" + book.extra.join("、"));
}

const sections = book.sections.map((s) => ({
  sec: s.sec,
  file: s.file,
  title: s.title,
  pre: s.pre,
  count: s.entries.length,
  entries: s.entries.map((e) => ({
    id: e.id,
    no: e.no,
    sec: e.sec,
    secTitle: e.secTitle,
    title: e.title,
    grade: e.grade,
    gkey: e.gkey,
    cost: e.cost,
    plain: e.plain,
    benefit: e.benefit,
    path: e.path,
    source: e.source,
    note: e.note,
    tags: e.tags,
    // 预先把展示用的派生字段算好，避免每个渲染器各算一遍
    gradeLabel: GRADE_LABEL[e.gkey] || e.grade,
    tagList: ["钱", "时间", "毅力", "收益"]
      .filter((k) => e.tags[k] !== undefined)
      .map((k) => k + "=" + e.tags[k]),
    dims: Object.keys(DIM_LABEL)
      .filter((k) => e.tags[k] !== undefined)
      .map((k) => DIM_LABEL[k][e.tags[k]] || (k + "=" + e.tags[k])),
    kou: e.tags["口径"] ? KOUMAP[e.tags["口径"]] || e.tags["口径"] : "",
    kouRaw: e.tags["口径"] || ""
  }))
}));

const entries = sections.flatMap((s) => s.entries);
const byGrade = { A: 0, B: 0, C: 0, D: 0 };
entries.forEach((e) => { if(byGrade[e.gkey] !== undefined) byGrade[e.gkey]++; });

// 来源统计：署名要用的数字，从正文自动算出来，不手写
const urls = entries.flatMap((e) => sourceUrls(e));
const domains = {};
urls.forEach((u) => { const d = domainOf(u); domains[d] = (domains[d] || 0) + 1; });
const withSource = entries.filter((e) => sourceUrls(e).length > 0).length;

// 各清单与前端四个快捷入口一一对应：
//   free = 不花钱、也不要毅力（成本最低的一批）
//   edge = 证据边界（D 级，没有直接证据）
//   law  = 法律与权益（有条文可引用的那批）
//   psy  = 心理与情绪
// 学段专章数用于 PDF 附录与页面统计栏。
const picks = {
  free: entries.filter((e) => e.tags["钱"] === "0" && e.tags["毅力"] === "否").map((e) => e.id),
  edge: entries.filter((e) => e.gkey === "D").map((e) => e.id),
  law: entries.filter((e) => e.kouRaw === "法律").map((e) => e.id),
  psy: entries.filter((e) => e.kouRaw === "心理").map((e) => e.id)
};
const segCounts = {};
sections.forEach((s) => { const g = SEGMENT[s.sec] || "全学段"; segCounts[g] = (segCounts[g] || 0) + 1; });

const payload = {
  title: "中国教师生活指南",
  subtitle: "从小学到大学，教师的处境、应对与出路",
  buildTime: new Date().toISOString().slice(0, 10),
  sources: {
    urlCount: new Set(urls).size,
    totalCitations: urls.length,
    entriesWithUrl: withSource,
    domains
  },
  stats: {
    entries: entries.length,
    sections: sections.length,
    byGrade,
    picks: { free: picks.free.length, edge: picks.edge.length, law: picks.law.length, psy: picks.psy.length },
    segments: segCounts
  },
  picks,
  sections
};

const outPath = join(outDir, "book.json");
writeFileSync(outPath, JSON.stringify(payload, null, 1), "utf8");

// 一致性自检：各节条数之和必须等于总条目数
const sum = sections.reduce((a, s) => a + s.count, 0);
if(sum !== entries.length) throw new Error("节内条数之和 " + sum + " 与总条目数 " + entries.length + " 不一致");
const sumGrade = byGrade.A + byGrade.B + byGrade.C + byGrade.D;
if(sumGrade !== entries.length) throw new Error("等级分布之和 " + sumGrade + " 与总条目数 " + entries.length + " 不一致");

console.log("已生成：" + outPath);
console.log("  " + sections.length + " 节 " + entries.length + " 条 · A " + byGrade.A + " B " + byGrade.B + " C " + byGrade.C + " D " + byGrade.D);
console.log("  清单：不花钱不要毅力 " + picks.free.length + " · 法律与权益 " + picks.law.length + " · 心理与情绪 " + picks.psy.length + " · 证据边界 " + picks.edge.length);
console.log("  学段专章：" + Object.entries(segCounts).map(([k, v]) => k + " " + v + " 节").join(" · "));
console.log("  来源链接 " + new Set(urls).size + " 个（去重后），覆盖 " + withSource + " 条 / " + entries.length + " 条");
