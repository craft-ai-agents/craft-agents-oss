// apps/electron/src/renderer/components/templates/TemplatePickerDialog.tsx

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TemplateCard } from './TemplateCard';
import { useTemplates } from '@/hooks/useTemplates';
import type { SessionTemplate } from '@vesper/shared/templates';
import { Loader2Icon, SearchIcon } from 'lucide-react';

interface TemplatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onSelect: (template: SessionTemplate | null, initialPrompt?: string) => void;
}

export function TemplatePickerDialog({ open, onOpenChange, workspaceId, onSelect }: TemplatePickerDialogProps) {
  const { templates, isLoading } = useTemplates(workspaceId);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter templates based on search query
  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) {
      return templates;
    }

    const query = searchQuery.toLowerCase();
    return templates.filter(template =>
      template.name.toLowerCase().includes(query) ||
      (template.description?.toLowerCase().includes(query) ?? false)
    );
  }, [templates, searchQuery]);

  const handleSelect = (template: SessionTemplate | null) => {
    onSelect(template, template?.initialPrompt);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start from Template</DialogTitle>
        </DialogHeader>

        {!isLoading && templates.length > 0 && (
          <div className="relative mb-4">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search templates by name or description..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 py-4">
            {/* Blank Session Card */}
            <TemplateCard template={null} onClick={() => handleSelect(null)} isBlank />

            {/* Template Cards */}
            {filteredTemplates.map(template => (
              <TemplateCard key={template.id} template={template} onClick={() => handleSelect(template)} />
            ))}
          </div>
        )}

        {!isLoading && templates.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No templates yet. Create one from the session context menu.
          </div>
        )}

        {!isLoading && templates.length > 0 && filteredTemplates.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No templates match your search. Try different keywords.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
