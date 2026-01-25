import { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  dailyReportModalOpenAtom,
  dailyReportFormAtom,
  dailyReportDraftAtom,
  reportGenerationStateAtom,
  reportSubmissionStateAtom,
  isGitHubConnectedAtom,
} from '@/atoms/orchestration';
import type { DailyReport } from '@vesper/shared/github';

interface DailyReportModalProps {
  workspaceId: string | null;
}

export function DailyReportModal({ workspaceId }: DailyReportModalProps) {
  const [isOpen, setIsOpen] = useAtom(dailyReportModalOpenAtom);
  const [form, setForm] = useAtom(dailyReportFormAtom);
  const [draft, setDraft] = useAtom(dailyReportDraftAtom);
  const [genState, setGenState] = useAtom(reportGenerationStateAtom);
  const [submitState, setSubmitState] = useAtom(reportSubmissionStateAtom);
  const [isConnected] = useAtom(isGitHubConnectedAtom);

  const [localForm, setLocalForm] = useState(form);

  useEffect(() => {
    setLocalForm(form);
  }, [form, isOpen]);

  const handleGenerateReport = async () => {
    if (!workspaceId) {
      setGenState({
        ...genState,
        error: 'No workspace selected',
      });
      return;
    }

    if (!localForm.repoOwner || !localForm.repoName) {
      setGenState({
        ...genState,
        error: 'Repository owner and name are required',
      });
      return;
    }

    try {
      setGenState({
        isLoading: true,
        error: null,
        progress: {
          current: 0,
          total: 3,
          message: 'Connecting to GitHub...',
        },
      });

      // Retrieve access token from credentials
      const { getCredentialManager } = await import('@vesper/shared/credentials');
      const credManager = getCredentialManager();
      const tokenCred = await credManager.get({
        type: 'github_access_token',
        workspaceId,
        sourceId: 'github', // Use constant sourceId for GitHub OAuth
      });

      if (!tokenCred?.value) {
        setGenState({
          isLoading: false,
          error: 'Not authenticated with GitHub. Please reconnect.',
          progress: null,
        });
        return;
      }

      const report = (await window.electronAPI.reportCreate({
        repoOwner: localForm.repoOwner,
        repoName: localForm.repoName,
        sinceDays: localForm.sinceDays,
        teamCapacity: localForm.teamCapacity,
        accessToken: tokenCred.value, // Pass the access token
      })) as DailyReport;

      setDraft(report);
      setGenState({
        isLoading: false,
        error: null,
        progress: null,
      });

      // Update form with generated data
      setForm({
        ...localForm,
        repoOwner: report.github?.repoOwner || localForm.repoOwner,
        repoName: report.github?.repoName || localForm.repoName,
      });
    } catch (error) {
      setGenState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to generate report',
        progress: null,
      });
    }
  };

  const handleSubmitReport = async () => {
    if (!draft) return;

    try {
      setSubmitState({
        isSubmitting: true,
        error: null,
        success: false,
      });

      const submitted = (await window.electronAPI.reportSubmit(draft)) as DailyReport;

      setDraft(submitted);
      setSubmitState({
        isSubmitting: false,
        error: null,
        success: true,
      });

      // Close after 2 seconds
      setTimeout(() => {
        setIsOpen(false);
        setSubmitState({
          isSubmitting: false,
          error: null,
          success: false,
        });
      }, 2000);
    } catch (error) {
      setSubmitState({
        isSubmitting: false,
        error: error instanceof Error ? error.message : 'Failed to submit report',
        success: false,
      });
    }
  };

  const issueCount = draft?.github?.issues.length ?? 0;
  const prCount = draft?.github?.pullRequests.length ?? 0;
  const teamCount = draft?.github?.teamMembers.length ?? 0;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Daily Report</DialogTitle>
          <DialogDescription>
            {draft ? 'Review and submit your daily report' : 'Create a new daily report'}
          </DialogDescription>
        </DialogHeader>

        {!isConnected && (
          <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
            Please connect GitHub first to create a report
          </div>
        )}

        <div className="space-y-4">
          {!draft ? (
            // Report generation form
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="repo-owner">Repository Owner</Label>
                  <Input
                    id="repo-owner"
                    placeholder="e.g., your-org"
                    value={localForm.repoOwner}
                    onChange={(e) =>
                      setLocalForm({ ...localForm, repoOwner: e.target.value })
                    }
                    disabled={genState.isLoading || !isConnected}
                  />
                </div>
                <div>
                  <Label htmlFor="repo-name">Repository Name</Label>
                  <Input
                    id="repo-name"
                    placeholder="e.g., my-project"
                    value={localForm.repoName}
                    onChange={(e) =>
                      setLocalForm({ ...localForm, repoName: e.target.value })
                    }
                    disabled={genState.isLoading || !isConnected}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="since-days">Days to Look Back</Label>
                <Input
                  id="since-days"
                  type="number"
                  min="1"
                  max="30"
                  value={localForm.sinceDays}
                  onChange={(e) =>
                    setLocalForm({
                      ...localForm,
                      sinceDays: parseInt(e.target.value, 10),
                    })
                  }
                  disabled={genState.isLoading || !isConnected}
                />
              </div>

              {genState.error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-200">
                  {genState.error}
                </div>
              )}

              {genState.progress && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {genState.progress.message}
                  </p>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{
                        width: `${(genState.progress.current / genState.progress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Report preview
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{issueCount}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {issueCount === 1 ? 'Issue' : 'Issues'}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{prCount}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {prCount === 1 ? 'Pull Request' : 'Pull Requests'}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-600">{teamCount}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {teamCount === 1 ? 'Team Member' : 'Team Members'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-600 dark:text-gray-400">
                <p>
                  Repository: {draft.github?.repoOwner}/{draft.github?.repoName}
                </p>
                <p>Generated: {new Date(draft.createdAt).toLocaleString()}</p>
              </div>

              {submitState.error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-200">
                  {submitState.error}
                </div>
              )}

              {submitState.success && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950 p-3 text-sm text-green-700 dark:text-green-200">
                  Report submitted successfully!
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setIsOpen(false);
              setDraft(null);
            }}
            disabled={genState.isLoading || submitState.isSubmitting}
          >
            Cancel
          </Button>

          {!draft ? (
            <Button
              onClick={handleGenerateReport}
              disabled={
                !isConnected ||
                !localForm.repoOwner ||
                !localForm.repoName ||
                genState.isLoading
              }
            >
              {genState.isLoading ? 'Generating...' : 'Generate Report'}
            </Button>
          ) : (
            <Button
              onClick={handleSubmitReport}
              disabled={submitState.isSubmitting}
            >
              {submitState.isSubmitting ? 'Submitting...' : 'Submit Report'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
