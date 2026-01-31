import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useRegisterModal } from "@/context/ModalContext"
import { isMac } from "@/lib/platform"

interface KeyboardShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutSection {
  title: string
  shortcuts: ShortcutItem[]
}

const cmdKey = isMac ? '⌘' : 'Ctrl'

const sections: ShortcutSection[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: [cmdKey, '1'], description: 'Focus sidebar' },
      { keys: [cmdKey, '2'], description: 'Focus session list' },
      { keys: [cmdKey, '3'], description: 'Focus chat input' },
      { keys: [cmdKey, 'N'], description: 'New chat' },
      { keys: [cmdKey, 'Shift', 'N'], description: 'New window' },
      { keys: [cmdKey, 'B'], description: 'Toggle sidebar' },
      { keys: [cmdKey, '.'], description: 'Toggle Focus Mode' },
      { keys: [cmdKey, ','], description: 'Open settings' },
      { keys: [cmdKey, '/'], description: 'Show this dialog' },
      { keys: [cmdKey, 'Shift', 'A'], description: 'Toggle light/dark mode' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Tab'], description: 'Move to next zone' },
      { keys: ['Shift', 'Tab'], description: 'Move to previous zone' },
      { keys: ['←', '→'], description: 'Move between zones (in lists)' },
      { keys: ['↑', '↓'], description: 'Navigate items in list' },
      { keys: ['Home'], description: 'Go to first item' },
      { keys: ['End'], description: 'Go to last item' },
      { keys: ['Esc'], description: 'Close dialog / blur input' },
    ],
  },
  {
    title: 'Session List',
    shortcuts: [
      { keys: ['Enter'], description: 'Focus chat input' },
      { keys: ['Delete'], description: 'Delete session' },
      { keys: ['R'], description: 'Rename session' },
      { keys: ['Right-click'], description: 'Open context menu' },
    ],
  },
  {
    title: 'Agent Tree',
    shortcuts: [
      { keys: ['←'], description: 'Collapse folder' },
      { keys: ['→'], description: 'Expand folder' },
    ],
  },
  {
    title: 'Chat',
    shortcuts: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line' },
      { keys: [cmdKey, 'Enter'], description: 'Send message' },
    ],
  },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-medium bg-muted border border-border rounded shadow-sm">
      {children}
    </kbd>
  )
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  // Register with modal context so X button / Cmd+W closes this dialog first
  useRegisterModal(open, () => onOpenChange(false))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-2">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {section.title}
              </h3>
              <div className="space-y-1.5">
                {section.shortcuts.map((shortcut, index) => (
                  <div key={index} className="flex items-center justify-between py-1">
                    <span className="text-sm">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <Kbd key={keyIndex}>{key}</Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
