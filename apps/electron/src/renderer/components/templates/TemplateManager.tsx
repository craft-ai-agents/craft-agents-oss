// apps/electron/src/renderer/components/templates/TemplateManager.tsx

import { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { templatesAtom, loadTemplatesAtom, deleteTemplateAtom, createTemplateAtom } from '@/atoms/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { SessionTemplate, CreateTemplateOptions } from '@vesper/shared/templates';
import { PlusIcon, TrashIcon } from 'lucide-react';

interface TemplateManagerProps {
  workspaceId: string;
}

export function TemplateManager({ workspaceId }: TemplateManagerProps) {
  const [templates] = useAtom(templatesAtom);
  const [, loadTemplates] = useAtom(loadTemplatesAtom);
  const [, deleteTemplate] = useAtom(deleteTemplateAtom);
  const [, createTemplate] = useAtom(createTemplateAtom);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

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

  const handleCreate = async (options: CreateTemplateOptions) => {
    await createTemplate(options);
    setShowCreateDialog(false);
  };

  const globalTemplates = templates.items.filter(t => t.scope === 'global');
  const workspaceTemplates = templates.items.filter(t => t.scope === 'workspace');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Templates</h2>
        <Button onClick={() => setShowCreateDialog(true)} size="sm">
          <PlusIcon className="size-4 mr-2" />
          New Template
        </Button>
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
            No templates yet. Create one to reuse session configurations.
          </p>
        </div>
      )}

      {showCreateDialog && (
        <CreateTemplateFromScratchDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          workspaceId={workspaceId}
          onCreate={handleCreate}
        />
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

interface CreateTemplateFromScratchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onCreate: (options: CreateTemplateOptions) => Promise<void>;
}

function CreateTemplateFromScratchDialog({ open, onOpenChange, workspaceId, onCreate }: CreateTemplateFromScratchDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'workspace' | 'global'>('workspace');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        scope,
        workspaceId: scope === 'workspace' ? workspaceId : undefined,
      });
      setName('');
      setDescription('');
      setScope('workspace');
    } catch (error) {
      console.error('Failed to create template:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Template</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              placeholder="e.g., Code Review"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-description">Description (optional)</Label>
            <Textarea
              id="template-description"
              placeholder="What is this template for?"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Scope</Label>
            <div className="flex gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="scope"
                  value="workspace"
                  checked={scope === 'workspace'}
                  onChange={() => setScope('workspace')}
                />
                <span className="text-sm">This workspace</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="scope"
                  value="global"
                  checked={scope === 'global'}
                  onChange={() => setScope('global')}
                />
                <span className="text-sm">All workspaces</span>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? 'Creating...' : 'Create Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
