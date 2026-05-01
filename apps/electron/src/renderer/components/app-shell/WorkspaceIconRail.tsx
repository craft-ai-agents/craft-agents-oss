import * as React from "react";
import { useTranslation } from "react-i18next";
import { Cloud, CloudOff, FolderPlus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useSetAtom } from "jotai";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay";
import { CrossfadeAvatar } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@craft-agent/ui";
import { WorkspaceCreationScreen } from "@/components/workspace";
import { waitForTransportConnected } from "@/lib/transport-wait";
import { useTransportConnectionState } from "@/hooks/useTransportConnectionState";
import { useWorkspaceIcons } from "@/hooks/useWorkspaceIcon";
import type { Workspace } from "../../../shared/types";

interface WorkspaceIconRailProps {
	workspaces: Workspace[];
	activeWorkspaceId: string | null;
	onSelect: (
		workspaceId: string,
		openInNewWindow?: boolean,
	) => void | Promise<void>;
	onWorkspaceCreated?: (workspace: Workspace) => void;
	/** workspaceId -> has unread */
	workspaceUnreadMap?: Record<string, boolean>;
	className?: string;
}

/**
 * WorkspaceIconRail - Discord-style vertical workspace selector.
 *
 * Renders one icon per workspace on the far left of the app, with a tooltip
 * for the workspace name and a selected background for the active workspace.
 */
export function WorkspaceIconRail({
	workspaces,
	activeWorkspaceId,
	onSelect,
	onWorkspaceCreated,
	workspaceUnreadMap,
	className,
}: WorkspaceIconRailProps) {
	const { t } = useTranslation();
	const [showCreationScreen, setShowCreationScreen] = React.useState(false);
	const [reconnectTarget, setReconnectTarget] =
		React.useState<Workspace | null>(null);
	const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom);
	const workspaceIconMap = useWorkspaceIcons(workspaces);
	const connectionState = useTransportConnectionState();
	const isRemote = connectionState?.mode === "remote";

	const [remoteHealthMap, setRemoteHealthMap] = React.useState<
		Map<string, "ok" | "error" | "checking">
	>(new Map());
	const healthCheckAbort = React.useRef<AbortController | null>(null);

	const isRemoteDisconnected = React.useCallback(
		(workspaceId: string) => {
			const workspace = workspaces.find((w) => w.id === workspaceId);
			if (!workspace?.remoteServer) return false;

			if (workspaceId === activeWorkspaceId) {
				return (
					isRemote &&
					connectionState?.status !== "connected" &&
					connectionState?.status !== "connecting" &&
					connectionState?.status !== "idle"
				);
			}

			return remoteHealthMap.get(workspaceId) === "error";
		},
		[
			activeWorkspaceId,
			connectionState?.status,
			isRemote,
			remoteHealthMap,
			workspaces,
		],
	);

	const checkRemoteHealth = React.useCallback(() => {
		healthCheckAbort.current?.abort();
		const abort = new AbortController();
		healthCheckAbort.current = abort;

		const remoteWorkspaces = workspaces.filter(
			(w) => w.remoteServer && w.id !== activeWorkspaceId,
		);
		if (remoteWorkspaces.length === 0) return;

		setRemoteHealthMap((prev) => {
			const next = new Map(prev);
			for (const ws of remoteWorkspaces) next.set(ws.id, "checking");
			return next;
		});

		for (const ws of remoteWorkspaces) {
			window.electronAPI
				.testRemoteConnection(ws.remoteServer!.url, ws.remoteServer!.token)
				.then((result) => {
					if (abort.signal.aborted) return;
					setRemoteHealthMap((prev) =>
						new Map(prev).set(ws.id, result.ok ? "ok" : "error"),
					);
				})
				.catch(() => {
					if (abort.signal.aborted) return;
					setRemoteHealthMap((prev) => new Map(prev).set(ws.id, "error"));
				});
		}
	}, [activeWorkspaceId, workspaces]);

	React.useEffect(() => {
		checkRemoteHealth();
		return () => healthCheckAbort.current?.abort();
	}, [checkRemoteHealth]);

	const getDisconnectTooltip = React.useCallback(
		(workspaceId: string) => {
			if (workspaceId === activeWorkspaceId && connectionState?.lastError) {
				const { kind } = connectionState.lastError;
				if (kind === "auth") return t("toast.authenticationFailed");
				if (kind === "timeout") return t("toast.serverUnreachable");
				if (kind === "network") return t("toast.serverUnreachable");
			}
			return t("toast.disconnected");
		},
		[activeWorkspaceId, connectionState?.lastError, t],
	);

	const handleNewWorkspace = React.useCallback(() => {
		setShowCreationScreen(true);
		setFullscreenOverlayOpen(true);
	}, [setFullscreenOverlayOpen]);

	const handleWorkspaceCreated = React.useCallback(
		(workspace: Workspace) => {
			toast.success(t("toast.createdWorkspace", { name: workspace.name }));
			onWorkspaceCreated?.(workspace);
			onSelect(workspace.id);
		},
		[onSelect, onWorkspaceCreated, t],
	);

	const handleCloseCreationScreen = React.useCallback(() => {
		setShowCreationScreen(false);
		setReconnectTarget(null);
		setFullscreenOverlayOpen(false);
	}, [setFullscreenOverlayOpen]);

	const handleReconnectWorkspace = React.useCallback(
		async (
			workspaceId: string,
			remoteServer: { url: string; token: string; remoteWorkspaceId: string },
		) => {
			await window.electronAPI.updateWorkspaceRemoteServer(
				workspaceId,
				remoteServer,
			);

			if (workspaceId === activeWorkspaceId) {
				await window.electronAPI.reconnectTransport();
				await waitForTransportConnected(window.electronAPI);
			} else {
				await Promise.resolve(onSelect(workspaceId));
				await waitForTransportConnected(window.electronAPI);
			}

			handleCloseCreationScreen();
			toast.success(t("toast.workspaceReconnected"));
		},
		[activeWorkspaceId, handleCloseCreationScreen, onSelect, t],
	);

	const handleWorkspaceClick = React.useCallback(
		(workspace: Workspace, event: React.MouseEvent<HTMLButtonElement>) => {
			if (workspace.id === activeWorkspaceId) return;

			const disconnected = isRemoteDisconnected(workspace.id);

			if (disconnected && workspace.remoteServer) {
				setReconnectTarget(workspace);
				setShowCreationScreen(true);
				setFullscreenOverlayOpen(true);
				return;
			}

			if (disconnected) return;

			const openInNewWindow = event.metaKey || event.ctrlKey;
			onSelect(workspace.id, openInNewWindow);
		},
		[
			activeWorkspaceId,
			isRemoteDisconnected,
			onSelect,
			setFullscreenOverlayOpen,
		],
	);

	return (
		<>
			<AnimatePresence>
				{showCreationScreen && (
					<WorkspaceCreationScreen
						onWorkspaceCreated={handleWorkspaceCreated}
						onClose={handleCloseCreationScreen}
						reconnectWorkspace={reconnectTarget ?? undefined}
						onReconnectWorkspace={handleReconnectWorkspace}
					/>
				)}
			</AnimatePresence>

			<aside
				className={cn(
					"h-full w-[58px] shrink-0 border-r border-border/40 bg-background/40 titlebar-no-drag",
					"flex flex-col items-center overflow-y-auto overflow-x-hidden px-2 pb-2",
					className,
				)}
				aria-label={t("settings.appearance.workspaceIconRail")}
			>
				<div className="flex w-full flex-col items-center gap-2 pt-2">
					{workspaces.map((workspace) => {
						const selected = workspace.id === activeWorkspaceId;
						const disconnected = isRemoteDisconnected(workspace.id);
						const title = disconnected
							? `${workspace.name} — ${getDisconnectTooltip(workspace.id)}`
							: workspace.name;

						return (
							<Tooltip key={workspace.id}>
								<TooltipTrigger asChild>
									<button
										type="button"
										aria-label={workspace.name}
										aria-current={selected ? "page" : undefined}
										onMouseEnter={() => {
											if (
												workspace.remoteServer &&
												workspace.id !== activeWorkspaceId
											)
												checkRemoteHealth();
										}}
										onClick={(event) => handleWorkspaceClick(workspace, event)}
										className={cn(
											"group relative flex h-11 w-11 items-center justify-center rounded-[14px] transition-colors duration-150",
											"focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
											selected ? "bg-foreground/12" : "hover:bg-foreground/7",
											disconnected && "opacity-60",
										)}
									>
										<span
											className={cn(
												"absolute left-[-8px] top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent transition-opacity duration-150",
												selected
													? "opacity-100"
													: "opacity-0 group-hover:opacity-40",
											)}
											aria-hidden="true"
										/>
										<CrossfadeAvatar
											src={workspaceIconMap.get(workspace.id)}
											alt={workspace.name}
											className={cn(
												"h-8 w-8 rounded-full ring-1 ring-border/60 transition-transform duration-150",
												selected && "ring-2 ring-accent/55",
											)}
											fallbackClassName="bg-muted text-xs font-medium rounded-full"
											fallback={workspace.name.charAt(0)}
										/>
										{workspace.remoteServer &&
											(disconnected ? (
												<CloudOff className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full bg-background p-0.5 text-destructive" />
											) : (
												<Cloud className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full bg-background p-0.5 text-muted-foreground" />
											))}
										{workspaceUnreadMap?.[workspace.id] && !selected && (
											<span
												className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent"
												aria-hidden="true"
											/>
										)}
									</button>
								</TooltipTrigger>
								<TooltipContent side="right" sideOffset={8}>
									{title}
								</TooltipContent>
							</Tooltip>
						);
					})}
				</div>

				<div className="mt-1 h-px w-8 shrink-0 bg-border/60" />

				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={t("workspace.addWorkspace")}
							onClick={handleNewWorkspace}
							className="flex h-11 w-11 items-center justify-center rounded-[14px] text-muted-foreground transition-colors duration-150 hover:bg-foreground/7 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
						>
							<FolderPlus className="h-5 w-5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right" sideOffset={8}>
						{t("workspace.addWorkspace")}
					</TooltipContent>
				</Tooltip>
			</aside>
		</>
	);
}
