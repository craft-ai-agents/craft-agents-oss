/**
 * GitHub Settings Section
 *
 * Workspace-level GitHub integration settings
 * Allows connecting/disconnecting GitHub and configuring repository
 */

import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { Github, LogOut } from 'lucide-react';
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

  // Load GitHub connection status when component mounts
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

    loadGitHubStatus();
  }, [workspaceId, setConnection]);

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
