import * as React from "react";
import { useTranslation } from "react-i18next";
import {
	BookOpen,
	Cloud,
	CloudOff,
	ExternalLink,
	FolderPlus,
	Link2,
	Plus,
	StickyNote,
	Trash2,
	X,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useSetAtom } from "jotai";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay";
import { CrossfadeAvatar } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@craft-agent/ui";
import { WorkspaceCreationScreen, type WorkspaceCreationSuccess } from "@/components/workspace";
import { waitForTransportConnected } from "@/lib/transport-wait";
import { useTransportConnectionState } from "@/hooks/useTransportConnectionState";
import { useWorkspaceIcons } from "@/hooks/useWorkspaceIcon";
import {
	TRAFFIC_LIGHT_SAFE_TOP,
	WORKSPACE_ICON_RAIL_WIDTH,
} from "@/components/app-shell/workspace-rail";
import {
	createRailLink,
	loadRailLinks,
	saveRailLinks,
	type RailLink,
	type RailLinkKind,
} from "@/lib/rail-links";
import { navigate, routes } from "@/lib/navigate";
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
 * Below workspaces: user-configurable custom nav links (knowledge / notes / URL).
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

	const [railLinks, setRailLinks] = React.useState<RailLink[]>(() =>
		loadRailLinks(activeWorkspaceId),
	);
	const [showAddLink, setShowAddLink] = React.useState(false);
	const [draftLabel, setDraftLabel] = React.useState("");
	const [draftKind, setDraftKind] = React.useState<RailLinkKind>("knowledge");
	const [draftTarget, setDraftTarget] = React.useState("");

	React.useEffect(() => {
		setRailLinks(loadRailLinks(activeWorkspaceId));
		setShowAddLink(false);
	}, [activeWorkspaceId]);

	const persistLinks = React.useCallback(
		(next: RailLink[]) => {
			setRailLinks(next);
			if (activeWorkspaceId) saveRailLinks(activeWorkspaceId, next);
		},
		[activeWorkspaceId],
	);

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
		({ workspace, activation }: WorkspaceCreationSuccess) => {
			setShowCreationScreen(false);
			setFullscreenOverlayOpen(false);
			toast.success(t("toast.createdWorkspace", { name: workspace.name }));
			onWorkspaceCreated?.(workspace);
			void onSelect(activation?.activeWorkspaceId ?? workspace.id);
		},
		[onSelect, onWorkspaceCreated, setFullscreenOverlayOpen, t],
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

	const handleRailLinkClick = React.useCallback(
		(link: RailLink) => {
			if (link.kind === "knowledge") {
				navigate(routes.view.knowledge());
				return;
			}
			if (link.kind === "notes") {
				navigate(routes.view.notes());
				return;
			}
			const url = link.target?.trim();
			if (!url) {
				toast.error(t("workspaceRail.linkMissingUrl"));
				return;
			}
			const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
			void window.electronAPI.openUrl(href);
		},
		[t],
	);

	const handleAddLink = React.useCallback(() => {
		if (!activeWorkspaceId) return;
		const label = draftLabel.trim();
		if (!label) {
			toast.error(t("workspaceRail.linkLabelRequired"));
			return;
		}
		if (draftKind === "external" && !draftTarget.trim()) {
			toast.error(t("workspaceRail.linkMissingUrl"));
			return;
		}
		const link = createRailLink({
			label,
			kind: draftKind,
			target: draftTarget.trim() || undefined,
		});
		persistLinks([...railLinks, link]);
		setDraftLabel("");
		setDraftTarget("");
		setDraftKind("knowledge");
		setShowAddLink(false);
	}, [
		activeWorkspaceId,
		draftKind,
		draftLabel,
		draftTarget,
		persistLinks,
		railLinks,
		t,
	]);

	const handleRemoveLink = React.useCallback(
		(id: string) => {
			persistLinks(railLinks.filter((l) => l.id !== id));
		},
		[persistLinks, railLinks],
	);

	const linkIcon = (kind: RailLinkKind) => {
		if (kind === "knowledge") return BookOpen;
		if (kind === "notes") return StickyNote;
		return ExternalLink;
	};

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
					"h-full shrink-0 border-r border-border/40 bg-background/40 titlebar-no-drag",
					"flex flex-col items-center overflow-y-auto overflow-x-hidden px-2 pb-2",
					className,
				)}
				style={{ width: WORKSPACE_ICON_RAIL_WIDTH }}
				aria-label={t("settings.appearance.workspaceIconRail")}
			>
				<div
					className="flex w-full flex-col items-center gap-2"
					style={{ paddingTop: TRAFFIC_LIGHT_SAFE_TOP }}
				>
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

				{/* Custom rail links */}
				{activeWorkspaceId && (
					<div className="mt-1 flex w-full flex-col items-center gap-1.5">
						{railLinks.map((link) => {
							const Icon = linkIcon(link.kind);
							return (
								<Tooltip key={link.id}>
									<TooltipTrigger asChild>
										<div className="group relative">
											<button
												type="button"
												aria-label={link.label}
												onClick={() => handleRailLinkClick(link)}
												className="flex h-10 w-10 items-center justify-center rounded-[12px] text-muted-foreground transition-colors duration-150 hover:bg-foreground/7 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											>
												<Icon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
											</button>
											<button
												type="button"
												aria-label={t("workspaceRail.removeLink")}
												onClick={(e) => {
													e.stopPropagation();
													handleRemoveLink(link.id);
												}}
												className="absolute -right-0.5 -top-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-background text-muted-foreground shadow-minimal ring-1 ring-border/60 group-hover:flex hover:text-destructive"
											>
												<Trash2 className="h-2.5 w-2.5" />
											</button>
										</div>
									</TooltipTrigger>
									<TooltipContent side="right" sideOffset={8}>
										{link.label}
									</TooltipContent>
								</Tooltip>
							);
						})}

						{showAddLink ? (
							<div className="w-full rounded-xl border border-border/50 bg-background/90 p-2 shadow-minimal">
								<div className="mb-1.5 flex items-center justify-between gap-1">
									<span className="text-[10px] font-medium text-muted-foreground">
										{t("workspaceRail.addLink")}
									</span>
									<button
										type="button"
										onClick={() => setShowAddLink(false)}
										className="rounded p-0.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
										aria-label={t("common.cancel")}
									>
										<X className="h-3 w-3" />
									</button>
								</div>
								<input
									value={draftLabel}
									onChange={(e) => setDraftLabel(e.target.value)}
									placeholder={t("workspaceRail.linkLabelPlaceholder")}
									className="mb-1.5 w-full rounded-md border border-border/50 bg-background px-1.5 py-1 text-[11px] outline-none focus:border-accent/50"
								/>
								<select
									value={draftKind}
									onChange={(e) =>
										setDraftKind(e.target.value as RailLinkKind)
									}
									className="mb-1.5 w-full rounded-md border border-border/50 bg-background px-1.5 py-1 text-[11px] outline-none"
								>
									<option value="knowledge">
										{t("workspaceRail.kindKnowledge")}
									</option>
									<option value="notes">{t("workspaceRail.kindNotes")}</option>
									<option value="external">
										{t("workspaceRail.kindExternal")}
									</option>
								</select>
								{(draftKind === "external" || draftKind === "notes") && (
									<input
										value={draftTarget}
										onChange={(e) => setDraftTarget(e.target.value)}
										placeholder={
											draftKind === "external"
												? t("workspaceRail.linkUrlPlaceholder")
												: t("workspaceRail.notesPathPlaceholder")
										}
										className="mb-1.5 w-full rounded-md border border-border/50 bg-background px-1.5 py-1 text-[11px] outline-none focus:border-accent/50"
									/>
								)}
								<button
									type="button"
									onClick={handleAddLink}
									className="flex w-full items-center justify-center gap-1 rounded-md bg-accent/15 px-1.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/25"
								>
									<Link2 className="h-3 w-3" />
									{t("common.save")}
								</button>
							</div>
						) : (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										aria-label={t("workspaceRail.addLink")}
										onClick={() => setShowAddLink(true)}
										className="flex h-10 w-10 items-center justify-center rounded-[12px] text-muted-foreground transition-colors duration-150 hover:bg-foreground/7 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<Plus className="h-4 w-4" />
									</button>
								</TooltipTrigger>
								<TooltipContent side="right" sideOffset={8}>
									{t("workspaceRail.addLink")}
								</TooltipContent>
							</Tooltip>
						)}
					</div>
				)}

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
