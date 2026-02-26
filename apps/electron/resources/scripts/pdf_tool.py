# /// script
# requires-python = ">=3.12"
# dependencies = ["pymupdf>=1.27,<2", "pypdf>=6.7,<7", "click>=8.3,<9"]
# ///
"""PDF operations tool.

Commands: extract, info, merge, split, watermark, fill-form.

Usage:
    uv run pdf_tool.py COMMAND [OPTIONS]
"""

import json
import sys
from pathlib import Path

import click
import fitz  # pymupdf
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject


def write_output(text: str, output_path: str | None) -> None:
    """Write text to file or stdout."""
    if output_path:
        Path(output_path).write_text(text, encoding="utf-8")
        click.echo(f"Output written to {output_path}", err=True)
    else:
        click.echo(text)


def write_pdf(writer: PdfWriter, output_path: str) -> None:
    """Write a PdfWriter to a file."""
    with open(output_path, "wb") as f:
        writer.write(f)
    click.echo(f"PDF written to {output_path}", err=True)


def parse_page_range(range_str: str, total_pages: int) -> list[int]:
    """Parse a page range string like '1-3,5,7-9' into zero-based page indices."""
    pages: list[int] = []
    for part in range_str.split(","):
        part = part.strip()
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start = max(1, int(start_s))
            end = min(total_pages, int(end_s))
            pages.extend(range(start - 1, end))
        else:
            page_num = int(part)
            if 1 <= page_num <= total_pages:
                pages.append(page_num - 1)
    return pages


@click.group()
def cli() -> None:
    """PDF operations tool."""
    pass


@cli.command()
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
@click.option("--pages", type=str, default=None, help="Page range to extract (e.g. '1-3,5,7-9'). 1-based.")
@click.option("-o", "--output", type=click.Path(), default=None, help="Write output to file.")
def extract(file: str, pages: str | None, output: str | None) -> None:
    """Extract text from a PDF file.

    Extracts all text by default, or specific pages with --pages.
    """
    try:
        doc = fitz.open(file)
        total = len(doc)

        if pages:
            page_indices = parse_page_range(pages, total)
        else:
            page_indices = list(range(total))

        parts: list[str] = []
        for idx in page_indices:
            page = doc[idx]
            text = page.get_text()
            parts.append(f"--- Page {idx + 1} ---\n{text}")

        doc.close()
        write_output("\n".join(parts), output)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
@click.option("-o", "--output", type=click.Path(), default=None, help="Write output to file.")
def info(file: str, output: str | None) -> None:
    """Show PDF metadata and information."""
    try:
        reader = PdfReader(file)
        meta = reader.metadata

        info_dict: dict[str, object] = {
            "file": str(Path(file).resolve()),
            "pages": len(reader.pages),
            "encrypted": reader.is_encrypted,
        }

        if meta:
            info_dict["metadata"] = {
                "title": meta.title,
                "author": meta.author,
                "subject": meta.subject,
                "creator": meta.creator,
                "producer": meta.producer,
                "creation_date": str(meta.creation_date) if meta.creation_date else None,
                "modification_date": str(meta.modification_date) if meta.modification_date else None,
            }

        # Page dimensions from first page
        if reader.pages:
            page = reader.pages[0]
            box = page.mediabox
            info_dict["page_size"] = {
                "width": float(box.width),
                "height": float(box.height),
                "width_inches": round(float(box.width) / 72, 2),
                "height_inches": round(float(box.height) / 72, 2),
            }

        # Form fields
        fields = reader.get_fields()
        if fields:
            field_info = []
            for name, field in fields.items():
                field_info.append({
                    "name": name,
                    "type": str(field.get("/FT", "Unknown")),
                    "value": str(field.get("/V", "")),
                })
            info_dict["form_fields"] = field_info

        write_output(json.dumps(info_dict, indent=2, default=str), output)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True, dir_okay=False))
@click.option("-o", "--output", type=click.Path(), required=True, help="Output PDF file path.")
def merge(files: tuple[str, ...], output: str) -> None:
    """Merge multiple PDF files into one.

    Files are merged in the order provided.
    """
    if len(files) < 2:
        click.echo("Error: at least 2 PDF files are required for merge.", err=True)
        sys.exit(1)

    try:
        writer = PdfWriter()
        for f in files:
            reader = PdfReader(f)
            for page in reader.pages:
                writer.add_page(page)

        write_pdf(writer, output)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
@click.option("--pages", type=str, required=True, help="Page range to extract (e.g. '1-3,5,7-9'). 1-based.")
@click.option("-o", "--output", type=click.Path(), required=True, help="Output PDF file path.")
def split(file: str, pages: str, output: str) -> None:
    """Split a PDF by extracting specific pages into a new file."""
    try:
        reader = PdfReader(file)
        total = len(reader.pages)
        page_indices = parse_page_range(pages, total)

        if not page_indices:
            click.echo("Error: no valid pages in the specified range.", err=True)
            sys.exit(1)

        writer = PdfWriter()
        for idx in page_indices:
            writer.add_page(reader.pages[idx])

        write_pdf(writer, output)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
@click.option("--text", type=str, required=True, help="Watermark text.")
@click.option("--font-size", type=float, default=48, help="Font size (default: 48).")
@click.option("--opacity", type=float, default=0.3, help="Opacity 0-1 (default: 0.3).")
@click.option("--angle", type=float, default=45, help="Rotation angle in degrees (default: 45).")
@click.option("--color", type=str, default="gray", help="Color name or hex (default: gray).")
@click.option("-o", "--output", type=click.Path(), required=True, help="Output PDF file path.")
def watermark(file: str, text: str, font_size: float, opacity: float, angle: float, color: str, output: str) -> None:
    """Add a text watermark to every page of a PDF."""
    try:
        doc = fitz.open(file)

        color_map: dict[str, tuple[float, float, float]] = {
            "gray": (0.5, 0.5, 0.5),
            "grey": (0.5, 0.5, 0.5),
            "red": (1.0, 0.0, 0.0),
            "blue": (0.0, 0.0, 1.0),
            "green": (0.0, 0.5, 0.0),
            "black": (0.0, 0.0, 0.0),
        }

        if color.startswith("#") and len(color) == 7:
            r = int(color[1:3], 16) / 255.0
            g = int(color[3:5], 16) / 255.0
            b = int(color[5:7], 16) / 255.0
            fitz_color = (r, g, b)
        else:
            fitz_color = color_map.get(color.lower(), (0.5, 0.5, 0.5))

        for page in doc:
            rect = page.rect
            center = fitz.Point(rect.width / 2, rect.height / 2)

            # Measure text width to center it on the page
            text_width = fitz.get_text_length(text, fontsize=font_size)
            text_point = fitz.Point(center.x - text_width / 2, center.y + font_size / 3)

            tw = fitz.TextWriter(page.rect, opacity=opacity)
            tw.append(text_point, text, fontsize=font_size)
            # fitz.Matrix(1, 1) creates identity, .prerotate(angle) applies rotation
            rotation_matrix = fitz.Matrix(1, 1).prerotate(angle)
            tw.write_text(page, morph=(center, rotation_matrix), color=fitz_color)

        doc.save(output)
        doc.close()
        click.echo(f"Watermarked PDF written to {output}", err=True)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("fill-form")
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
@click.option("--data", type=str, required=True, help="JSON string or path to JSON file with field values.")
@click.option("-o", "--output", type=click.Path(), required=True, help="Output PDF file path.")
def fill_form(file: str, data: str, output: str) -> None:
    """Fill PDF form fields with data from JSON.

    The JSON should map field names to values, e.g. {"name": "John", "date": "2024-01-01"}.
    """
    try:
        # Parse data - either JSON string or file path
        data_path = Path(data)
        if data_path.exists() and data_path.is_file():
            field_data = json.loads(data_path.read_text(encoding="utf-8"))
        else:
            field_data = json.loads(data)

        if not isinstance(field_data, dict):
            click.echo("Error: JSON data must be an object mapping field names to values.", err=True)
            sys.exit(1)

        reader = PdfReader(file)
        writer = PdfWriter()
        writer.append(reader)

        # Fill form fields
        for page_num in range(len(writer.pages)):
            writer.update_page_form_field_values(writer.pages[page_num], field_data)

        # Flatten if possible by setting NeedAppearances
        if "/AcroForm" in writer._root_object:
            writer._root_object["/AcroForm"][NameObject("/NeedAppearances")] = True

        write_pdf(writer, output)
    except json.JSONDecodeError as e:
        click.echo(f"Error parsing JSON data: {e}", err=True)
        sys.exit(1)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    cli()
