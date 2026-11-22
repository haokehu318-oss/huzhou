"""把扫描版合同 PDF 每页的图片导出为 png/jpg，便于人工阅读条款。"""
import pathlib, pypdf
out = pathlib.Path("materials_txt/contract_pages"); out.mkdir(parents=True, exist_ok=True)
for f in pathlib.Path("materials/03-合同三份-脱敏版").glob("*.pdf"):
    for i, pg in enumerate(pypdf.PdfReader(f).pages, 1):
        for j, im in enumerate(pg.images):
            p = out / f"{f.stem}-p{i:02d}-{j}{pathlib.Path(im.name).suffix or '.png'}"
            p.write_bytes(im.data); print(p, len(im.data))
