import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def page_number(path: Path) -> int:
    return int(path.stem.split("-")[-1])


def count_dark(image: Image.Image, threshold: int) -> int:
    histogram = image.convert("L").histogram()
    return sum(histogram[:threshold])


def inspect_page(path: Path) -> dict:
    with Image.open(path) as source:
        image = source.convert("RGB")
        sample = image.resize(
            (max(1, image.width // 4), max(1, image.height // 4)),
            Image.Resampling.BILINEAR,
        )
        width, height = sample.size
        top = sample.crop((0, 0, width, int(height * 0.16)))
        footer = sample.crop((0, int(height * 0.92), width, height))
        body = sample.crop((0, int(height * 0.14), width, int(height * 0.92)))

        pixels = top.get_flattened_data() if hasattr(top, "get_flattened_data") else top.getdata()
        purple_pixels = sum(
            1
            for red, green, blue in pixels
            if blue > red * 1.15 and red > green * 1.25 and blue > 60
        )
        footer_ink = count_dark(footer, 180)
        body_ink = count_dark(body, 235)
        body_ratio = body_ink / max(1, body.width * body.height)
        edge = 4
        edge_ink = sum(
            count_dark(crop, 220)
            for crop in (
                sample.crop((0, 0, edge, height)),
                sample.crop((width - edge, 0, width, height)),
                sample.crop((0, 0, width, edge)),
                sample.crop((0, height - edge, width, height)),
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
    if body_ratio < 0.025:
        warnings.append("sparse-body-needs-human-review")
    if body_ratio > 0.34:
        warnings.append("over-dense-body-needs-human-review")

    return {
        "page": page_number(path),
        "bodyInkRatio": round(body_ratio, 4),
        "brandPixels": purple_pixels,
        "footerInkPixels": footer_ink,
        "edgeInkPixels": edge_ink,
        "errors": errors,
        "warnings": warnings,
    }


def contact_sheet(page_paths: list[Path], output: Path) -> None:
    columns = 3
    gap = 24
    label_height = 34
    max_width = 1400
    thumb_width = (max_width - gap * (columns + 1)) // columns
    thumbs = []
    for page_path in page_paths:
        with Image.open(page_path) as source:
            image = source.convert("RGB")
            ratio = thumb_width / image.width
            thumbs.append((page_path, image.resize(
                (thumb_width, int(image.height * ratio)),
                Image.Resampling.LANCZOS,
            )))

    thumb_height = max(image.height for _, image in thumbs)
    rows = (len(thumbs) + columns - 1) // columns
    canvas = Image.new("RGB", (max_width, gap + rows * (thumb_height + label_height + gap)), "#e9eef5")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    for index, (page_path, thumb) in enumerate(thumbs):
        column = index % columns
        row = index // columns
        x = gap + column * (thumb_width + gap)
        y = gap + row * (thumb_height + label_height + gap)
        canvas.paste(thumb, (x, y + label_height))
        draw.text((x, y + 8), f"Page {page_number(page_path)}", fill="#172033", font=font)
    canvas.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--contact-sheet", required=True, type=Path)
    args = parser.parse_args()

    pages = sorted(args.pages.glob("page-*.png"), key=page_number)
    if not pages:
        raise SystemExit("No rendered page PNGs found")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    contact_sheet(pages, args.contact_sheet)
    page_results = [inspect_page(page) for page in pages]
    errors = [f"Page {page['page']}: {error}" for page in page_results for error in page["errors"]]
    warnings = [f"Page {page['page']}: {warning}" for page in page_results for warning in page["warnings"]]
    if len(pages) > 20:
        errors.append(f"Unexpected page count: {len(pages)} exceeds 20")

    report = {
        "renderer": "microsoft-word",
        "pageCount": len(pages),
        "errors": errors,
        "warnings": warnings,
        "pages": page_results,
        "renderedAt": datetime.now(timezone.utc).isoformat(),
    }
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"pageCount": len(pages), "errors": len(errors), "warnings": len(warnings)}))


if __name__ == "__main__":
    main()
