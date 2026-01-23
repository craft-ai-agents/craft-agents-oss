import { useEffect } from 'react';
import { useAtom } from 'jotai';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  githubConnectModalOpenAtom,
  githubOAuthStateAtom,
  githubConnectionAtom,
} from '@/atoms/orchestration';

export function GitHubConnectModal() {
  const [isOpen, setIsOpen] = useAtom(githubConnectModalOpenAtom);
  const [oauthState, setOAuthState] = useAtom(githubOAuthStateAtom);
  const [connection, setConnection] = useAtom(githubConnectionAtom);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onOrchestrationEvent) {
      return;
    }

    // Listen for orchestration events
    const unsubscribe = window.electronAPI.onOrchestrationEvent((event: any) => {
      if (event.type === 'connection-status-updated') {
        setConnection(event.status);
        setOAuthState({
          isInProgress: false,
          error: null,
          success: true,
        });
        // Close modal after successful connection
        setTimeout(() => setIsOpen(false), 1500);
      }
    });

    return unsubscribe;
  }, [setConnection, setOAuthState, setIsOpen]);

  const handleStartOAuth = async () => {
    try {
      setOAuthState({
        isInProgress: true,
        error: null,
        success: false,
      });

      const result = await window.electronAPI.githubStartOAuth();

      if (!result.success) {
        setOAuthState({
          isInProgress: false,
          error: result.error || 'OAuth failed',
          success: false,
        });
        return;
      }

      // Update connection status
      const status = {
        isConnected: true,
        login: result.login,
        email: result.email,
        connectedAt: Date.now(),
      };

      setConnection(status);
      setOAuthState({
        isInProgress: false,
        error: null,
        success: true,
      });

      // Close modal after 1.5 seconds
      setTimeout(() => setIsOpen(false), 1500);
    } catch (error) {
      setOAuthState({
        isInProgress: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect GitHub</DialogTitle>
          <DialogDescription>
            Authorize Vespr to access your GitHub repositories for daily reports
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {connection?.isConnected ? (
            <div className="space-y-3">
              <div className="flex items-center space-x-2 rounded-lg bg-green-50 dark:bg-green-950 p-3">
                <div className="flex-shrink-0">
                  <svg
                    className="h-5 w-5 text-green-600 dark:text-green-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Connected as <strong>{connection.login}</strong>
                  </p>
                </div>
              </div>

              <div className="text-xs text-gray-600 dark:text-gray-400">
                {connection.email && (
                  <p>Email: {connection.email}</p>
                )}
                {connection.connectedAt && (
                  <p>
                    Connected:{' '}
                    {new Date(connection.connectedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950 p-3">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Click below to authorize Vespr with your GitHub account. You
                  can revoke access anytime in GitHub Settings.
                </p>
              </div>

              {oauthState.error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950 p-3">
                  <p className="text-sm text-red-700 dark:text-red-200">
                    {oauthState.error}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={oauthState.isInProgress}
          >
            {connection?.isConnected ? 'Done' : 'Cancel'}
          </Button>

          {!connection?.isConnected && (
            <Button
              onClick={handleStartOAuth}
              disabled={oauthState.isInProgress}
              className="gap-2"
            >
              {oauthState.isInProgress && (
                <svg
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              {oauthState.isInProgress ? 'Authorizing...' : 'Authorize with GitHub'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
