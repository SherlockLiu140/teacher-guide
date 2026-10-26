// 把 index.html + book/*.md 打包成一个可双击打开的离线单文件 HTML
// 用法：node tools/build-offline.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bookDir = join(root, "book");
const outDir = join(root, "dist");

const html = readFileSync(join(root, "index.html"), "utf8");

const files = readdirSync(bookDir).filter((f) => f.endsWith(".md")).sort();
const data = {};
for (const f of files) data[f] = readFileSync(join(bookDir, f), "utf8");

const totalEntries = files.reduce(
  (n, f) => n + (data[f].match(/^###\s+\d+\./gm) || []).length,
  0
);

function mustReplace(src, from, to, label) {
  if (src.indexOf(from) === -1) {
    throw new Error(
      "找不到要替换的锚点：" + label + "\n—— index.html 的结构改过了，请同步更新 tools/build-offline.mjs 的锚点。"
    );
  }
  return src.replace(from, to);
}

// 1) 注入内嵌正文：放在主脚本之前，主脚本的 load() 会优先使用它
const inject =
  "<script>\n/* 离线版内嵌正文：" +
  files.length + " 节 " + totalEntries + " 条 */\n" +
  "const EMBEDDED_BOOK = " + JSON.stringify(data) + ";\n</script>\n";

let out = mustReplace(
  html,
  "<script>\nconst FILES",
  inject + "<script>\nconst FILES",
  "主脚本入口"
);

// 2) 标题
out = mustReplace(
  out,
  "<title>中国教师生活指南</title>",
  "<title>中国教师生活指南 · 离线单文件版</title>",
  "页面标题"
);

// 3) 页脚最后一行：换成离线版说明
out = mustReplace(
  out,
  "<b>正文在 <code>book/</code>，改完刷新本页即可。</b>其他格式由 <code>node tools/build-all.mjs</code> 一并生成。",
  "<b>你手上的这一份是离线单文件版（" +
    files.length + " 节 " + totalEntries + " 条），正文已整本内嵌，双击就能开、不用联网、可以直接在微信里传。</b>" +
    "它是快照，不会随正文更新——要拿最新版，回项目目录跑 <code>node tools/build-all.mjs</code> 重新生成。",
  "页脚说明"
);

// 4) 离线版点不动“在别处打开正文”的提示，去掉 file:// 那段的分支文案里的“推荐第1种”
out = mustReplace(
  out,
  "1. 在项目目录下运行 <code>python3 -m http.server 8000</code>，再访问 <code>http://localhost:8000/</code>（推荐）<br>",
  "1. 在项目目录下运行 <code>python3 -m http.server 8000</code>，再访问 <code>http://localhost:8000/</code><br>",
  "错误提示文案"
);

// 5) 离线版是单文件，指向 dist/ 的其他格式下载链接必然失效，换成说明
out = mustReplace(
  out,
  '<a href="./dist/中国教师生活指南.pdf" download>PDF<b>· A4 排版，带目录页码与书签</b></a>\n'
  + '      <a href="./dist/中国教师生活指南.epub" download>EPUB<b>· 电子书，可发到 Kindle</b></a>\n'
  + '      <a href="./dist/中国教师生活指南-离线版.html" download>离线单文件<b>· 双击即用，微信可传</b></a>',
  '<span class="dl-note">PDF（A4，带目录页码与书签）和 EPUB（电子书，可发到 Kindle）在项目 <code>dist/</code> 目录里。'
  + '你手上这个文件本身已经是最全的一份——正文、检索、筛选都在里面。数据来源清单见 <code>SOURCES.md</code>。</span>',
  "其他格式下载区"
);

mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "中国教师生活指南-离线版.html");
writeFileSync(outPath, out, "utf8");

const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(0);
console.log("已生成：" + outPath);
console.log("节数 " + files.length + "，条目 " + totalEntries + "，体积约 " + kb + " KB");
