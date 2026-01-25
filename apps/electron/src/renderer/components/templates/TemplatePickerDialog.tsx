// apps/electron/src/renderer/components/templates/TemplatePickerDialog.tsx

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TemplateCard } from './TemplateCard';
import { useTemplates } from '@/hooks/useTemplates';
import type { SessionTemplate } from '@vesper/shared/templates';
import { Loader2Icon } from 'lucide-react';

interface TemplatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onSelect: (template: SessionTemplate | null, initialPrompt?: string) => void;
}

export function TemplatePickerDialog({ open, onOpenChange, workspaceId, onSelect }: TemplatePickerDialogProps) {
  const { templates, isLoading } = useTemplates(workspaceId);

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

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 py-4">
            {/* Blank Session Card */}
            <TemplateCard template={null} onClick={() => handleSelect(null)} isBlank />

            {/* Template Cards */}
            {templates.map(template => (
              <TemplateCard key={template.id} template={template} onClick={() => handleSelect(template)} />
            ))}
          </div>
        )}

        {!isLoading && templates.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No templates yet. Create one from the session context menu.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
