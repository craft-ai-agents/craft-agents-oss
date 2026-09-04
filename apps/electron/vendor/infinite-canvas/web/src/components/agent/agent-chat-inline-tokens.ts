import type { AgentCanvasReference, AgentSkillReference } from "@/stores/use-agent-store";

export const agentInlineTokenClass = "mx-0.5 inline-block h-7 whitespace-nowrap rounded-md border px-1.5 align-baseline text-sm leading-[26px]";
export const agentInlineTokenMediaClass = "mr-1 inline-block size-5 rounded object-cover align-middle";
export const agentInlineTokenIconClass = "mr-1 inline-block size-4 align-middle opacity-65";

export type AgentInlineToken =
    | { type: "text"; value: string }
    | { type: "skill"; skill: AgentSkillReference }
    | { type: "reference"; reference: AgentCanvasReference };

export function agentSkillMarker(skill: Pick<AgentSkillReference, "name">) {
    return `$${skill.name}`;
}

export function agentReferenceMarker(reference: Pick<AgentCanvasReference, "label">) {
    return `@${reference.label}`;
}

export function parseAgentInlineTokens(text: string, references: AgentCanvasReference[], skill?: AgentSkillReference): AgentInlineToken[] {
    const markers = [
        ...(skill ? [{ marker: agentSkillMarker(skill), token: { type: "skill", skill } as AgentInlineToken }] : []),
        ...references.map((reference) => ({ marker: agentReferenceMarker(reference), token: { type: "reference", reference } as AgentInlineToken })),
    ].sort((a, b) => b.marker.length - a.marker.length);
    if (!markers.length) return [{ type: "text", value: text }];

    const tokens: AgentInlineToken[] = [];
    let cursor = 0;
    while (cursor < text.length) {
        let nextIndex = -1;
        let nextMarker: (typeof markers)[number] | undefined;
        markers.forEach((item) => {
            const index = text.indexOf(item.marker, cursor);
            if (index >= 0 && (nextIndex < 0 || index < nextIndex)) {
                nextIndex = index;
                nextMarker = item;
            }
        });
        if (!nextMarker || nextIndex < 0) {
            tokens.push({ type: "text", value: text.slice(cursor) });
            break;
        }
        if (nextIndex > cursor) tokens.push({ type: "text", value: text.slice(cursor, nextIndex) });
        tokens.push(nextMarker.token);
        cursor = nextIndex + nextMarker.marker.length;
    }
    return tokens.length ? tokens : [{ type: "text", value: "" }];
}
