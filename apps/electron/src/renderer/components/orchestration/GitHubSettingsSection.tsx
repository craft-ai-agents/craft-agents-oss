/**
 * GitHub Settings Section
 *
 * Workspace-level GitHub integration settings
 * Allows connecting/disconnecting GitHub and configuring repository
 */

import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { Github, LogOut, Eye, EyeOff, ExternalLink, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, Info, Shield, Check, XCircle } from 'lucide-react';
import { useAppShellContext } from '@/context/AppShellContext';
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

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

  const handleTestCredentials = async () => {
    setIsTesting(true);
    setTestResult(null);
    setCredError(null);

    const result = await window.electronAPI.githubTestCredentials(clientId, clientSecret);
    setTestResult(result);
    setIsTesting(false);
  };

  const handleSaveCredentials = async () => {
    setIsSaving(true);
    setCredError(null);

    const result = await window.electronAPI.githubSetOAuthCredentials(clientId, clientSecret);

    if (result.success) {
      setHasCredentials(true);
      setTestResult(null);
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
      // Clear access token from credentials
      const { getCredentialManager } = await import('@vesper/shared/credentials');
      const credManager = getCredentialManager();
      await credManager.delete({
        type: 'github_access_token',
        workspaceId,
        sourceId: 'github', // Use constant sourceId for GitHub OAuth
      });

      // Clear connection status
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

  // Determine current setup status
  const getSetupStatus = () => {
    if (!hasCredentials) return 'not_configured';
    if (!connection?.isConnected) return 'configured';
    return 'connected';
  };

  const setupStatus = getSetupStatus();

  return (
    <TooltipProvider>
      <SettingsSection title="GitHub Integration">
        {/* Overall Setup Status */}
        <SettingsCard>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Github className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <div>
                  <h4 className="text-sm font-medium">Connection Status</h4>
                  <p className="text-xs text-muted-foreground">
                    {setupStatus === 'connected' && `Connected as ${connection?.login}`}
                    {setupStatus === 'configured' && 'OAuth credentials saved'}
                    {setupStatus === 'not_configured' && 'Setup required to use GitHub features'}
                  </p>
                </div>
              </div>
              <div>
                {setupStatus === 'connected' && (
                  <Badge className="bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900">
                    <Check className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                )}
                {setupStatus === 'configured' && (
                  <Badge className="bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900">
                    <Shield className="h-3 w-3 mr-1" />
                    Configured
                  </Badge>
                )}
                {setupStatus === 'not_configured' && (
                  <Badge className="bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-800">
                    <XCircle className="h-3 w-3 mr-1" />
                    Not Configured
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </SettingsCard>

        {/* Step 1: OAuth App Credentials */}
        <SettingsCard>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                  1
                </div>
                <h4 className="text-sm font-medium">Configure OAuth App Credentials</h4>
              </div>
              {hasCredentials && (
                <Badge variant="secondary">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Completed
                </Badge>
              )}
            </div>

            {/* Collapsible Setup Instructions */}
            <Collapsible open={showInstructions} onOpenChange={setShowInstructions}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between text-xs text-muted-foreground hover:text-foreground"
                >
                  <span className="flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    How to setup your OAuth App
                  </span>
                  {showInstructions ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <AnimatedCollapsibleContent isOpen={showInstructions}>
                <div className="mt-3 p-3 bg-muted/50 rounded-md space-y-2 text-xs">
                  <p className="font-medium">Follow these steps:</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
                    <li>
                      Visit{' '}
                      <a
                        href="https://github.com/settings/developers"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        GitHub Developer Settings <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                    <li>Click "New OAuth App" (or "Register a new application")</li>
                    <li>Fill in the form:
                      <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                        <li>Application name: e.g., "Vesper Local"</li>
                        <li>Homepage URL: <code className="px-1 py-0.5 bg-background rounded">http://localhost</code></li>
                        <li>Authorization callback URL: <code className="px-1 py-0.5 bg-background rounded">vesper://auth/github/callback</code></li>
                      </ul>
                    </li>
                    <li>Click "Register application"</li>
                    <li>Copy the <strong>Client ID</strong> (displayed on the page)</li>
                    <li>Click "Generate a new client secret" and copy the <strong>Client Secret</strong></li>
                    <li>Paste both values into the form below</li>
                  </ol>
                  <div className="flex items-start gap-1.5 mt-2 p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 rounded">
                    <Shield className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <span>Your credentials are encrypted with AES-256-GCM and stored securely on your device.</span>
                  </div>
                </div>
              </AnimatedCollapsibleContent>
            </Collapsible>

            {hasCredentials ? (
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm text-muted-foreground">OAuth credentials configured and saved</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleClearCredentials}>
                  Clear
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <Label className="text-xs">Client ID</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Your GitHub OAuth App's public identifier</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    value={clientId}
                    onChange={(e) => {
                      setClientId(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="Ov23li..."
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <Label className="text-xs">Client Secret</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Keep this secret! Never share it publicly.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="relative">
                    <Input
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecret}
                      onChange={(e) => {
                        setClientSecret(e.target.value);
                        setTestResult(null);
                      }}
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

                {/* Test Result Feedback */}
                {testResult && (
                  <div
                    className={`flex items-start gap-2 p-3 rounded-md text-sm ${
                      testResult.success
                        ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400'
                        : 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400'
                    }`}
                  >
                    {testResult.success ? (
                      <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <div>{testResult.success ? testResult.message : testResult.error}</div>
                      {testResult.success && (
                        <div className="text-xs mt-1 opacity-80">Ready to save these credentials.</div>
                      )}
                      {!testResult.success && (
                        <div className="text-xs mt-1 opacity-80">
                          Double-check your Client ID and Secret match your GitHub OAuth App.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {credError && (
                  <div className="flex items-start gap-2 p-3 rounded-md text-sm bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <div>{credError}</div>
                      <div className="text-xs mt-1 opacity-80">Please try again or check your credentials.</div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestCredentials}
                    disabled={!clientId || !clientSecret || isTesting}
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      'Test Connection'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveCredentials}
                    disabled={!clientId || !clientSecret || isSaving || (testResult && !testResult.success)}
                  >
                    {isSaving ? 'Saving...' : 'Save Credentials'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground flex items-start gap-1">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>
                    These are your <strong>OAuth App credentials</strong>, not your GitHub account connection.
                    You'll connect your account in the next step.
                  </span>
                </p>
              </div>
            )}
          </div>
        </SettingsCard>

        {/* Step 2: Connect GitHub Account */}
        <SettingsCard>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                  2
                </div>
                <h4 className="text-sm font-medium">Connect GitHub Account</h4>
              </div>
              {connection?.isConnected && (
                <Badge variant="secondary">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Completed
                </Badge>
              )}
            </div>

            {!hasCredentials && (
              <div className="flex items-start gap-2 p-3 rounded-md text-sm bg-muted/50 text-muted-foreground">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div>Complete Step 1 first</div>
                  <div className="text-xs mt-1">Configure your OAuth app credentials before connecting your account.</div>
                </div>
              </div>
            )}

            {hasCredentials && !connection?.isConnected && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Click the button below to authenticate with GitHub. You'll be redirected to GitHub to authorize Vesper.
                </p>
                <Button
                  size="sm"
                  onClick={() => setConnectModalOpen(true)}
                >
                  <Github className="w-4 h-4 mr-2" />
                  Connect GitHub Account
                </Button>
              </div>
            )}

            {connection?.isConnected && (
              <>
                <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/50 rounded-md">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <div>
                      <div className="text-sm font-medium text-green-700 dark:text-green-400">
                        Connected as {connection.login}
                      </div>
                      <div className="text-xs text-green-600/80 dark:text-green-500/80">
                        Authenticated on {connection.connectedAt ? new Date(connection.connectedAt).toLocaleDateString() : 'recently'}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                    className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                </div>

                {/* Step 3: Configure Repository (shown only when connected) */}
                <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                      3
                    </div>
                    <h4 className="text-sm font-medium">Configure Repository (Optional)</h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Set a default repository for daily reports and other GitHub features.
                  </p>
                  <div className="space-y-3">
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
              </>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </TooltipProvider>
  );
}
