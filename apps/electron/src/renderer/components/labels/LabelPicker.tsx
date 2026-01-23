/**
 * LabelPicker Component
 *
 * A popover for assigning labels to sessions.
 * Includes label list with checkboxes, new label creation, and delete functionality.
 */

import * as React from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LabelBadge } from '@/components/ui/label-badge';
import { labelsAtom, createLabelAtom, deleteLabelAtom } from '@/atoms/labels';
import { LABEL_COLORS, type Label } from '@craft-agent/shared/labels';
import { Check, Plus, Tag, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LabelPickerProps {
  /** Session ID to manage labels for */
  sessionId: string;
  /** Workspace ID */
  workspaceId: string;
  /** Currently assigned label IDs */
  selectedLabelIds: string[];
  /** Callback when labels change */
  onLabelsChange: (labelIds: string[]) => void;
  /** Custom trigger element */
  trigger?: React.ReactNode;
  /** Alignment of the popover */
  align?: 'start' | 'center' | 'end';
}

export function LabelPicker({
  sessionId,
  workspaceId,
  selectedLabelIds,
  onLabelsChange,
  trigger,
  align = 'start',
}: LabelPickerProps) {
  const [open, setOpen] = React.useState(false);
  const labels = useAtomValue(labelsAtom);
  const createLabel = useSetAtom(createLabelAtom);
  const deleteLabel = useSetAtom(deleteLabelAtom);

  // New label creation state
  const [isCreating, setIsCreating] = React.useState(false);
  const [newLabelName, setNewLabelName] = React.useState('');
  const [selectedColor, setSelectedColor] = React.useState<string>(LABEL_COLORS[0].value);
  const [error, setError] = React.useState<string | null>(null);

  const toggleLabel = (labelId: string) => {
    if (selectedLabelIds.includes(labelId)) {
      onLabelsChange(selectedLabelIds.filter(id => id !== labelId));
    } else {
      onLabelsChange([...selectedLabelIds, labelId]);
    }
  };

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) {
      setError('Label name is required');
      return;
    }

    try {
      setError(null);
      const label = await createLabel({
        workspaceId,
        name: newLabelName.trim(),
        color: selectedColor,
      });
      // Auto-assign the new label to the session
      onLabelsChange([...selectedLabelIds, label.id]);
      // Reset creation state
      setNewLabelName('');
      setSelectedColor(LABEL_COLORS[0].value);
      setIsCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create label');
    }
  };

  const handleDeleteLabel = async (labelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteLabel({ workspaceId, labelId });
    } catch (err) {
      console.error('Failed to delete label:', err);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1">
            <Tag className="h-3.5 w-3.5" />
            <span>Labels</span>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align={align}>
        <div className="space-y-2">
          {/* Label List */}
          {labels.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {labels.map((label) => (
                <div
                  key={label.id}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer',
                    'hover:bg-foreground/5 transition-colors',
                    selectedLabelIds.includes(label.id) && 'bg-foreground/5'
                  )}
                  onClick={() => toggleLabel(label.id)}
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="flex-1 text-sm truncate">{label.name}</span>
                  <div className="flex items-center gap-1">
                    {selectedLabelIds.includes(label.id) && (
                      <Check className="h-4 w-4 text-accent" />
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleDeleteLabel(label.id, e)}
                      className="p-1 rounded hover:bg-destructive/10 text-foreground/50 hover:text-destructive transition-colors"
                      aria-label={`Delete ${label.name} label`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty State */}
          {labels.length === 0 && !isCreating && (
            <div className="text-center py-4 text-foreground/50 text-sm">
              No labels yet
            </div>
          )}

          {/* Divider */}
          {labels.length > 0 && <div className="border-t border-foreground/10" />}

          {/* Create New Label */}
          {isCreating ? (
            <div className="space-y-2">
              <Input
                placeholder="Label name"
                value={newLabelName}
                onChange={(e) => {
                  setNewLabelName(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateLabel();
                  } else if (e.key === 'Escape') {
                    setIsCreating(false);
                    setNewLabelName('');
                    setError(null);
                  }
                }}
                autoFocus
                className="h-8"
              />
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
              {/* Color Picker */}
              <div className="flex flex-wrap gap-1">
                {LABEL_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    className={cn(
                      'w-5 h-5 rounded-full border-2 transition-transform hover:scale-110',
                      selectedColor === color.value
                        ? 'border-foreground'
                        : 'border-transparent'
                    )}
                    style={{ backgroundColor: color.value }}
                    onClick={() => setSelectedColor(color.value)}
                    title={color.name}
                  />
                ))}
              </div>
              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7"
                  onClick={() => {
                    setIsCreating(false);
                    setNewLabelName('');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1 h-7"
                  onClick={handleCreateLabel}
                  disabled={!newLabelName.trim()}
                >
                  Create
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start h-8 gap-2 text-foreground/70"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="h-4 w-4" />
              Create new label
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default LabelPicker;
