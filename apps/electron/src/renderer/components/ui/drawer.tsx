/**
 * Drawer — re-export from @craft-agent/ui.
 *
 * The implementation moved to packages/ui so it can be used by shared chat
 * components (e.g. the compact Accept-Plan drawer in TurnCard). Existing
 * `@/components/ui/drawer` imports keep working via this shim.
 */
export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
} from '@craft-agent/ui/ui/drawer'
