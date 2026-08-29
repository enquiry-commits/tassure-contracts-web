import argparse
import html
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def natural_page_key(path: Path) -> int:
    return int(path.stem.split("-")[-1])


def count_below(image: Image.Image, threshold: int) -> int:
    histogram = image.convert("L").histogram()
    return sum(histogram[:threshold])


def inspect_page(page: Path) -> dict:
    with Image.open(page) as source:
        image = source.convert("RGB")
        width, height = image.size
        # Downsampling keeps this audit fast while preserving the large brand
        # marks and footer text that indicate a correctly repeated page frame.
        sample = image.resize((max(1, width // 4), max(1, height // 4)), Image.Resampling.BILINEAR)
        sw, sh = sample.size
        top = sample.crop((0, 0, sw, int(sh * 0.16)))
        footer = sample.crop((0, int(sh * 0.92), sw, sh))
        body = sample.crop((0, int(sh * 0.14), sw, int(sh * 0.92)))

        top_pixels = (
            top.get_flattened_data()
            if hasattr(top, "get_flattened_data")
            else top.getdata()
        )
        purple_pixels = sum(
            1
            for red, green, blue in top_pixels
            if blue > red * 1.15 and red > green * 1.25 and blue > 60
        )
        footer_ink = count_below(footer, 180)
        body_ink = count_below(body, 235)
        body_ratio = body_ink / max(1, body.width * body.height)

        edge = 4
        edge_ink = sum(
            count_below(crop, 220)
            for crop in (
                sample.crop((0, 0, edge, sh)),
                sample.crop((sw - edge, 0, sw, sh)),
                sample.crop((0, 0, sw, edge)),
                sample.crop((0, sh - edge, sw, sh)),
            )
        )

    errors = []
    warnings = []
    if purple_pixels < 100:
        errors.append("missing-brand-header")
    if footer_ink < 75:
        errors.append("missing-footer")
    if edge_ink > 20:
        errors.append("content-at-page-edge")
    if body_ratio < 0.01:
        warnings.append("sparse-body")

    return {
        "page": natural_page_key(page),
        "file": page.name,
        "bodyInkRatio": round(body_ratio, 4),
        "brandPixels": purple_pixels,
        "footerInkPixels": footer_ink,
        "edgeInkPixels": edge_ink,
        "errors": errors,
        "warnings": warnings,
    }


def make_contact_sheet(scenario_dir: Path, max_width: int = 1400) -> dict:
    pages = sorted(scenario_dir.glob("page-*.png"), key=natural_page_key)
    if not pages:
        raise RuntimeError(f"No pages found in {scenario_dir}")

    columns = 3
    gap = 24
    label_height = 34
    thumb_width = (max_width - gap * (columns + 1)) // columns
    thumbs = []
    for page in pages:
        with Image.open(page) as source:
            image = source.convert("RGB")
            ratio = thumb_width / image.width
            thumb = image.resize((thumb_width, int(image.height * ratio)), Image.Resampling.LANCZOS)
            thumbs.append((page, thumb))

    thumb_height = max(thumb.height for _, thumb in thumbs)
    rows = (len(thumbs) + columns - 1) // columns
    canvas = Image.new("RGB", (max_width, gap + rows * (thumb_height + label_height + gap)), "#e9eef5")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    for index, (page, thumb) in enumerate(thumbs):
        col = index % columns
        row = index // columns
        x = gap + col * (thumb_width + gap)
        y = gap + row * (thumb_height + label_height + gap)
        canvas.paste(thumb, (x, y + label_height))
        draw.text((x, y + 8), f"Page {natural_page_key(page)}", fill="#172033", font=font)

    output = scenario_dir / "contact-sheet.png"
    canvas.save(output, optimize=True)
    page_results = [inspect_page(page) for page in pages]
    return {
        "scenario": scenario_dir.name,
        "pageCount": len(pages),
        "contactSheet": str(output),
        "errors": sum(len(page["errors"]) for page in page_results),
        "warnings": sum(len(page["warnings"]) for page in page_results),
        "pages": page_results,
    }


def write_report(renders: Path, results: list[dict]) -> None:
    cards = []
    for result in results:
        relative = Path(result["contactSheet"]).relative_to(renders).as_posix()
        issue_rows = []
        for page in result["pages"]:
            issues = page["errors"] + page["warnings"]
            if issues:
                issue_rows.append(
                    f'<li>Page {page["page"]}: {html.escape(", ".join(issues))} '
                    f'(body ink {page["bodyInkRatio"]:.2%})</li>'
                )
        issues_html = f'<ul>{"".join(issue_rows)}</ul>' if issue_rows else '<p class="pass">All automatic page-frame checks passed.</p>'
        cards.append(
            f'<article><header><h2>{html.escape(result["scenario"])}</h2>'
            f'<span>{result["pageCount"]} pages · {result["errors"]} errors · {result["warnings"]} warnings</span></header>'
            f'{issues_html}<a href="{html.escape(relative)}"><img src="{html.escape(relative)}" alt="{html.escape(result["scenario"])} contact sheet"></a></article>'
        )
    total_pages = sum(result["pageCount"] for result in results)
    total_errors = sum(result["errors"] for result in results)
    total_warnings = sum(result["warnings"] for result in results)
    report = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tassure Proposal Visual QA</title><style>
body{{margin:0;background:#f3f6fa;color:#172033;font:14px Inter,Segoe UI,Arial,sans-serif}}main{{max-width:1500px;margin:auto;padding:32px}}h1{{margin:0 0 8px}}p{{color:#64748b;margin:0 0 20px}}article{{background:white;border:1px solid #dce3ec;border-radius:14px;padding:18px;margin-bottom:24px}}header{{display:flex;justify-content:space-between;align-items:center}}header span{{background:#e8eef7;padding:6px 10px;border-radius:999px}}ul{{color:#9a3412}}.pass{{color:#166534}}img{{width:100%;display:block;margin-top:14px;border:1px solid #cbd5e1}}
</style></head><body><main><h1>Tassure Proposal Visual QA</h1><p>Microsoft Word native render · {total_pages} pages · {total_errors} errors · {total_warnings} warnings. Sparse-page warnings require human review; missing branding, footer, or clipped page edges fail automatically.</p>{''.join(cards)}</main></body></html>"""
    (renders / "visual-report.html").write_text(report, encoding="utf-8")
    (renders / "visual-report.json").write_text(json.dumps(results, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--renders", required=True, type=Path)
    args = parser.parse_args()
    renders = args.renders.resolve()
    results = [make_contact_sheet(path) for path in sorted(renders.iterdir()) if path.is_dir() and list(path.glob("page-*.png"))]
    write_report(renders, results)
    print(f"Visual report: {renders / 'visual-report.html'}")
    error_count = sum(result["errors"] for result in results)
    if error_count:
        raise SystemExit(f"Visual QA failed with {error_count} page-frame error(s)")


if __name__ == "__main__":
    main()
