/**
 * Orchestration Atoms
 *
 * State management for GitHub integration, daily reports, and orchestration features.
 * Manages GitHub connection, report lifecycle, and triage state.
 */

import { atom } from 'jotai';
import type { GitHubConnectionStatus, DailyReport } from '@vespr/shared/github';

/**
 * GitHub connection status atom
 */
export const githubConnectionAtom = atom<GitHubConnectionStatus | null>(null);

/**
 * GitHub OAuth flow state
 */
export interface GitHubOAuthState {
  isInProgress: boolean;
  error: string | null;
  success: boolean;
}

/**
 * GitHub OAuth state atom
 */
export const githubOAuthStateAtom = atom<GitHubOAuthState>({
  isInProgress: false,
  error: null,
  success: false,
});

/**
 * Daily report form state
 */
export interface DailyReportFormState {
  repoOwner: string;
  repoName: string;
  sinceDays: number;
  teamCapacity?: {
    availableDevelopers: number;
    hoursPerDay: number;
  };
}

/**
 * Daily report form atom (for creating new reports)
 */
export const dailyReportFormAtom = atom<DailyReportFormState>({
  repoOwner: '',
  repoName: '',
  sinceDays: 1,
});

/**
 * Daily report draft atom (report being edited)
 */
export const dailyReportDraftAtom = atom<DailyReport | null>(null);

/**
 * Latest submitted report atom
 */
export const latestReportAtom = atom<DailyReport | null>(null);

/**
 * Report generation state
 */
export interface ReportGenerationState {
  isLoading: boolean;
  error: string | null;
  progress: {
    current: number;
    total: number;
    message: string;
  } | null;
}

/**
 * Report generation state atom
 */
export const reportGenerationStateAtom = atom<ReportGenerationState>({
  isLoading: false,
  error: null,
  progress: null,
});

/**
 * Daily report modal open state
 */
export const dailyReportModalOpenAtom = atom(false);

/**
 * GitHub connect modal open state
 */
export const githubConnectModalOpenAtom = atom(false);

/**
 * Report submission state
 */
export interface ReportSubmissionState {
  isSubmitting: boolean;
  error: string | null;
  success: boolean;
}

/**
 * Report submission state atom
 */
export const reportSubmissionStateAtom = atom<ReportSubmissionState>({
  isSubmitting: false,
  error: null,
  success: false,
});

/**
 * Derived atom: is GitHub connected?
 */
export const isGitHubConnectedAtom = atom((get) => {
  const status = get(githubConnectionAtom);
  return status?.isConnected ?? false;
});

/**
 * Derived atom: GitHub login name
 */
export const githubLoginAtom = atom((get) => {
  const status = get(githubConnectionAtom);
  return status?.login ?? null;
});

/**
 * Derived atom: can create report? (GitHub connected AND repo configured)
 */
export const canCreateReportAtom = atom((get) => {
  const isConnected = get(isGitHubConnectedAtom);
  const form = get(dailyReportFormAtom);
  return isConnected && form.repoOwner.length > 0 && form.repoName.length > 0;
});
