#!/usr/bin/env bun
/**
 * Linear CLI for the rpi-mdp team and MDP project.
 *
 * Usage:
 *   bun .afk/linear.ts viewer
 *   bun .afk/linear.ts resolve
 *   bun .afk/linear.ts create --title <t> [--desc <d>] [--label <label-id>]
 *   bun .afk/linear.ts read <RPI-N>
 *   bun .afk/linear.ts list [--label <name>] [--all]
 *   bun .afk/linear.ts label <issue-id> <label-id>
 *   bun .afk/linear.ts unlabel <issue-id> <label-id>
 *   bun .afk/linear.ts comment <issue-id> --body <text>
 *   bun .afk/linear.ts close <issue-id>
 *
 * All output is JSON.
 */

import { LinearClient } from "@linear/sdk";

const TEAM_KEY = "RPI";
const PROJECT_NAME = "MDP";

// Bun auto-loads .env from the project root
const LINEAR_API_KEY = Bun.env.LINEAR_API_KEY;
if (!LINEAR_API_KEY) {
    console.error("LINEAR_API_KEY is not set (add it to .env or export it)");
    process.exit(1);
}

const linear = new LinearClient({ apiKey: LINEAR_API_KEY });

// ── arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(args: string[]): { flags: Record<string, string>; positional: string[] } {
    const flags: Record<string, string> = {};
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            const key = args[i].slice(2);
            const next = args[i + 1];
            if (next === undefined || next.startsWith("--")) {
                flags[key] = "true";
            } else {
                flags[key] = next;
                i++;
            }
        } else {
            positional.push(args[i]);
        }
    }
    return { flags, positional };
}

function print(data: unknown) {
    console.log(JSON.stringify(data, null, 2));
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolveDefaults() {
    const [viewer, teams, projects] = await Promise.all([
        linear.viewer,
        linear.teams(),
        linear.projects(),
    ]);
    const team = teams.nodes.find(t => t.key === TEAM_KEY);
    const project = projects.nodes.find(p => p.name === PROJECT_NAME);
    if (!team) throw new Error(`Team '${TEAM_KEY}' not found`);
    if (!project) throw new Error(`Project '${PROJECT_NAME}' not found`);
    return { viewer, teamId: team.id, projectId: project.id };
}

async function findIssueByIdentifier(identifier: string) {
    const num = parseInt(identifier.split("-").pop()!);
    if (isNaN(num)) throw new Error(`Invalid identifier: ${identifier}`);
    const results = await linear.issues({
        filter: { team: { key: { eq: TEAM_KEY } }, number: { eq: num } },
    });
    const issue = results.nodes[0];
    if (!issue) throw new Error(`Issue ${identifier} not found`);
    return issue;
}

// ── commands ──────────────────────────────────────────────────────────────────

const [, , cmd, ...rest] = process.argv;
const { flags, positional } = parseArgs(rest);

switch (cmd) {
    case "viewer": {
        const viewer = await linear.viewer;
        print({ id: viewer.id, name: viewer.name, email: viewer.email });
        break;
    }

    case "resolve": {
        const [viewer, teams, projects, labels] = await Promise.all([
            linear.viewer,
            linear.teams(),
            linear.projects(),
            linear.issueLabels({ filter: { team: { key: { eq: TEAM_KEY } } } }),
        ]);
        const team = teams.nodes.find(t => t.key === TEAM_KEY);
        const project = projects.nodes.find(p => p.name === PROJECT_NAME);
        print({
            viewer: { id: viewer.id, name: viewer.name },
            team: team ? { id: team.id, key: team.key } : null,
            project: project ? { id: project.id, name: project.name } : null,
            labels: labels.nodes.map(l => ({ id: l.id, name: l.name })),
        });
        break;
    }

    case "create": {
        const title = flags.title;
        if (!title) { console.error("--title is required"); process.exit(1); }
        const { viewer, teamId, projectId } = await resolveDefaults();
        const result = await linear.createIssue({
            title,
            description: flags.desc ?? flags.description,
            teamId,
            projectId,
            assigneeId: viewer.id,
            ...(flags.label ? { labelIds: [flags.label] } : {}),
        });
        const issue = await result.issue;
        print({ id: issue?.id, identifier: issue?.identifier, url: issue?.url });
        break;
    }

    case "read": {
        const identifier = positional[0];
        if (!identifier) { console.error("Usage: read <RPI-N>"); process.exit(1); }
        const issue = await findIssueByIdentifier(identifier);
        const [state, assignee, labels, comments] = await Promise.all([
            issue.state,
            issue.assignee,
            issue.labels(),
            issue.comments(),
        ]);
        print({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            state: state?.name,
            assignee: assignee?.name,
            labels: labels.nodes.map(l => ({ id: l.id, name: l.name })),
            comments: comments.nodes.map(c => ({ id: c.id, body: c.body })),
        });
        break;
    }

    case "list": {
        const viewer = await linear.viewer;
        const filter: Record<string, unknown> = {
            team: { key: { eq: TEAM_KEY } },
        };
        if (!flags.all) {
            filter.assignee = { id: { eq: viewer.id } };
        }
        if (flags.label) {
            filter.labels = { name: { eq: flags.label } };
        }
        const issues = await linear.issues({ filter } as Parameters<typeof linear.issues>[0]);
        print(issues.nodes.map(i => ({
            id: i.id,
            identifier: i.identifier,
            title: i.title,
            ...(flags.full ? { description: i.description } : {}),
        })));
        break;
    }

    case "label": {
        const [issueId, labelId] = positional;
        if (!issueId || !labelId) { console.error("Usage: label <issue-id> <label-id>"); process.exit(1); }
        await linear.issueAddLabel(issueId, labelId);
        print({ ok: true });
        break;
    }

    case "unlabel": {
        const [issueId, labelId] = positional;
        if (!issueId || !labelId) { console.error("Usage: unlabel <issue-id> <label-id>"); process.exit(1); }
        await linear.issueRemoveLabel(issueId, labelId);
        print({ ok: true });
        break;
    }

    case "comment": {
        const issueId = positional[0];
        const body = flags.body;
        if (!issueId || !body) { console.error("Usage: comment <issue-id> --body <text>"); process.exit(1); }
        await linear.createComment({ issueId, body });
        print({ ok: true });
        break;
    }

    case "close": {
        const issueId = positional[0];
        if (!issueId) { console.error("Usage: close <issue-id>"); process.exit(1); }
        const states = await linear.workflowStates({
            filter: { team: { key: { eq: TEAM_KEY } }, name: { eq: "Done" } },
        });
        const doneState = states.nodes[0];
        if (!doneState) { console.error("'Done' state not found"); process.exit(1); }
        await linear.updateIssue(issueId, { stateId: doneState.id });
        print({ ok: true });
        break;
    }

    default: {
        console.error(`Unknown command: ${cmd ?? "(none)"}`);
        console.error("Commands: viewer, resolve, create, read, list, label, unlabel, comment, close");
        process.exit(1);
    }
}
