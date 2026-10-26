#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 PDF：dist/中国教师生活指南.pdf

用法：python3 tools/build-pdf.py

为什么用 reportlab 而不是 pandoc+typst：本机没有装排版工具链，而 reportlab 能给出
原项目承诺的那几样东西——带页码的目录、PDF 书签（大纲）、每节另起一页、页脚页码。
书签和页码是 Chrome 的 --print-to-pdf 做不到的（Chrome 不支持 CSS target-counter）。

数据来自 dist/book.json（由 tools/build-data.mjs 产出），
所以 PDF 和 EPUB 的条目、顺序、字段完全一致，解析逻辑只有一份。
"""
import json
import os
import re
import sys
import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether, Flowable
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "dist", "book.json")
OUT = os.path.join(ROOT, "dist", "中国教师生活指南.pdf")

# ---------- 字体 ----------
# 跨平台解析：按候选文件探测子字体，再按名字给四个字重打分。
# 这样在 macOS / Linux（含 GitHub Actions）/ Windows 上都能跑出中文 PDF。
FONT_FILES = [
    # macOS
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    # Linux：apt install fonts-noto-cjk / fonts-arphic-uming
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    # Windows
    "C:/Windows/Fonts/simsun.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
]

# 每个字重按这些关键词打分，命中即得分；SC 优先，TC 降权，避免用繁体字形排简体正文
ROLE_RULES = {
    "normal":  [("songti-sc-light", 10), ("songti sc light", 10), ("serif cjk sc", 9), ("noto serif cjk sc", 9),
                ("songti-sc-regular", 8), ("stsong", 8), ("simsun", 8), ("uming", 7),
                ("sans cjk sc", 6), ("pingfang sc", 6), ("heiti", 5), ("wqy", 5),
                ("songti-tc", -4), ("heiti tc", -4), ("dejavu", -6)],
    "bold":    [("songti-sc-bold", 10), ("serif cjk sc bold", 9), ("sans cjk sc bold", 8),
                ("songti-tc-bold", 4), ("bold", 5), ("simhei", 6), ("heiti medium", 5)],
    "regular": [("songti-sc-regular", 10), ("songti sc regular", 10), ("serif cjk sc", 8),
                ("sans cjk sc", 7), ("stsong", 7), ("simsun", 6), ("uming", 6), ("wqy", 5)],
    "black":   [("songti-sc-black", 10), ("songti sc black", 10), ("sans cjk sc black", 8),
                ("songti-sc-bold", 7), ("simhei", 7), ("heavy", 6), ("bold", 4)],
}


def _probe(path):
    """读出一个字体文件里所有可用的 (index, 小写字体名)。非 TTC 只返回 index 0。"""
    out = []
    for i in range(16):
        try:
            f = TTFont("__probe_%d" % i, path, subfontIndex=i)
            name = f.face.name
            if isinstance(name, bytes):
                name = name.decode("utf-8", "replace")
            out.append((i, name.lower()))
            if not path.lower().endswith(".ttc"):
                break
        except Exception:
            break
    return out


def _score(name, rules):
    """首个命中的关键词即定分。不能用累加——否则通用规则（如 bold）会叠加，
    把 Songti-SC-Bold 顶掉 Songti-SC-Black，节标题就用不到最重的那一档。"""
    for kw, pts in rules:
        if kw in name:
            return pts
    return None


def resolve_fonts():
    """为四个字重各挑一个 (path, index)。"""
    available = [(p, _probe(p)) for p in FONT_FILES if os.path.exists(p)]
    available = [(p, pr) for p, pr in available if pr]
    if not available:
        sys.exit("没找到任何可用的中文字体。macOS 自带宋体；Linux 可执行\n"
                 "  apt-get install -y fonts-noto-cjk\n再重试。")

    picks = {}
    for role, rules in ROLE_RULES.items():
        best, best_score = None, None
        for path, probes in available:
            for idx, name in probes:
                score = _score(name, rules)
                if score is None:
                    continue
                if best_score is None or score > best_score:
                    best, best_score = (path, idx, name), score
        if best:
            picks[role] = best
    if "normal" not in picks:
        sys.exit("找不到可用的正文字体（候选里没有一个匹配中文正文的名字规则）。")
    # 缺哪个字重就退回正文字体，保证一定能跑完
    for role in ROLE_RULES:
        picks.setdefault(role, picks["normal"])

    pdfmetrics.registerFont(TTFont("Songti", picks["normal"][0], subfontIndex=picks["normal"][1]))
    pdfmetrics.registerFont(TTFont("Songti-Bold", picks["bold"][0], subfontIndex=picks["bold"][1]))
    pdfmetrics.registerFont(TTFont("Songti-Reg", picks["regular"][0], subfontIndex=picks["regular"][1]))
    pdfmetrics.registerFont(TTFont("Songti-Black", picks["black"][0], subfontIndex=picks["black"][1]))
    pdfmetrics.registerFontFamily("Songti", normal="Songti", bold="Songti-Bold",
                                  italic="Songti", boldItalic="Songti-Bold")
    pdfmetrics.registerFontFamily("Songti-Reg", normal="Songti-Reg", bold="Songti-Bold",
                                  italic="Songti-Reg", boldItalic="Songti-Bold")
    return picks


FONT_PICKS = resolve_fonts()

INK = colors.HexColor("#1f1f1e")
INK2 = colors.HexColor("#4a4a48")
INK3 = colors.HexColor("#7a7a76")
INK4 = colors.HexColor("#a8a8a2")
RULE = colors.HexColor("#d8d7d1")
RULE2 = colors.HexColor("#ecebe6")
BRAND = colors.HexColor("#2f4bb0")
G_A = colors.HexColor("#166a44")
G_B = colors.HexColor("#2f4bb0")
G_C = colors.HexColor("#8a5320")
G_D = colors.HexColor("#6b6b68")
GRADE_COLOR = {"A": G_A, "B": G_B, "C": G_C, "D": G_D}

# ---------- 样式 ----------
S = {}
S["cover_title"] = ParagraphStyle("ct", fontName="Songti-Black", fontSize=30, leading=42,
                                  textColor=INK, alignment=TA_CENTER)
S["cover_sub"] = ParagraphStyle("cs", fontName="Songti", fontSize=13.5, leading=24,
                                textColor=INK2, alignment=TA_CENTER, wordWrap="CJK")
S["cover_meta"] = ParagraphStyle("cm", fontName="Songti-Reg", fontSize=10, leading=19,
                                 textColor=INK3, alignment=TA_CENTER, wordWrap="CJK")
S["h1"] = ParagraphStyle("h1", fontName="Songti-Black", fontSize=19, leading=28, textColor=INK,
                         spaceBefore=0, spaceAfter=2, wordWrap="CJK")
S["h2"] = ParagraphStyle("h2", fontName="Songti-Black", fontSize=13, leading=21, textColor=INK,
                         spaceBefore=14, spaceAfter=5, wordWrap="CJK")
S["sec_no"] = ParagraphStyle("sn", fontName="Songti-Reg", fontSize=9, leading=14, textColor=INK4)
S["body"] = ParagraphStyle("b", fontName="Songti", fontSize=10.4, leading=18.2, textColor=INK2,
                           alignment=TA_JUSTIFY, wordWrap="CJK")
S["body_tight"] = ParagraphStyle("bt", parent=S["body"], spaceAfter=0, wordWrap="CJK")
S["pre"] = ParagraphStyle("pre", fontName="Songti", fontSize=9.4, leading=16.5, textColor=INK3, wordWrap="CJK")
S["lens"] = ParagraphStyle("lens", fontName="Songti-Reg", fontSize=9.2, leading=16,
                           textColor=INK3, spaceAfter=3, wordWrap="CJK")
S["ent_t"] = ParagraphStyle("et", fontName="Songti-Bold", fontSize=12.6, leading=20,
                            textColor=INK, spaceBefore=0, spaceAfter=3, wordWrap="CJK")
S["ent_no"] = ParagraphStyle("en", fontName="Songti-Reg", fontSize=8.6, leading=13,
                             textColor=INK4, spaceAfter=3, wordWrap="CJK")
S["tags"] = ParagraphStyle("tg", fontName="Songti-Reg", fontSize=8.2, leading=14,
                           textColor=INK3, spaceAfter=6, wordWrap="CJK")
S["plain"] = ParagraphStyle("pl", fontName="Songti", fontSize=10.8, leading=19.4, textColor=INK,
                            alignment=TA_JUSTIFY, wordWrap="CJK")
S["k"] = ParagraphStyle("k", fontName="Songti-Bold", fontSize=8.4, leading=13.5, textColor=INK2, wordWrap="CJK")
S["v"] = ParagraphStyle("v", fontName="Songti", fontSize=9.6, leading=17, textColor=INK2,
                        alignment=TA_JUSTIFY, wordWrap="CJK")
S["src"] = ParagraphStyle("src", fontName="Songti-Reg", fontSize=8.2, leading=14.5, textColor=INK3, wordWrap="CJK")
S["toch1"] = ParagraphStyle("t1", fontName="Songti-Bold", fontSize=11, leading=20, textColor=INK)
S["toch2"] = ParagraphStyle("t2", fontName="Songti", fontSize=9.4, leading=16.4, textColor=INK2)
S["toc_note"] = ParagraphStyle("tn", fontName="Songti", fontSize=9.6, leading=17, textColor=INK3, wordWrap="CJK")
S["li"] = ParagraphStyle("li", fontName="Songti", fontSize=10, leading=17.5, textColor=INK2, wordWrap="CJK")
S["li_no"] = ParagraphStyle("lin", fontName="Songti-Reg", fontSize=9, leading=17.5,
                            textColor=INK3, wordWrap="CJK")
S["foot"] = ParagraphStyle("f", fontName="Songti-Reg", fontSize=8, leading=13, textColor=INK4, wordWrap="CJK")

AVAIL = A4[0] - 2 * 2.2 * cm

# ---------- 行内标记 ----------
BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
URL_RE = re.compile(r"&lt;(https?://[^<>\s]+)&gt;")
EXT_REF_RE = re.compile(r"(原书|《高性价比人生指南》)\s*第\s*(\d+)\s*节第\s*(\d+)\s*条")
REF_RE = re.compile(r"第\s*(\d+)\s*节第\s*(\d+)\s*条")
SELF_REF_RE = re.compile(r"本节第\s*(\d+)\s*条")

VALID_IDS = None  # 由 main 填充


def rl(text, self_sec):
    """把正文里的行内标记转成 reportlab 的 mini-HTML。"""
    t = (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    t = URL_RE.sub(lambda m: '<a href="%s" color="#2f4bb0">%s</a>'
                   % (m.group(1), m.group(1).replace("https://", "").replace("http://", "")), t)
    t = BOLD_RE.sub(r"<b>\1</b>", t)
    t = EXT_REF_RE.sub(lambda m: '<font color="#a8a8a2">%s 第 %s 节第 %s 条（不在本指南内）</font>'
                       % (m.group(1), m.group(2), m.group(3)), t)

    def link(sec, no, label):
        key = "%s-%s" % (sec, no)
        if VALID_IDS is not None and key in VALID_IDS:
            return '<a href="#%s" color="#2f4bb0">%s</a>' % ("e-" + key, label)
        return label

    t = REF_RE.sub(lambda m: link(m.group(1), m.group(2), "第 %s 节第 %s 条" % (m.group(1), m.group(2))), t)
    t = SELF_REF_RE.sub(lambda m: link(str(self_sec), m.group(1), "本节第 %s 条" % m.group(1)), t)
    return t


class Anchor(Flowable):
    """零尺寸的锚点：登记内部链接目标，同时写入 PDF 大纲（书签）。"""

    def __init__(self, name, title=None, level=0, key=None):
        Flowable.__init__(self)
        self.name, self.title, self.level, self.key = name, title, level, key
        self.width = self.height = 0

    def draw(self):
        self.canv.bookmarkPage(self.name)
        if self.title:
            # addOutlineEntry(title, key, level=0, closed=None)
            # key 必须与 bookmarkPage 登记的 name 一致，否则书签点不动
            self.canv.addOutlineEntry(self.title, self.name, level=self.level, closed=False)


def labelled_row(label, value_html, value_style=None):
    """左标签右内容的行，用两列表格实现，标签列固定宽度保证对齐。"""
    t = Table([[Paragraph(label, S["k"]), Paragraph(value_html, value_style or S["v"])]],
              colWidths=[1.45 * cm, AVAIL - 1.45 * cm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
    ]))
    return t


def quote_block(html, style):
    """左侧竖线的引用块，用于「说人话」。"""
    t = Table([[Paragraph(html, style)]], colWidths=[AVAIL])
    t.setStyle(TableStyle([
        ("LINEBEFORE", (0, 0), (0, -1), 2, colors.HexColor("#c6c5bf")),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


class TocDoc(BaseDocTemplate):
    def afterFlowable(self, flowable):
        toc = getattr(flowable, "_toc", None)
        if toc:
            level, text, key = toc
            self.notify("TOCEntry", (level, text, self.page, key))


def build_story(B):
    st = []

    # ---- 封面 ----
    st.append(Spacer(1, 5.6 * cm))
    st.append(Paragraph(rl(B["title"], 0), S["cover_title"]))
    st.append(Spacer(1, 0.5 * cm))
    st.append(Paragraph(rl(B["subtitle"], 0), S["cover_sub"]))
    st.append(Spacer(1, 2.4 * cm))
    s = B["stats"]
    st.append(Paragraph(
        "%d 节 · %d 条<br/>A 级 %d · B 级 %d · C 级 %d · D 级 %d<br/>生成日期 %s"
        % (s["sections"], s["entries"], s["byGrade"]["A"], s["byGrade"]["B"],
           s["byGrade"]["C"], s["byGrade"]["D"], B["buildTime"]), S["cover_meta"]))
    st.append(Spacer(1, 3.0 * cm))
    st.append(Paragraph("写给从小学到大学的教师", S["cover_meta"]))
    st.append(PageBreak())

    # ---- 怎么读 ----
    st.append(Paragraph("怎么读", S["h1"]))
    st.append(Spacer(1, 4))
    st.append(Paragraph("写给从小学到大学的教师。每一条都回答两个问题："
                        "<b>这事有多普遍，我能做什么。</b>", S["body"]))

    st.append(Paragraph("不必通读，按学段和需要挑", S["h2"]))
    seg = s.get("segments", {}) or {}
    st.append(Paragraph("全书 %d 节 %d 条。其中 %d 节对小学到大学都适用，%d 节专门写给中小学教师，"
                        "%d 节专门写给高校教师。每节的标题下方都标了适用学段——"
                        "<b>如果时间有限，先读标着「全学段」的那几节。</b>"
                        % (s["sections"], s["entries"], seg.get("全学段", 0),
                           seg.get("中小学", 0), seg.get("高校", 0)), S["body"]))

    st.append(Paragraph("四条互补的读法", S["h2"]))
    st.append(Paragraph("<b>想先保命</b>——先读第 2、3 节（身体信号、心理与求助）。这两节不花什么钱，"
                        "也不需要毅力，但不读的代价最大。", S["body"]))
    st.append(Paragraph("<b>想先省时间</b>——读第 4 节。那里列的每一条都是<b>现行文件里的硬规定</b>，"
                        "是能直接引用的，不是道理。", S["body"]))
    st.append(Paragraph("<b>想做职业规划</b>——读第 7 到 10 节。这四节按学段分开，"
                        "中小学和高校的规则几乎不重叠，别拿另一套的尺子量自己。", S["body"]))
    st.append(Paragraph("<b>只看证据最硬的</b>——证据等级 A，共 %d 条。A 级的意思是：有具体数字，"
                        "而且来自随机试验、荟萃分析或官方文件。" % s["byGrade"]["A"], S["body"]))
    st.append(Paragraph("<b>只看证据边界</b>——证据等级 D，共 %d 条，见附录三。这些条目没有对照研究支持，"
                        "每条都在备注里写明了哪一半有出处、哪一半是作者的判断。"
                        "别把 D 级当成警告，它只是诚实。" % s["picks"]["edge"], S["body"]))

    st.append(Paragraph("字段说明", S["h2"]))
    st.append(Paragraph("每条包含六栏，一栏都不省。", S["body"]))
    st.append(Spacer(1, 3))
    fields = [
        ("成本", "按钱、时间、毅力三个维度给。条目下方的标签就是这三项。"),
        ("说人话", "把「收益」栏里的研究口径翻成日常说法。只用「收益」栏已有的内容，不添新数字。"
                   "只想拿主意的话，看这一栏就够。"),
        ("收益", "具体数字、研究设计和可信范围。原样保留研究的写法，想自己核对就看这一栏。"),
        ("证据等级", "<b>A</b> 有具体数字，来自随机试验、荟萃分析或官方文件；"
                     "<b>B</b> 有具体数字，但来自观察性研究或官方统计；"
                     "<b>C</b> 有明文规定或公开数据，但没有量化效果；"
                     "<b>D</b> 没有直接证据，来自明文规定或公开共识，并写明为什么只到 D。"),
        ("来源", "原始出处，可直接查证。全书共引用 %d 个来源链接，完整清单见仓库的 SOURCES.md。"
                 "依据法规条文的条目直接标注法规名称与条号，条文本身即出处。"
                 % (B.get("sources", {}) or {}).get("urlCount", 0)),
        ("备注", "为什么给这个等级、哪一半有出处哪一半是判断、以及待核实项。"),
    ]
    for k, v in fields:
        st.append(labelled_row(k, v))
        st.append(Spacer(1, 2.5))

    st.append(Paragraph("数据来源", S["h2"]))
    st.append(Paragraph("全书引用 <b>%d 个来源链接</b>，覆盖 %d 条中的 %d 条；其余条目依据的是法规条文本身"
                        "（如《中华人民共和国教师法》《中小学教育惩戒规则（试行）》），条文本身即出处。"
                        "每条的「来源」栏都给出了可点击的链接，完整清单见仓库根目录的 SOURCES.md。"
                        % ((B.get("sources", {}) or {}).get("urlCount", 0), s["entries"],
                           (B.get("sources", {}) or {}).get("entriesWithUrl", 0)), S["body"]))

    st.append(Paragraph("体例来源与许可", S["h2"]))
    st.append(Paragraph("本书的条目模板（成本／说人话／收益／证据等级／来源／备注）与证据等级体系，"
                        "借鉴自 eternity4719《高性价比人生指南》"
                        "（github.com/eternity4719/HowToLiveBetter）。"
                        "<b>本书正文为独立撰写，与该作品的内容没有引用关系。</b>"
                        "本书以「知识共享 署名 4.0 国际（CC BY 4.0）」发布，"
                        "完整许可文本见仓库根目录的 LICENSE。", S["body"]))

    st.append(Paragraph("免责", S["h2"]))
    st.append(Paragraph("本书是科普性的信息整理，<b>不是法律意见、医疗建议或官方口径</b>。"
                        "文中涉及的法律法规、政策数字、比例、时限均可能随时间和地区变化，"
                        "引用前请以官方最新文件为准。凡标注「草案」的均为未生效文本，"
                        "不得当作现行规定使用。涉及心理危机的内容不能替代专业诊疗——"
                        "有立即危险时请拨打 120 或 110，心理支持请拨 12356。", S["body"]))
    st.append(PageBreak())

    # ---- 目录 ----
    st.append(Paragraph("目录", S["h1"]))
    st.append(Spacer(1, 6))
    toc = TableOfContents()
    toc.levelStyles = [S["toch1"], S["toch2"]]
    toc.dotsMinLevel = 0
    st.append(toc)
    st.append(PageBreak())

    # ---- 正文 ----
    for si, sec in enumerate(B["sections"]):
        if si:
            st.append(PageBreak())
        key_s = "s-%d" % sec["sec"]
        st.append(Anchor(key_s, "第 %d 节 %s" % (sec["sec"], sec["title"]), level=0, key=key_s))
        h = Paragraph("第 %d 节　%s"
                      % (sec["sec"], sec["title"]), S["h1"])
        h._toc = (0, "第 %d 节　%s" % (sec["sec"], sec["title"]), key_s)
        st.append(h)
        st.append(Spacer(1, 3))
        st.append(Table([[""]], colWidths=[AVAIL], rowHeights=[1.6],
                        style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), INK),
                                          ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                          ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                          ("TOPPADDING", (0, 0), (-1, -1), 0),
                                          ("BOTTOMPADDING", (0, 0), (-1, -1), 0)])))
        st.append(Spacer(1, 8))

        for line in sec["pre"].split("\n"):
            line = line.strip()
            if not line:
                continue
            m = re.match(r"^\*\*口径\*\*：\s*(.+)$", line)
            if m:
                st.append(Paragraph("口径：" + rl(m.group(1), sec["sec"]), S["lens"]))
            else:
                st.append(Paragraph(rl(line, sec["sec"]), S["pre"]))
        st.append(Spacer(1, 9))

        for e in sec["entries"]:
            key_e = "e-" + e["id"]
            block = []
            block.append(Anchor(key_e, "%d-%d %s" % (e["sec"], e["no"], e["title"]),
                                level=1, key=key_e))
            block.append(Paragraph("%d-%d" % (e["sec"], e["no"]), S["ent_no"]))
            t = Paragraph(rl(e["title"], e["sec"]), S["ent_t"])
            t._toc = (1, "%d-%d %s" % (e["sec"], e["no"], e["title"]), key_e)
            block.append(t)
            dims = "　".join(e["dims"])
            kou = ("　换回 " + e["kou"]) if e["kou"] else ""
            block.append(Paragraph(
                '<font color="%s"><b>%s</b></font>　<font color="#7a7a76" size="7.6">%s%s</font>'
                % (GRADE_COLOR.get(e["gkey"], INK3).hexval().replace("0x", "#"),
                   e["gradeLabel"], dims, kou), S["tags"]))
            block.append(quote_block(rl(e["plain"], e["sec"]), S["plain"]))
            block.append(Spacer(1, 7))

            rows = []
            for k, v, stl in (("成本", e["cost"], None), ("收益", e["benefit"], None),
                              ("路径", e["path"], None), ("备注", e["note"], None),
                              ("来源", e["source"], S["src"])):
                if not v:
                    continue
                rows.append(labelled_row(k, rl(v, e["sec"]), stl))
                rows.append(Spacer(1, 3.5))
            # 标题 + 说人话 + 第一段字段尽量不跨页断开
            st.append(KeepTogether(block + rows[:3]))
            for r in rows[3:]:
                st.append(r)
            st.append(Spacer(1, 16))

    # ---- 附录 ----
    st.append(PageBreak())
    st.append(Anchor("appendix", "附录　三份速查清单", level=0, key="appendix"))
    st.append(Paragraph("附录　三份速查清单", S["h1"]))
    st.append(Spacer(1, 8))

    by_id = {}
    for sec in B["sections"]:
        for e in sec["entries"]:
            by_id[e["id"]] = e

    def appendix(n, title, note, ids, show_grades=True):
        out = [Paragraph("附录%s　%s" % (n, title), S["h2"]),
               Paragraph(note, S["toc_note"]), Spacer(1, 5)]
        data = []
        for i, eid in enumerate(ids, 1):
            e = by_id.get(eid)
            if not e:
                continue
            grade = ('　<font color="%s" size="7.6">%s</font>'
                     % (GRADE_COLOR.get(e["gkey"], INK3).hexval().replace("0x", "#"), e["gradeLabel"])) \
                if show_grades else ""
            data.append([Paragraph(str(i), S["li_no"]),
                         Paragraph('<a href="#e-%s" color="#2f4bb0">%s</a>　<font color="#a8a8a2" size="7.6">'
                                   '%d-%d</font>%s' % (e["id"], rl(e["title"], e["sec"]),
                                                       e["sec"], e["no"], grade), S["li"])])
        t = Table(data, colWidths=[0.8 * cm, AVAIL - 0.8 * cm])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE2),
        ]))
        out.append(t)
        return out

    st += appendix("一", "不花钱、也不要毅力的 %d 条" % s["picks"]["free"],
                   "这一组是成本最低的一批：不需要额外花钱，也不需要靠毅力撑。"
                   "如果现在状态不好，从这里面挑一条开始。",
                   B["picks"]["free"])
    st += appendix("二", "法律与权益：有条文可引用的 %d 条" % s["picks"]["law"],
                   "这一组不看性价比，看依据。每一条背后都是可以逐字引用的法规或文件，"
                   "在和学校、家长出现分歧时最用得上。", B["picks"]["law"])
    st += appendix("三", "证据边界：没有直接证据的 %d 条" % s["picks"]["edge"],
                   "这 %d 条没有随机试验或大型研究支持，来源是明文规定或公开共识。它们的价值在于"
                   "提醒你别漏掉某个变量，不是给你结论。每条的备注里都写明了哪一半有出处、"
                   "哪一半是作者的判断，请按这个结构读。"
                   % s["picks"]["edge"], B["picks"]["edge"])

    st.append(Spacer(1, 22))
    # 版权页：CC BY 4.0 要求署名，PDF 会被单独转发，所以必须自带署名
    st.append(Table([[""]], colWidths=[AVAIL], rowHeights=[0.6],
                    style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), RULE)])))
    st.append(Spacer(1, 12))
    st.append(Paragraph("关于这本书", S["h2"]))
    for line in [
        "《中国教师生活指南》· %d 节 %d 条 · 生成日期 %s" % (s["sections"], s["entries"], B["buildTime"]),
        "体例借鉴自 eternity4719《高性价比人生指南》— github.com/eternity4719/HowToLiveBetter",
        "（本书正文为独立撰写，与该作品无内容引用关系）",
        "许可：知识共享 署名 4.0 国际（CC BY 4.0）— creativecommons.org/licenses/by/4.0/",
        "数据来源清单见仓库根目录的 SOURCES.md；完整许可文本见 LICENSE。",
        "等级分布：A %d · B %d · C %d · D %d" % (s["byGrade"]["A"], s["byGrade"]["B"],
                                                  s["byGrade"]["C"], s["byGrade"]["D"]),
        "免责：科普性信息整理，不构成法律意见、医疗建议或官方口径。政策数字随时间和地区变化，引用前请以官方最新文件为准。",
        "心理支持请拨 12356；有立即危险时请拨 120 或 110。",
    ]:
        st.append(Paragraph(line, S["foot"]))
        st.append(Spacer(1, 3))
    return st


def main():
    global VALID_IDS
    if not os.path.exists(DATA):
        sys.exit("缺少 dist/book.json，请先运行：node tools/build-data.mjs")

    with open(DATA, "r", encoding="utf-8") as f:
        B = json.load(f)
    VALID_IDS = {e["id"] for sec in B["sections"] for e in sec["entries"]}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    doc = TocDoc(OUT, pagesize=A4,
                 leftMargin=2.2 * cm, rightMargin=2.2 * cm,
                 topMargin=2.0 * cm, bottomMargin=1.9 * cm,
                 title=B["title"], author="体例借鉴自 HowToLiveBetter",
                 subject=B["subtitle"])

    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")

    def deco(canvas, doc_):
        canvas.saveState()
        if doc_.page > 1:
            canvas.setStrokeColor(RULE2)
            canvas.setLineWidth(0.4)
            canvas.line(doc_.leftMargin, 1.35 * cm, doc_.leftMargin + doc_.width, 1.35 * cm)
            canvas.setFont("Songti-Reg", 8)
            canvas.setFillColor(INK4)
            canvas.drawString(doc_.leftMargin, 1.02 * cm, B["title"])
            canvas.drawRightString(doc_.leftMargin + doc_.width, 1.02 * cm, str(doc_.page))
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=deco)])

    doc.multiBuild(build_story(B))

    size = os.path.getsize(OUT)
    # 统计页数需要读回文件
    try:
        with open(OUT, "rb") as f:
            raw = f.read()
        pages = raw.count(b"/Type /Page") - raw.count(b"/Type /Pages")
    except Exception:
        pages = "?"
    print("已生成：" + OUT)
    print("  %s 节 %d 条 · 约 %d 页 · 体积约 %.0f KB"
          % (B["stats"]["sections"], B["stats"]["entries"],
             pages if isinstance(pages, int) else -1, size / 1024))
    print("  含带页码目录 + PDF 书签（大纲） + 每节另起一页 + 页脚页码")
    print("  字体：" + "  ".join(
        "%s=%s[%d]" % (r, os.path.basename(p), i) for r, (p, i, _) in FONT_PICKS.items()))


if __name__ == "__main__":
    main()
