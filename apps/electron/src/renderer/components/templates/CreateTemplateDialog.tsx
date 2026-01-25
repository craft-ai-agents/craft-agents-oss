// apps/electron/src/renderer/components/templates/CreateTemplateDialog.tsx

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SaveSessionAsTemplateOptions } from '@vesper/shared/templates';

interface CreateTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  workspaceId: string;
  onSave: (options: SaveSessionAsTemplateOptions) => Promise<void>;
}

export function CreateTemplateDialog({ open, onOpenChange, sessionId, workspaceId, onSave }: CreateTemplateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'workspace' | 'global'>('workspace');
  const [includeInitialPrompt, setIncludeInitialPrompt] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onSave({
        sessionId,
        name: name.trim(),
        description: description.trim() || undefined,
        scope,
        includeInitialPrompt,
      });
      // Reset form
      setName('');
      setDescription('');
      setScope('workspace');
      setIncludeInitialPrompt(false);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save template:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
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

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="include-prompt"
                checked={includeInitialPrompt}
                onChange={e => setIncludeInitialPrompt(e.target.checked)}
                className="mt-1 cursor-pointer"
              />
              <div className="flex-1">
                <Label htmlFor="include-prompt" className="cursor-pointer text-sm font-normal">
                  Include initial prompt
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  {includeInitialPrompt
                    ? 'The first message from this session will be automatically sent to new sessions using this template'
                    : 'New sessions will need to manually enter the initial prompt'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? 'Saving...' : 'Save Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
