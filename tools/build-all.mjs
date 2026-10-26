// 一次构建全部产物：JSON 数据 → 离线单文件 HTML → EPUB → PDF
// 用法：node tools/build-all.mjs        （只想跳过 PDF 就加 --no-pdf）
//
// 构建前先跑一致性检查：index.html 里的 parseBook 必须和 tools/lib/book.mjs 结果一致，
// 两边失配会让「网页上看到的」和「电子书里印出来的」不一样，是最难发现的一类错。
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readBook, FILES as LIB_FILES } from "./lib/book.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const skipPdf = args.includes("--no-pdf");

const PY_CANDIDATES = [
  process.env.PYTHON,
  join(process.env.HOME || "", ".workbuddy/binaries/python/envs/default/bin/python"),
  "/usr/bin/python3"
].filter(Boolean);

function findPython(withReportlab){
  for(const p of PY_CANDIDATES){
    if(!existsSync(p)) continue;
    if(!withReportlab) return p;
    const r = spawnSync(p, ["-c", "import reportlab"], { stdio: "ignore" });
    if(r.status === 0) return p;
  }
  return null;
}

function step(label, fn){
  process.stdout.write("→ " + label + " … ");
  const t0 = Date.now();
  try{
    const out = fn();
    console.log("完成 (" + ((Date.now() - t0) / 1000).toFixed(1) + "s)");
    if(out) String(out).trim().split("\n").forEach((l) => console.log("    " + l));
    return true;
  }catch(e){
    console.log("失败");
    console.error("\n" + label + " 出错：\n" + (e.stdout || e.message || e) + "\n");
    process.exitCode = 1;
    return false;
  }
}

/* ---------- 1. 一致性检查 ---------- */
function parityCheck(){
  const html = readFileSync(join(root, "index.html"), "utf8");

  const filesM = html.match(/const FILES = \[([\s\S]*?)\];/);
  if(!filesM) throw new Error("index.html 里找不到 const FILES 数组");
  const pageFiles = [...filesM[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if(pageFiles.length !== LIB_FILES.length || pageFiles.some((f, i) => f !== LIB_FILES[i])){
    throw new Error("index.html 的 FILES 与 tools/lib/book.mjs 的 FILES 不一致\n  网页：" +
      pageFiles.join("、") + "\n  工具：" + LIB_FILES.join("、"));
  }

  const s = html.indexOf("function parseBook");
  const e = html.indexOf("async function load");
  if(s === -1 || e === -1) throw new Error("index.html 里定位不到 parseBook / load 函数");
  const pageParse = new Function(html.slice(s, e) + "; return parseBook;")();

  const lib = readBook(root);
  let pageEntries = [];
  lib.sections.forEach((sec, i) => {
    const text = readFileSync(join(root, "book", sec.file), "utf8");
    pageEntries = pageEntries.concat(pageParse(text, sec.file, i + 1, sec.title));
  });

  const cmp = ["id", "title", "grade", "cost", "plain", "benefit", "path", "source", "note"];
  if(pageEntries.length !== lib.entries.length){
    throw new Error("条目数不一致：网页 " + pageEntries.length + " / 工具 " + lib.entries.length);
  }
  for(let i = 0; i < lib.entries.length; i++){
    for(const k of cmp){
      if(pageEntries[i][k] !== lib.entries[i][k]){
        throw new Error("第 " + lib.entries[i].id + " 条的 " + k + " 解析结果不一致，两侧已失配");
      }
    }
    const a = JSON.stringify(pageEntries[i].tags), b = JSON.stringify(lib.entries[i].tags);
    if(a !== b) throw new Error("第 " + lib.entries[i].id + " 条的成本标签解析不一致：" + a + " vs " + b);
  }
  return "网页解析器与工具解析器一致（" + lib.entries.length + " 条逐字段比对通过）";
}

/* ---------- 2. 各步构建 ---------- */
const NODE = process.execPath;
const runNode = (script) => execFileSync(NODE, [join(root, "tools", script)], { encoding: "utf8", cwd: root });
const runPy = (py, script) => execFileSync(py, [join(root, "tools", script)], { encoding: "utf8", cwd: root });

console.log("\n构建中国教师生活指南\n" + "─".repeat(46));

step("一致性检查", parityCheck);

const dataOut = step("规范化数据 dist/book.json", () => runNode("build-data.mjs"));
if(process.exitCode) process.exit(1);

// 来源清单由正文自动生成：正文里加了新来源，SOURCES.md 要跟着变
step("数据来源清单 SOURCES.md", () => runNode("build-sources.mjs"));
step("离线单文件 HTML", () => runNode("build-offline.mjs"));
step("EPUB 电子书", () => runNode("build-epub.mjs"));

if(skipPdf){
  console.log("→ PDF … 已按 --no-pdf 跳过");
} else {
  const py = findPython(true);
  if(!py){
    console.log("→ PDF … 跳过（没找到装了 reportlab 的 Python）");
    console.log("    安装方法：" + PY_CANDIDATES[1].replace(/bin\/python$/, "bin/pip") + " install reportlab");
  } else {
    step("PDF（A4 · 带页码目录与书签）", () => runPy(py, "build-pdf.py"));
  }
}

/* ---------- 3. 产物清单 ---------- */
const dist = join(root, "dist");
console.log("─".repeat(46));
const want = [
  ["book.json", "规范化数据（构建中间产物）"],
  ["中国教师生活指南-离线版.html", "离线单文件，双击即用、微信可传"],
  ["中国教师生活指南.epub", "EPUB 3 电子书，可发到 Kindle"],
  ["中国教师生活指南.pdf", "A4 排版，带页码目录与书签"]
];
mkdirSync(dist, { recursive: true });
let total = 0;
want.forEach(([f, desc]) => {
  const p = join(dist, f);
  if(!existsSync(p)) return;
  const kb = statSync(p).size / 1024;
  total += kb;
  console.log("  " + (kb > 1024 ? (kb / 1024).toFixed(2) + " MB" : kb.toFixed(0) + " KB").padStart(9) +
    "  " + f + "  —  " + desc);
});
const extras = readdirSync(dist).filter((f) => !want.some(([w]) => w === f));
if(extras.length) console.log("  其他：" + extras.join("、"));
console.log("  合计 " + (total / 1024).toFixed(2) + " MB");
console.log("\n在线版就是项目根目录的 index.html，直接部署即可。\n");
