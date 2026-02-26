# /// script
# requires-python = ">=3.12"
# dependencies = ["markitdown[all]>=0.1.5,<0.2", "click>=8.3,<9"]
# ///
"""Universal document to Markdown converter.

Converts .docx, .xlsx, .pptx, .pdf, .html, .ipynb, .xml, .rss, .zip, .msg
and other supported formats to Markdown using the markitdown library.

Usage:
    uv run markitdown_cli.py [OPTIONS] FILE
"""

import sys
from pathlib import Path

import click
from markitdown import MarkItDown


SUPPORTED_EXTENSIONS = {
    ".docx",
    ".xlsx",
    ".pptx",
    ".pdf",
    ".html",
    ".htm",
    ".ipynb",
    ".xml",
    ".rss",
    ".atom",
    ".zip",
    ".msg",
    ".eml",
    ".csv",
    ".tsv",
    ".json",
    ".txt",
    ".md",
    ".rst",
    ".rtf",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".tiff",
    ".wav",
    ".mp3",
}


def write_output(text: str, output_path: str | None) -> None:
    """Write text to file or stdout."""
    if output_path:
        Path(output_path).write_text(text, encoding="utf-8")
        click.echo(f"Output written to {output_path}", err=True)
    else:
        click.echo(text)


@click.command()
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
@click.option("-o", "--output", type=click.Path(), default=None, help="Write output to file instead of stdout.")
def main(file: str, output: str | None) -> None:
    """Convert a document to Markdown.

    Supports .docx, .xlsx, .pptx, .pdf, .html, .ipynb, .xml, .rss, .zip, .msg,
    and many other formats.
    """
    file_path = Path(file)
    ext = file_path.suffix.lower()

    if ext not in SUPPORTED_EXTENSIONS:
        click.echo(
            f"Warning: extension '{ext}' may not be supported. Attempting conversion anyway.",
            err=True,
        )

    try:
        converter = MarkItDown()
        result = converter.convert(str(file_path))
        write_output(result.text_content, output)
    except Exception as e:
        click.echo(f"Error converting {file_path.name}: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
