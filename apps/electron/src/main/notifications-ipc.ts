/**
 * Notification Settings IPC Handlers
 *
 * IPC handlers for notification settings CRUD operations.
 */

import { ipcMain, BrowserWindow, Notification } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import {
  getNotificationSettings,
  setNotificationSettings,
  type NotificationSettings,
} from '@vesper/shared/config';

/**
 * Broadcast notification settings changed event to all windows
 */
function broadcastNotificationSettingsChanged(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC_CHANNELS.NOTIFICATIONS_SETTINGS_CHANGED);
  });
}

/**
 * Register notification settings IPC handlers
 */
export function registerNotificationIpc(): void {
  // Get current notification settings
  ipcMain.handle(IPC_CHANNELS.NOTIFICATIONS_GET_SETTINGS, async (): Promise<NotificationSettings> => {
    try {
      return getNotificationSettings();
    } catch (error) {
      console.error('[notifications:getSettings] Error:', error);
      throw error;
    }
  });

  // Update notification settings
  ipcMain.handle(
    IPC_CHANNELS.NOTIFICATIONS_SET_SETTINGS,
    async (_event, settings: Partial<NotificationSettings>): Promise<{ success: boolean; error?: string }> => {
      try {
        setNotificationSettings(settings);
        broadcastNotificationSettingsChanged();
        return { success: true };
      } catch (error) {
        console.error('[notifications:setSettings] Error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update notification settings',
        };
      }
    }
  );

  // Send a test notification
  ipcMain.handle(
    IPC_CHANNELS.NOTIFICATIONS_TEST,
    async (): Promise<{ success: boolean; error?: string }> => {
      try {
        // Check if notifications are supported on this platform
        if (!Notification.isSupported()) {
          return {
            success: false,
            error: 'Notifications are not supported on this platform',
          };
        }

        // Get current settings to respect sound preference
        const settings = getNotificationSettings();

        // Send test notification (always silent - we handle sound ourselves)
        const notification = new Notification({
          title: 'Vesper Test Notification',
          body: 'This is a test notification from Vesper. If you can see this, notifications are working correctly!',
          silent: true,
        });

        notification.show();

        // Play custom notification sound with volume control via renderer
        if (settings.sound) {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
              win.webContents.send(IPC_CHANNELS.NOTIFICATIONS_PLAY_SOUND, settings.soundVolume);
            }
          });
        }

        return { success: true };
      } catch (error) {
        console.error('[notifications:test] Error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to send test notification',
        };
      }
    }
  );
}
