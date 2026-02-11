# Data Tables & Spreadsheets

G4 OS renders `datatable` and `spreadsheet` code blocks as interactive tables with sorting, filtering, and search.

## Data Table Format

Use a fenced code block with language `datatable`:

````
```datatable
{
  "columns": [
    { "key": "name", "label": "Name", "type": "text" },
    { "key": "revenue", "label": "Revenue", "type": "currency" },
    { "key": "growth", "label": "Growth", "type": "percent" }
  ],
  "rows": [
    { "name": "Product A", "revenue": 50000, "growth": 0.15 },
    { "name": "Product B", "revenue": 32000, "growth": -0.05 }
  ]
}
```
````

## Spreadsheet Format

Use `spreadsheet` for a spreadsheet-style view with column letters, row numbers, and CSV export:

````
```spreadsheet
{
  "title": "Monthly Expenses",
  "columns": [
    { "key": "month", "label": "Month", "type": "text" },
    { "key": "amount", "label": "Amount", "type": "currency" },
    { "key": "category", "label": "Category", "type": "badge" }
  ],
  "rows": [
    { "month": "January", "amount": 1200, "category": "Housing" },
    { "month": "February", "amount": 800, "category": "Food" }
  ]
}
```
````

## Column Types

| Type | Description | Example Output |
|------|-------------|----------------|
| `text` | Plain text (default) | `Product A` |
| `number` | Formatted number with locale separators | `1,234,567` |
| `currency` | USD currency format | `$50,000` |
| `percent` | Percentage with color coding (green/red) | `+15.0%` / `-5.0%` |
| `boolean` | Checkmark/cross | `✓` / `✗` |
| `date` | Localized date string | `1/15/2025` |
| `badge` | Colored pill/tag | `Housing` |

## Column Definition

Each column requires:
- `key` — the property name in each row object
- `label` — the display header text

Optional:
- `type` — one of the column types above (defaults to `text`)

## Optional Fields

- `title` — displayed in the table header bar

## Features

- **Sorting:** Click any column header to sort ascending/descending
- **Search:** Click the search icon to filter rows across all columns
- **Expand:** Click the expand icon to view in fullscreen overlay
- **Export** (spreadsheet only): Download data as CSV

## Tips

- For percent values, use decimal fractions (0.15 for 15%) — the renderer handles conversion
- Use `badge` type for categorical data (status, category, type)
- Keep column count reasonable (3-8 columns) for best readability
- For large datasets (20+ rows), the table auto-scrolls with a sticky header
