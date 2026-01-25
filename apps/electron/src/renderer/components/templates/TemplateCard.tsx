// apps/electron/src/renderer/components/templates/TemplateCard.tsx

import { cn } from '@/lib/utils';
import type { SessionTemplate } from '@vesper/shared/templates';
import { PlusIcon, ShieldIcon, ShieldCheckIcon, ShieldOffIcon } from 'lucide-react';

interface TemplateCardProps {
  template: SessionTemplate | null;
  onClick: () => void;
  isBlank?: boolean;
}

const permissionModeIcons = {
  safe: ShieldIcon,
  ask: ShieldCheckIcon,
  'allow-all': ShieldOffIcon,
};

export function TemplateCard({ template, onClick, isBlank }: TemplateCardProps) {
  if (isBlank) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'group flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-6 text-center transition-colors hover:border-muted-foreground/50 hover:bg-muted/20'
        )}
      >
        <PlusIcon className="size-8 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground/70" />
        <div className="text-sm font-medium">Blank Session</div>
        <div className="text-xs text-muted-foreground">Start with empty configuration</div>
      </button>
    );
  }

  if (!template) return null;

  const PermissionIcon = template.permissionMode ? permissionModeIcons[template.permissionMode] : null;

  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border border-border bg-background p-4 text-left transition-all hover:border-primary/50 hover:bg-muted/20'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm line-clamp-1">{template.name}</div>
        {PermissionIcon && <PermissionIcon className="size-4 shrink-0 text-muted-foreground" />}
      </div>

      {template.description && (
        <div className="text-xs text-muted-foreground line-clamp-2">{template.description}</div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {template.skillIds && template.skillIds.length > 0 && (
          <span>{template.skillIds.length} skill{template.skillIds.length > 1 ? 's' : ''}</span>
        )}
        {template.usageCount !== undefined && template.usageCount > 0 && (
          <span>Used {template.usageCount} time{template.usageCount > 1 ? 's' : ''}</span>
        )}
        {template.scope === 'global' && <span className="rounded bg-muted px-1.5 py-0.5">Global</span>}
      </div>
    </button>
  );
}
