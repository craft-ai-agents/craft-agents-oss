// apps/electron/src/renderer/components/templates/TemplateManager.tsx

import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { templatesAtom, loadTemplatesAtom, deleteTemplateAtom } from '@/atoms/templates';
import { Button } from '@/components/ui/button';
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover';
import type { SessionTemplate } from '@vesper/shared/templates';
import { PlusIcon, TrashIcon } from 'lucide-react';

interface TemplateManagerProps {
  workspaceId: string;
  workspaceRootPath?: string;
}

export function TemplateManager({ workspaceId, workspaceRootPath }: TemplateManagerProps) {
  const [templates] = useAtom(templatesAtom);
  const [, loadTemplates] = useAtom(loadTemplatesAtom);
  const [, deleteTemplate] = useAtom(deleteTemplateAtom);

  useEffect(() => {
    loadTemplates({ scope: 'all', workspaceId });
  }, [workspaceId, loadTemplates]);

  const handleDelete = async (template: SessionTemplate) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    await deleteTemplate({
      id: template.id,
      scope: template.scope,
      workspaceId: template.workspaceId,
    });
  };

  const globalTemplates = templates.items.filter(t => t.scope === 'global');
  const workspaceTemplates = templates.items.filter(t => t.scope === 'workspace');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Templates</h2>
        {workspaceRootPath && (
          <EditPopover
            trigger={
              <Button size="sm">
                <PlusIcon className="size-4 mr-2" />
                New Template
              </Button>
            }
            {...getEditConfig('add-template', workspaceRootPath)}
          />
        )}
      </div>

      {globalTemplates.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Global Templates</h3>
          <div className="space-y-2">
            {globalTemplates.map(template => (
              <TemplateRow key={template.id} template={template} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}

      {workspaceTemplates.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Workspace Templates</h3>
          <div className="space-y-2">
            {workspaceTemplates.map(template => (
              <TemplateRow key={template.id} template={template} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}

      {templates.items.length === 0 && !templates.isLoading && (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No templates yet. Create one to save session configurations for quick reuse.
          </p>
        </div>
      )}
    </div>
  );
}

interface TemplateRowProps {
  template: SessionTemplate;
  onDelete: (template: SessionTemplate) => void;
}

function TemplateRow({ template, onDelete }: TemplateRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background p-4">
      <div className="flex-1 space-y-1">
        <div className="font-medium text-sm">{template.name}</div>
        {template.description && <div className="text-xs text-muted-foreground">{template.description}</div>}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {template.permissionMode && <span className="capitalize">{template.permissionMode} mode</span>}
          {template.skillIds && template.skillIds.length > 0 && (
            <span>{template.skillIds.length} skill{template.skillIds.length > 1 ? 's' : ''}</span>
          )}
          {template.usageCount !== undefined && template.usageCount > 0 && (
            <span>Used {template.usageCount} time{template.usageCount > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => onDelete(template)}>
          <TrashIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
