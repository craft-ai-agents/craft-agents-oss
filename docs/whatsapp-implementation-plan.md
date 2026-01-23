# WhatsApp Integration - Full Implementation Plan

**Status:** Phase 3a-3c complete, Phase 3d pending
**Created:** 2026-01-23
**Last Updated:** 2026-01-23

---

## Executive Summary

The WhatsApp integration has a solid backend foundation (message routing, formatting, queue, directive parsing) with comprehensive tests (117 passing). However, four components are missing to enable end-to-end functionality:

| Component | Status | Priority | Effort |
|-----------|--------|----------|--------|
| 1. CredentialManager WhatsApp Methods | **Complete** | P0 | Small |
| 2. Baileys Worker Subprocess | **Complete** | P1 | Medium |
| 3. IPC Handlers | **Complete** | P1 | Small |
| 4. Renderer UI | Missing | P2 | Medium |

---

## Phase 3a: CredentialManager WhatsApp Methods (P0)

**Why P0:** The `WhatsAppService` calls these methods but they don't exist - integration is non-functional without them.

### Files to Modify

1. `packages/shared/src/credentials/types.ts`
2. `packages/shared/src/credentials/manager.ts`

### Implementation

#### Step 1: Add WhatsApp Credential Type

```typescript
// packages/shared/src/credentials/types.ts

// Add to CredentialType union (line 19-29):
export type CredentialType =
  // ... existing types ...
  | 'whatsapp_session';  // WhatsApp Baileys session data

// Add to VALID_CREDENTIAL_TYPES (line 32-41):
const VALID_CREDENTIAL_TYPES: readonly CredentialType[] = [
  // ... existing types ...
  'whatsapp_session',
] as const;
```

#### Step 2: Add WhatsApp Methods to CredentialManager

```typescript
// packages/shared/src/credentials/manager.ts

// Add after line 239 (deleteWorkspaceCredentials method):

// ============================================================
// WhatsApp Session Methods
// ============================================================

/**
 * Store WhatsApp session credentials (Baileys session data)
 *
 * @param workspaceId - Workspace ID
 * @param phoneNumber - Phone number (used as unique identifier)
 * @param session - WhatsApp session object
 */
async setWhatsAppSession(
  workspaceId: string,
  phoneNumber: string,
  session: {
    jid: string;
    pushName: string;
    sessionData: unknown;
    createdAt: number;
    connectedAt: number;
    isExpired: boolean;
  }
): Promise<void> {
  await this.set(
    {
      type: 'whatsapp_session' as CredentialType,
      workspaceId,
      sourceId: phoneNumber
    },
    {
      value: JSON.stringify(session),
      // Store metadata for quick access without parsing
      expiresAt: session.isExpired ? 0 : undefined,
    }
  );
}

/**
 * Get WhatsApp session credentials
 *
 * @param workspaceId - Workspace ID
 * @param phoneNumber - Phone number
 * @returns Session object or null if not found
 */
async getWhatsAppSession(
  workspaceId: string,
  phoneNumber: string
): Promise<{
  jid: string;
  pushName: string;
  sessionData: unknown;
  createdAt: number;
  connectedAt: number;
  isExpired: boolean;
} | null> {
  const cred = await this.get({
    type: 'whatsapp_session' as CredentialType,
    workspaceId,
    sourceId: phoneNumber
  });

  if (!cred?.value) return null;

  try {
    return JSON.parse(cred.value);
  } catch {
    return null;
  }
}

/**
 * Delete WhatsApp session credentials (GDPR compliance)
 *
 * @param workspaceId - Workspace ID
 * @param phoneNumber - Phone number
 */
async deleteWhatsAppSession(
  workspaceId: string,
  phoneNumber: string
): Promise<boolean> {
  return this.delete({
    type: 'whatsapp_session' as CredentialType,
    workspaceId,
    sourceId: phoneNumber
  });
}

/**
 * Get all WhatsApp sessions for a workspace
 *
 * @param workspaceId - Workspace ID
 * @returns Array of session objects
 */
async getAllWhatsAppSessions(workspaceId: string): Promise<Array<{
  jid: string;
  pushName: string;
  sessionData: unknown;
  createdAt: number;
  connectedAt: number;
  isExpired: boolean;
}>> {
  const allCreds = await this.list({
    type: 'whatsapp_session' as CredentialType,
    workspaceId
  });

  const sessions: Array<any> = [];
  for (const credId of allCreds) {
    const cred = await this.get(credId);
    if (cred?.value) {
      try {
        sessions.push(JSON.parse(cred.value));
      } catch {
        // Skip malformed sessions
      }
    }
  }

  return sessions;
}
```

#### Step 3: Update Credential Type Validation

```typescript
// packages/shared/src/credentials/types.ts

// Update isSourceCredential function (line 97-99):
const SOURCE_CREDENTIAL_TYPES = [
  'source_oauth',
  'source_bearer',
  'source_apikey',
  'source_basic',
  'whatsapp_session',  // Add this
] as const;
```

### Tests to Add

```typescript
// packages/shared/src/credentials/__tests__/whatsapp-session.test.ts

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { CredentialManager } from '../manager';

describe('WhatsApp Session Credentials', () => {
  let manager: CredentialManager;

  beforeEach(async () => {
    manager = new CredentialManager();
    await manager.initialize();
  });

  test('setWhatsAppSession stores session', async () => {
    const session = {
      jid: '1234567890@s.whatsapp.net',
      pushName: 'Test User',
      sessionData: { key: 'value' },
      createdAt: Date.now(),
      connectedAt: Date.now(),
      isExpired: false,
    };

    await manager.setWhatsAppSession('workspace-1', '+1234567890', session);
    const retrieved = await manager.getWhatsAppSession('workspace-1', '+1234567890');

    expect(retrieved).toEqual(session);
  });

  test('deleteWhatsAppSession removes session', async () => {
    // ... test implementation
  });

  test('getAllWhatsAppSessions returns all sessions', async () => {
    // ... test implementation
  });
});
```

---

## Phase 3b: Baileys Worker Subprocess (P1)

**Why P1:** The WhatsAppService spawns this worker to handle the actual WhatsApp Web connection.

### Files to Create

1. `apps/electron/src/main/workers/baileys-worker.js`

### Dependencies to Add

```bash
# Add to apps/electron/package.json
bun add @whiskeysockets/baileys qrcode-terminal
```

### Implementation

```javascript
// apps/electron/src/main/workers/baileys-worker.js

/**
 * Baileys Worker - WhatsApp Web Connection Handler
 *
 * Runs as a subprocess, communicates with main process via IPC.
 * Handles:
 * - QR code generation for authentication
 * - Session management (save/restore)
 * - Incoming message processing
 * - Outgoing message sending
 */

const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

const workspaceId = process.env.WORKSPACE_ID;
let sock = null;
let sessionData = null;

/**
 * Send message to parent process
 */
function sendToParent(message) {
  if (process.send) {
    process.send(message);
  }
}

/**
 * Initialize WhatsApp connection
 */
async function connect(existingSession = null) {
  // Use auth state from provided session or create new
  const authDir = path.join(process.cwd(), '.whatsapp-auth', workspaceId || 'default');

  // If restoring session, write session data to auth dir
  if (existingSession) {
    fs.mkdirSync(authDir, { recursive: true });
    // Write Baileys auth state files
    // ... session restoration logic
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // We handle QR ourselves
  });

  // Handle connection updates
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Send QR code to parent for display
    if (qr) {
      sendToParent({ type: 'connection_update', data: { connection: 'qr', qr } });
      // Also generate terminal QR for debugging
      qrcode.generate(qr, { small: true }, (code) => {
        console.log(code);
      });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      sendToParent({
        type: 'connection_update',
        data: { connection: 'close', shouldReconnect, statusCode }
      });

      if (shouldReconnect) {
        setTimeout(() => connect(), 5000);
      }
    } else if (connection === 'open') {
      const isNewLogin = !existingSession;
      sendToParent({
        type: 'connection_update',
        data: { connection: 'open', isNewLogin }
      });
    }
  });

  // Save credentials on update
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    // Send updated session data to parent
    sendToParent({
      type: 'session_updated',
      data: {
        jid: sock.user?.id,
        pushName: sock.user?.name,
        sessionData: state,
      }
    });
  });

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip messages from self
      if (msg.key.fromMe) continue;

      // Skip non-group messages (for now)
      if (!msg.key.remoteJid?.endsWith('@g.us')) continue;

      // Extract message content
      const content = msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      // Check for @vespr mention (bot trigger)
      if (!content.toLowerCase().includes('@vespr')) continue;

      // Get sender info
      const groupJid = msg.key.remoteJid;
      const senderJid = msg.key.participant || msg.key.remoteJid;

      // Get group metadata for name
      let groupName = 'Unknown Group';
      try {
        const groupMeta = await sock.groupMetadata(groupJid);
        groupName = groupMeta.subject;
      } catch (e) {
        console.error('Failed to get group metadata:', e);
      }

      // Get sender contact info
      let senderName = 'Unknown';
      let senderPhone = senderJid.split('@')[0];

      // Send to parent
      sendToParent({
        type: 'incoming_message',
        data: {
          id: msg.key.id,
          groupJid,
          groupName,
          senderJid,
          senderPhoneNumber: `+${senderPhone}`,
          senderName,
          content,
          timestamp: (msg.messageTimestamp || Date.now() / 1000) * 1000,
          attachments: [], // TODO: Handle media attachments
        }
      });
    }
  });
}

/**
 * Handle messages from parent process
 */
process.on('message', async (msg) => {
  switch (msg.type) {
    case 'restore_session':
      await connect(msg.sessionData);
      break;

    case 'request_session_data':
      if (sessionData) {
        sendToParent({ type: 'session_updated', data: sessionData });
      }
      break;

    case 'send_message':
      if (sock) {
        try {
          await sock.sendMessage(msg.to, { text: msg.content });
          sendToParent({ type: 'message_sent', messageId: msg.id });
        } catch (error) {
          sendToParent({ type: 'error', message: error.message });
        }
      }
      break;

    case 'disconnect':
      if (sock) {
        await sock.logout();
        sock = null;
      }
      process.exit(0);
      break;
  }
});

// Start connection
connect().catch((error) => {
  sendToParent({ type: 'error', message: error.message });
  process.exit(1);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  sendToParent({ type: 'error', message: `Uncaught: ${error.message}` });
});
```

### Considerations

1. **Security:** The worker runs with filesystem access - ensure session data is sandboxed
2. **Rate Limiting:** WhatsApp bans accounts that send too many messages - implement throttling
3. **Session Expiry:** Baileys sessions can expire - handle re-authentication gracefully

---

## Phase 3c: IPC Handlers (P1)

**Why P1:** Enables renderer to communicate with WhatsApp service.

### Files to Modify

1. `apps/electron/src/shared/types.ts` - Add IPC channel constants
2. `apps/electron/src/main/ipc.ts` - Add handlers
3. `apps/electron/src/preload/preload.ts` - Expose to renderer

### Implementation

#### Step 1: Add IPC Channel Constants

```typescript
// apps/electron/src/shared/types.ts

// Add to IPC_CHANNELS object:
export const IPC_CHANNELS = {
  // ... existing channels ...

  // WhatsApp channels
  WHATSAPP_CONNECT: 'whatsapp:connect',
  WHATSAPP_DISCONNECT: 'whatsapp:disconnect',
  WHATSAPP_STATUS: 'whatsapp:status',
  WHATSAPP_LIST_SESSIONS: 'whatsapp:list-sessions',
  WHATSAPP_SEND_MESSAGE: 'whatsapp:send-message',

  // WhatsApp events (main → renderer)
  WHATSAPP_QR_CODE: 'whatsapp:qr-code',
  WHATSAPP_AUTHENTICATED: 'whatsapp:authenticated',
  WHATSAPP_DISCONNECTED: 'whatsapp:disconnected',
  WHATSAPP_MESSAGE_RECEIVED: 'whatsapp:message-received',
  WHATSAPP_ERROR: 'whatsapp:error',
} as const;
```

#### Step 2: Add IPC Handlers

```typescript
// apps/electron/src/main/whatsapp-ipc.ts (new file)

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import { getWhatsAppService, closeWhatsAppService } from './whatsapp-service';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import type { SessionManager } from './sessions';

/**
 * Register WhatsApp IPC handlers
 */
export function registerWhatsAppHandlers(sessionManager: SessionManager): void {
  const credentialManager = getCredentialManager();

  /**
   * Connect to WhatsApp
   */
  ipcMain.handle(IPC_CHANNELS.WHATSAPP_CONNECT, async (_, { workspaceId, phoneNumber }) => {
    try {
      const service = getWhatsAppService(workspaceId);
      service.setCredentialManager(credentialManager);
      service.setPhoneNumber(phoneNumber);
      service.setSessionManager(sessionManager);

      await service.start(phoneNumber);

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Disconnect from WhatsApp (GDPR compliant - deletes credentials)
   */
  ipcMain.handle(IPC_CHANNELS.WHATSAPP_DISCONNECT, async (_, { workspaceId, phoneNumber }) => {
    try {
      const service = getWhatsAppService(workspaceId);
      await service.disconnect(phoneNumber);
      closeWhatsAppService(workspaceId);

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Get connection status
   */
  ipcMain.handle(IPC_CHANNELS.WHATSAPP_STATUS, async (_, { workspaceId }) => {
    try {
      const service = getWhatsAppService(workspaceId);
      return {
        success: true,
        status: service.getConnectionStatus()
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List all WhatsApp sessions for workspace
   */
  ipcMain.handle(IPC_CHANNELS.WHATSAPP_LIST_SESSIONS, async (_, { workspaceId }) => {
    try {
      const service = getWhatsAppService(workspaceId);
      const sessions = await service.listSessions();
      return { success: true, sessions };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Send message to WhatsApp
   */
  ipcMain.handle(IPC_CHANNELS.WHATSAPP_SEND_MESSAGE, async (_, { workspaceId, to, content }) => {
    try {
      const service = getWhatsAppService(workspaceId);
      const messageId = await service.sendMessage(to, content);
      return { success: true, messageId };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}
```

#### Step 3: Register in Main IPC

```typescript
// apps/electron/src/main/ipc.ts

// Add import at top:
import { registerWhatsAppHandlers } from './whatsapp-ipc';

// Add in registerIpcHandlers function:
export function registerIpcHandlers(sessionManager: SessionManager, windowManager: WindowManager) {
  // ... existing handlers ...

  // WhatsApp handlers
  registerWhatsAppHandlers(sessionManager);
}
```

#### Step 4: Expose in Preload

```typescript
// apps/electron/src/preload/preload.ts

// Add to contextBridge.exposeInMainWorld:
whatsapp: {
  connect: (workspaceId: string, phoneNumber: string) =>
    ipcRenderer.invoke('whatsapp:connect', { workspaceId, phoneNumber }),

  disconnect: (workspaceId: string, phoneNumber?: string) =>
    ipcRenderer.invoke('whatsapp:disconnect', { workspaceId, phoneNumber }),

  getStatus: (workspaceId: string) =>
    ipcRenderer.invoke('whatsapp:status', { workspaceId }),

  listSessions: (workspaceId: string) =>
    ipcRenderer.invoke('whatsapp:list-sessions', { workspaceId }),

  sendMessage: (workspaceId: string, to: string, content: string) =>
    ipcRenderer.invoke('whatsapp:send-message', { workspaceId, to, content }),

  // Event listeners
  onQRCode: (callback: (data: { workspaceId: string; qrCode: string }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('whatsapp:qr-code', handler);
    return () => ipcRenderer.removeListener('whatsapp:qr-code', handler);
  },

  onAuthenticated: (callback: (data: { workspaceId: string; phoneNumber: string }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('whatsapp:authenticated', handler);
    return () => ipcRenderer.removeListener('whatsapp:authenticated', handler);
  },

  onDisconnected: (callback: (data: { workspaceId: string; phoneNumber: string }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('whatsapp:disconnected', handler);
    return () => ipcRenderer.removeListener('whatsapp:disconnected', handler);
  },

  onError: (callback: (data: { workspaceId: string; message: string }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('whatsapp:error', handler);
    return () => ipcRenderer.removeListener('whatsapp:error', handler);
  },
},
```

---

## Phase 3d: Renderer UI (P2)

**Why P2:** User-facing interface for connecting/managing WhatsApp.

### Files to Create

1. `apps/electron/src/renderer/components/whatsapp/WhatsAppSettings.tsx`
2. `apps/electron/src/renderer/components/whatsapp/QRCodeModal.tsx`
3. `apps/electron/src/renderer/atoms/whatsapp.ts`

### Implementation

#### Step 1: Jotai Atoms for State

```typescript
// apps/electron/src/renderer/atoms/whatsapp.ts

import { atom } from 'jotai';

export interface WhatsAppSession {
  phoneNumber: string;
  connectedAt: number;
}

export interface WhatsAppState {
  isConnecting: boolean;
  isConnected: boolean;
  qrCode: string | null;
  sessions: WhatsAppSession[];
  error: string | null;
}

export const whatsappStateAtom = atom<WhatsAppState>({
  isConnecting: false,
  isConnected: false,
  qrCode: null,
  sessions: [],
  error: null,
});

export const showQRModalAtom = atom(false);
```

#### Step 2: QR Code Modal Component

```tsx
// apps/electron/src/renderer/components/whatsapp/QRCodeModal.tsx

import { useEffect } from 'react';
import { useAtom } from 'jotai';
import QRCode from 'qrcode.react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { showQRModalAtom, whatsappStateAtom } from '@/atoms/whatsapp';

export function QRCodeModal() {
  const [showModal, setShowModal] = useAtom(showQRModalAtom);
  const [state] = useAtom(whatsappStateAtom);

  // Close modal when connected
  useEffect(() => {
    if (state.isConnected && showModal) {
      setShowModal(false);
    }
  }, [state.isConnected, showModal, setShowModal]);

  return (
    <Dialog open={showModal} onOpenChange={setShowModal}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect WhatsApp</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {state.qrCode ? (
            <>
              <QRCode value={state.qrCode} size={256} />
              <p className="text-sm text-muted-foreground text-center">
                Scan this QR code with WhatsApp on your phone.
                <br />
                Go to Settings → Linked Devices → Link a Device
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
              <span>Waiting for QR code...</span>
            </div>
          )}

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

#### Step 3: Settings Panel Component

```tsx
// apps/electron/src/renderer/components/whatsapp/WhatsAppSettings.tsx

import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { whatsappStateAtom, showQRModalAtom } from '@/atoms/whatsapp';
import { QRCodeModal } from './QRCodeModal';
import { useWorkspace } from '@/contexts/workspace-context';

export function WhatsAppSettings() {
  const { workspace } = useWorkspace();
  const [state, setState] = useAtom(whatsappStateAtom);
  const [, setShowQR] = useAtom(showQRModalAtom);
  const [phoneNumber, setPhoneNumber] = useState('');

  // Load existing sessions on mount
  useEffect(() => {
    if (workspace?.id) {
      window.electron.whatsapp.listSessions(workspace.id).then((result) => {
        if (result.success) {
          setState((s) => ({ ...s, sessions: result.sessions }));
        }
      });
    }
  }, [workspace?.id, setState]);

  // Set up event listeners
  useEffect(() => {
    const unsubQR = window.electron.whatsapp.onQRCode((data) => {
      if (data.workspaceId === workspace?.id) {
        setState((s) => ({ ...s, qrCode: data.qrCode }));
      }
    });

    const unsubAuth = window.electron.whatsapp.onAuthenticated((data) => {
      if (data.workspaceId === workspace?.id) {
        setState((s) => ({
          ...s,
          isConnected: true,
          isConnecting: false,
          qrCode: null,
          sessions: [...s.sessions, { phoneNumber: data.phoneNumber, connectedAt: Date.now() }],
        }));
      }
    });

    const unsubDisconnect = window.electron.whatsapp.onDisconnected((data) => {
      if (data.workspaceId === workspace?.id) {
        setState((s) => ({
          ...s,
          isConnected: false,
          sessions: s.sessions.filter((s) => s.phoneNumber !== data.phoneNumber),
        }));
      }
    });

    const unsubError = window.electron.whatsapp.onError((data) => {
      if (data.workspaceId === workspace?.id) {
        setState((s) => ({ ...s, error: data.message, isConnecting: false }));
      }
    });

    return () => {
      unsubQR();
      unsubAuth();
      unsubDisconnect();
      unsubError();
    };
  }, [workspace?.id, setState]);

  const handleConnect = async () => {
    if (!workspace?.id || !phoneNumber) return;

    setState((s) => ({ ...s, isConnecting: true, error: null }));
    setShowQR(true);

    const result = await window.electron.whatsapp.connect(workspace.id, phoneNumber);
    if (!result.success) {
      setState((s) => ({ ...s, error: result.error, isConnecting: false }));
    }
  };

  const handleDisconnect = async (phone: string) => {
    if (!workspace?.id) return;

    await window.electron.whatsapp.disconnect(workspace.id, phone);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp Integration</CardTitle>
          <CardDescription>
            Connect WhatsApp to receive and respond to messages via Vespr agents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Connected Sessions */}
          {state.sessions.length > 0 && (
            <div className="space-y-2">
              <Label>Connected Accounts</Label>
              {state.sessions.map((session) => (
                <div
                  key={session.phoneNumber}
                  className="flex items-center justify-between p-2 border rounded"
                >
                  <span>{session.phoneNumber}</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDisconnect(session.phoneNumber)}
                  >
                    Disconnect
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add New Connection */}
          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number</Label>
            <div className="flex gap-2">
              <Input
                id="phone"
                placeholder="+1234567890"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
              <Button onClick={handleConnect} disabled={state.isConnecting || !phoneNumber}>
                {state.isConnecting ? 'Connecting...' : 'Connect'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the phone number associated with your WhatsApp account.
            </p>
          </div>

          {/* Usage Instructions */}
          <div className="mt-4 p-3 bg-muted rounded text-sm">
            <p className="font-medium mb-1">How to use:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Add the connected number to a WhatsApp group</li>
              <li>Mention <code>@vespr</code> in your message to trigger the agent</li>
              <li>Use <code>@vespr /ask</code> to enable interactive mode</li>
              <li>Use <code>@vespr /allow-all</code> for full automation (use carefully!)</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <QRCodeModal />
    </>
  );
}
```

#### Step 4: Add to Settings Page

```tsx
// In apps/electron/src/renderer/pages/SettingsPage.tsx

import { WhatsAppSettings } from '@/components/whatsapp/WhatsAppSettings';

// Add WhatsAppSettings component to the settings page sections
```

---

## Security Considerations

### Critical Security Fixes Required

Before production use, address these security issues from the code review:

1. **Cap permissions at `ask` mode** - Never allow `allow-all` from WhatsApp
2. **Implement phone allowlist** - Only authorized numbers can use elevated permissions
3. **Add rate limiting** - Prevent abuse/spam
4. **Encrypt message queue** - Currently stored as plaintext

### Recommended Security Hardening

```typescript
// packages/shared/src/whatsapp/message-router.ts

// Add security configuration
interface WhatsAppSecurityConfig {
  maxPermissionLevel: 'safe' | 'ask'; // Never 'allow-all'
  allowedPhoneNumbers?: string[];      // Allowlist for elevated permissions
  rateLimitPerMinute: number;          // Max messages per sender per minute
}

// In getPermissionModeFromDirective:
private getPermissionModeFromDirective(
  directive: PermissionDirective,
  senderJid: string,
  config: WhatsAppSecurityConfig
): 'safe' | 'ask' | 'allow-all' {
  // SECURITY: Cap at configured max permission level
  if (directive === 'allow-all') {
    console.warn(`[Security] Blocked allow-all directive from ${senderJid}`);
    return config.maxPermissionLevel;
  }

  // SECURITY: Check allowlist for elevated permissions
  if (directive === 'ask' && config.allowedPhoneNumbers) {
    const phone = senderJid.split('@')[0];
    if (!config.allowedPhoneNumbers.includes(phone)) {
      return 'safe';
    }
  }

  return directive ?? 'safe';
}
```

---

## Implementation Order

```
Week 1:
├── Day 1-2: Phase 3a - CredentialManager methods + tests
├── Day 3-4: Phase 3c - IPC handlers + preload
└── Day 5: Integration testing

Week 2:
├── Day 1-3: Phase 3b - Baileys worker
├── Day 4-5: Phase 3d - Renderer UI
└── Testing & refinement

Week 3:
├── Security hardening
├── Documentation
└── Production deployment
```

---

## Testing Checklist

### Unit Tests
- [ ] CredentialManager WhatsApp methods
- [ ] IPC handler responses
- [ ] Worker message parsing

### Integration Tests
- [ ] Connect → QR → Authenticate flow
- [ ] Message receive → Route → Respond flow
- [ ] Disconnect → Credential deletion flow

### Manual Tests
- [ ] Scan QR code with phone
- [ ] Send message to group
- [ ] Verify agent response
- [ ] Disconnect and verify cleanup

---

## References

- [Baileys Documentation](https://github.com/WhiskeySockets/Baileys)
- [WhatsApp Business API Limits](https://developers.facebook.com/docs/whatsapp/api/rate-limits)
- [Vespr CredentialManager](packages/shared/src/credentials/manager.ts)
- [Vespr Scheduler Pattern](apps/electron/src/main/scheduler.ts)
