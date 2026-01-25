---
status: pending
priority: p3
issue_id: "008"
tags: [code-review, ux, templates, enhancement]
dependencies: []
---

# Problem Statement

**No Search or Filter Functionality for Templates**

As users create more templates, the template picker and manager will become difficult to navigate. There's no way to search, filter, or organize templates beyond usage count sorting.

**Why This Matters:**
- Power users may have 10-20+ templates
- Finding the right template becomes time-consuming
- No way to organize templates by category or workspace
- User experience degrades as template count grows

## Findings

### Current Limitations

**Template Picker:**
- Shows all templates in a grid
- Sorted by usage count only
- No search functionality
- No filtering (e.g., by scope, skills, permission mode)

**Template Manager:**
- Lists all templates linearly
- Separated by scope (global vs workspace)
- No search within each section
- No sorting options

**Sorting Logic:**

**Location:** `packages/shared/src/templates/storage.ts:60`

```typescript
return templates.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
```

**Only sorting criterion:** Usage count (descending)

### User Stories

**Power User with Many Templates:**
> "I have 15 templates for different workflows. I know I want my 'Code Review' template, but I have to visually scan through all of them to find it."

**Team Workspace:**
> "Our workspace has global templates and workspace-specific templates mixed together. I want to filter to only show templates with specific skills attached."

**Keyboard-First User:**
> "I want to type 'code' and have the template picker filter to 'Code Review', 'Code Generation', etc."

## Proposed Solutions

### Solution 1: Add Search and Filtering (Enhancement)

**Add search bar and filter options to template picker and manager.**

#### Template Picker Enhancements:

```typescript
// apps/electron/src/renderer/components/templates/TemplatePickerDialog.tsx

export function TemplatePickerDialog({ open, onOpenChange, workspaceId, onSelect }: TemplatePickerDialogProps) {
  const { templates, isLoading } = useTemplates(workspaceId);
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'workspace'>('all');

  const filteredTemplates = useMemo(() => {
    return templates.filter(t => {
      // Search filter
      const matchesSearch = searchQuery === '' ||
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description?.toLowerCase().includes(searchQuery.toLowerCase());

      // Scope filter
      const matchesScope = scopeFilter === 'all' || t.scope === scopeFilter;

      return matchesSearch && matchesScope;
    });
  }, [templates, searchQuery, scopeFilter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start from Template</DialogTitle>
        </DialogHeader>

        {/* Search Bar */}
        <div className="space-y-3">
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
            className="w-full"
          />

          {/* Scope Filter */}
          <div className="flex gap-2">
            <Button
              variant={scopeFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setScopeFilter('all')}
            >
              All
            </Button>
            <Button
              variant={scopeFilter === 'global' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setScopeFilter('global')}
            >
              Global
            </Button>
            <Button
              variant={scopeFilter === 'workspace' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setScopeFilter('workspace')}
            >
              Workspace
            </Button>
          </div>
        </div>

        {/* Template Grid */}
        <div className="grid grid-cols-2 gap-3 py-4">
          <TemplateCard template={null} onClick={() => handleSelect(null)} isBlank />
          {filteredTemplates.map(template => (
            <TemplateCard key={template.id} template={template} onClick={() => handleSelect(template)} />
          ))}
        </div>

        {filteredTemplates.length === 0 && searchQuery && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No templates found for "{searchQuery}"
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

#### Template Manager Enhancements:

```typescript
// apps/electron/src/renderer/components/templates/TemplateManager.tsx

export function TemplateManager({ workspaceId }: TemplateManagerProps) {
  const [templates] = useAtom(templatesAtom);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'usage' | 'name' | 'date'>('usage');

  const sortedTemplates = useMemo(() => {
    const filtered = templates.items.filter(t =>
      searchQuery === '' ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return filtered.sort((a, b) => {
      if (sortBy === 'usage') {
        return (b.usageCount || 0) - (a.usageCount || 0);
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'date') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      return 0;
    });
  }, [templates.items, searchQuery, sortBy]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-md"
        />

        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
            <option value="usage">Most Used</option>
            <option value="name">Name</option>
            <option value="date">Recently Updated</option>
          </Select>

          <Button onClick={() => setShowCreateDialog(true)} size="sm">
            <PlusIcon className="size-4 mr-2" />
            New Template
          </Button>
        </div>
      </div>

      {/* Grouped templates display */}
      {/* ... rest of component */}
    </div>
  );
}
```

**Pros:**
- Much better UX for power users
- Scales well as template count grows
- Keyboard-friendly (search is auto-focused)

**Cons:**
- More code to maintain
- Need to handle empty states

**Effort:** Small-Medium (2-3 hours)
**Risk:** Low (UI-only enhancement)

### Solution 2: Add Keyboard Navigation Only

**Add keyboard shortcuts for quick template selection.**

**Implementation:**
- Arrow keys to navigate templates
- Enter to select
- Escape to close
- Numbers 1-9 for quick select (first 9 templates)

**Pros:**
- Faster for keyboard users
- Less code than full search

**Cons:**
- Doesn't solve discoverability issue
- Still hard with many templates

**Effort:** Small (1-2 hours)
**Risk:** Low

### Solution 3: Defer to Future Enhancement

**Keep current simple design for v1.**

**Pros:**
- No work now
- Can add later based on user feedback

**Cons:**
- UX degrades as template count grows
- Users may not adopt feature if discovery is hard

**Effort:** None
**Risk:** None

## Recommended Action

**Solution 3 (Defer to Future Enhancement)**

For v1, the simple template picker is sufficient. Most users will have 3-5 templates. Add search/filter in a follow-up PR if users request it.

**Revisit this if:**
- Users report difficulty finding templates
- Template count averages > 10 per workspace
- Feature requests for template organization

**Alternative Quick Win:**
- Add keyboard navigation (Solution 2) - low effort, high value

## Technical Details

**Affected Files (if implementing):**
- `apps/electron/src/renderer/components/templates/TemplatePickerDialog.tsx`
- `apps/electron/src/renderer/components/templates/TemplateManager.tsx`

**UI Components Needed:**
- Search input (already in shadcn)
- Filter buttons (already in shadcn)
- Sort dropdown (already in shadcn)

**State Management:**
- Local component state (no Jotai needed)
- Client-side filtering (no backend changes)

## Acceptance Criteria (if implementing Solution 1)

- [ ] Search bar in template picker (auto-focused)
- [ ] Search filters by template name and description
- [ ] Scope filter buttons (All, Global, Workspace)
- [ ] Template manager has search input
- [ ] Template manager has sort dropdown (Usage, Name, Date)
- [ ] Empty state when no templates match search
- [ ] Search is case-insensitive
- [ ] Search updates in real-time (no submit button)

## Work Log

### 2026-01-25
- **Identified:** Missing search/filter functionality during code review
- **Analysis:** Not critical for v1, but important for scalability
- **Priority:** P3 (enhancement, defer to future PR)
- **Recommendation:** Keep simple for v1, add if users request
- **VERIFIED STILL PENDING:** Feature intentionally not implemented:
  - This is a P3 enhancement, not a bug
  - Current design: Simple template list sorted by usage count
  - No search bar or filter controls in TemplateManager or TemplatePickerDialog
  - Templates only sorted by usage count (storage.ts:138)
  - Recommendation remains: Add if users report difficulty finding templates
  - Status: Correctly marked as pending enhancement

## Resources

- **PR:** https://github.com/AskTinNguyen/vesper/pull/2
- **Pattern:** Similar search exists in Skills marketplace integration
- **Design Inspiration:** GitHub repository search, VS Code command palette
- **Future Enhancement:** Could add tags, categories, favorites
