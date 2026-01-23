/**
 * GitHub Settings Section
 *
 * Workspace-level GitHub integration settings
 * Allows connecting/disconnecting GitHub and configuring repository
 */

import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { Github, LogOut, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { useAppShellContext } from '@/context/AppShellContext';
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  githubConnectionAtom,
  githubConnectModalOpenAtom,
  dailyReportFormAtom,
} from '@/atoms/orchestration';

export function GitHubSettingsSection() {
  const { activeWorkspaceId: workspaceId } = useAppShellContext();
  const [connection, setConnection] = useAtom(githubConnectionAtom);
  const [, setConnectModalOpen] = useAtom(githubConnectModalOpenAtom);
  const [reportForm, setReportForm] = useAtom(dailyReportFormAtom);

  // OAuth Credentials state
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);

  // Load GitHub connection status and credential status when component mounts
  useEffect(() => {
    const loadGitHubStatus = async () => {
      if (!workspaceId) return;
      try {
        const status = await window.electronAPI.githubGetStatus(workspaceId);
        if (status) {
          setConnection(status);
        }
      } catch (error) {
        console.error('Failed to load GitHub status:', error);
      }
    };

    const loadCredentialStatus = async () => {
      try {
        const hasCreds = await window.electronAPI.githubHasOAuthCredentials();
        setHasCredentials(hasCreds);
      } catch (error) {
        console.error('Failed to load credential status:', error);
      }
    };

    loadGitHubStatus();
    loadCredentialStatus();
  }, [workspaceId, setConnection]);

  const handleSaveCredentials = async () => {
    setIsSaving(true);
    setCredError(null);

    const result = await window.electronAPI.githubSetOAuthCredentials(clientId, clientSecret);

    if (result.success) {
      setHasCredentials(true);
      // Clear from memory
      setClientId('');
      setClientSecret('');
    } else {
      setCredError(result.error || 'Failed to save');
    }
    setIsSaving(false);
  };

  const handleClearCredentials = async () => {
    if (!confirm('Clear GitHub OAuth credentials?')) return;

    const result = await window.electronAPI.githubSetOAuthCredentials(null, null);
    if (result.success) {
      setHasCredentials(false);
    }
  };

  const handleDisconnect = async () => {
    if (!workspaceId) return;

    try {
      const status = {
        isConnected: false,
        connectedAt: undefined,
      };
      await window.electronAPI.githubSetStatus(workspaceId, status);
      setConnection(status);
      setReportForm({ repoOwner: '', repoName: '', sinceDays: 1 });
    } catch (error) {
      console.error('Failed to disconnect GitHub:', error);
    }
  };

  return (
    <SettingsSection title="GitHub Integration">
      {/* OAuth App Credentials */}
      <SettingsCard>
        <div className="p-4 space-y-4">
          <div>
            <h4 className="text-sm font-medium">GitHub OAuth App</h4>
            <p className="text-xs text-muted-foreground">
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Create OAuth App <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>

          {hasCredentials ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Credentials configured</span>
              <Button variant="outline" size="sm" onClick={handleClearCredentials}>
                Clear
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Client ID</Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Ov23li..."
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Client Secret</Label>
                <div className="relative">
                  <Input
                    type={showSecret ? 'text' : 'password'}
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="Enter client secret"
                    className="font-mono text-sm pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {credError && <p className="text-xs text-destructive">{credError}</p>}
              <Button
                size="sm"
                onClick={handleSaveCredentials}
                disabled={!clientId || !clientSecret || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Credentials'}
              </Button>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Connection Status */}
      <SettingsCard>
        {connection?.isConnected ? (
          <>
            {/* Connected status */}
            <SettingsRow
              label="GitHub Account"
              description={`Connected as ${connection.login}`}
              action={
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <div className="w-2 h-2 rounded-full bg-green-600 dark:bg-green-400" />
                    Connected
                  </div>
                </div>
              }
            >
              <div className="flex items-center gap-2">
                <Github className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </div>
            </SettingsRow>

            {/* Repository configuration */}
            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Daily Report Configuration
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="gh-owner" className="text-xs">
                      Repository Owner
                    </Label>
                    <Input
                      id="gh-owner"
                      placeholder="e.g., your-org"
                      value={reportForm.repoOwner}
                      onChange={(e) =>
                        setReportForm({
                          ...reportForm,
                          repoOwner: e.target.value,
                        })
                      }
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="gh-repo" className="text-xs">
                      Repository Name
                    </Label>
                    <Input
                      id="gh-repo"
                      placeholder="e.g., my-project"
                      value={reportForm.repoName}
                      onChange={(e) =>
                        setReportForm({
                          ...reportForm,
                          repoName: e.target.value,
                        })
                      }
                      className="text-sm"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="gh-days" className="text-xs">
                    Look Back (Days)
                  </Label>
                  <Input
                    id="gh-days"
                    type="number"
                    min="1"
                    max="30"
                    value={reportForm.sinceDays}
                    onChange={(e) =>
                      setReportForm({
                        ...reportForm,
                        sinceDays: parseInt(e.target.value, 10),
                      })
                    }
                    className="text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Disconnect button */}
            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect GitHub
              </Button>
            </div>
          </>
        ) : (
          // Not connected
          <SettingsRow
            label="GitHub Account"
            description="Connect your GitHub account to enable daily reports"
            action={
              <Button
                size="sm"
                onClick={() => setConnectModalOpen(true)}
              >
                <Github className="w-4 h-4 mr-2" />
                Connect
              </Button>
            }
          />
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
