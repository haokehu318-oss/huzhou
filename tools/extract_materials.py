"""把资料包里的 docx/xlsx/pptx/pdf 转成纯文本，输出到 materials_txt/。"""
import pathlib, sys
import docx, openpyxl, pptx, pypdf

src = pathlib.Path("materials")
out = pathlib.Path("materials_txt"); out.mkdir(exist_ok=True)

def docx_text(p):
    d = docx.Document(p); lines = [x.text for x in d.paragraphs if x.text.strip()]
    for t in d.tables:
        for r in t.rows: lines.append(" | ".join(c.text.strip() for c in r.cells))
    return "\n".join(lines)

def xlsx_text(p):
    wb = openpyxl.load_workbook(p, data_only=True); lines = []
    for ws in wb.worksheets:
        lines.append(f"### sheet: {ws.title} ({ws.max_row}x{ws.max_column})")
        for r in ws.iter_rows(values_only=True):
            if any(v is not None for v in r): lines.append(" | ".join("" if v is None else str(v) for v in r))
    return "\n".join(lines)

def pptx_text(p):
    lines = []
    for i, s in enumerate(pptx.Presentation(p).slides, 1):
        lines.append(f"### slide {i}")
        for sh in s.shapes:
            if sh.has_text_frame and sh.text_frame.text.strip(): lines.append(sh.text_frame.text)
            if getattr(sh, "has_table", False) and sh.has_table:
                for r in sh.table.rows: lines.append(" | ".join(c.text for c in r.cells))
    return "\n".join(lines)

def pdf_text(p):
    return "\n".join(f"### page {i}\n{pg.extract_text() or ''}" for i, pg in enumerate(pypdf.PdfReader(p).pages, 1))

fn = {".docx": docx_text, ".xlsx": xlsx_text, ".pptx": pptx_text, ".pdf": pdf_text}
for f in src.rglob("*"):
    if f.suffix in fn:
        t = fn[f.suffix](f)
        (out / (f.stem + ".txt")).write_text(t, encoding="utf-8")
        print(f.name, len(t))
