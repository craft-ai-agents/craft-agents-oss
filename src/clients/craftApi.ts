import z from "zod";

export class CraftApi {
    constructor(private baseUrl: string) {}

    private async fetch<T>(params: {
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        path: string;
        queryParams?: Record<string, string>;
        body?: Record<string, unknown>;
        headers?: Record<string, string>;
        authToken?: string;
        responseParser: (response: string) => Promise<T>;
    }): Promise<T> {
        const { method, path, queryParams, body, headers, authToken, responseParser } = params;

        // Build URL with query params
        const url = new URL(path, this.baseUrl);
        if (queryParams) {
            for (const [key, value] of Object.entries(queryParams)) {
                url.searchParams.set(key, value);
            }
        }

        // Build headers
        const requestHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            ...headers,
        };

        if (authToken) {
            requestHeaders['Authorization'] = `${authToken}`;
        }

        // Make request
        const response = await fetch(url.toString(), {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const responseText = await response.text();
        return responseParser(responseText);
    }

    async exchangeCodeForToken(params: { code: string, redirectUri: string, codeVerifier: string }): Promise<string> {
        const { code, redirectUri, codeVerifier } = params;
        return this.fetch({
            method: 'POST',
            path: '/auth/authorization_code/exchange',
            body: { code, redirectUri, codeVerifier },
            responseParser: async (response) => {
                const data = JSON.parse(response) as { token?: string };
                if (typeof data?.token === 'string') {
                    return data.token;
                }
                throw new Error('Invalid response from API');
            },
        });
    }

    async getProfile(authToken: string) {
        return this.fetch({
            method: 'GET',
            path: '/auth/v3/profile',
            authToken,
            responseParser: async (response) => {
                return profileResponseSchema.parse(JSON.parse(response));
            },
        });
    }

    async getWorkflowLinks(params: { authToken: string, spaceId: string }) {
        const { authToken, spaceId } = params;
        return this.fetch({
            method: 'GET',
            path: `/share/v2/spaces/${spaceId}/workflow-links`,
            authToken,
            responseParser: async (response) => {
                return workflowLinksResponseSchema.parse(JSON.parse(response)).items;
            },
        });
    }

    async createSpaceWorkflowLink(params: { authToken: string, spaceId: string, name: string, type: 'mcp', scope: 'fullSpace' }) {
        const { authToken, spaceId, name, type, scope } = params;
        return this.fetch({
            method: 'POST',
            path: `/share/v2/spaces/${spaceId}/workflow-links`,
            authToken,
            body: { type, scope, name },
            responseParser: async (response) => {
                return z.object({ 
                    workflowLink: workflowLinkSchema
                }).parse(JSON.parse(response)).workflowLink
            },
        });
    }

    async renewSession(authToken: string): Promise<string> {
        return this.fetch({
            method: 'POST',
            path: '/auth/session/renew',
            authToken,
            responseParser: async (response) => {
                const data = JSON.parse(response) as { authToken?: string };
                if (typeof data.authToken !== 'string') {
                    throw new Error('Invalid response from session renew API: missing authToken');
                }
                return data.authToken;
            },
        });
    }

    async generateAiCreditCheckoutToken(params: { authToken: string, teamId: string }) {
        const { authToken, teamId } = params;
        return this.fetch({
            method: 'GET',
            path: '/subscription/teams/generate-ai-credit-checkout-token',
            queryParams: { teamId },
            authToken,
            responseParser: async (response) => {
                return aiCreditCheckoutTokenResponseSchema.parse(JSON.parse(response));
            },
        });
    }
}

const workflowLinkSchema = z.object({
    name: z.string(),
    scope: z.string(),
    linkId: z.string(),
    enabled: z.boolean(),
    secretLinkId: z.string(),
    type: z.string(),
    hasPassword: z.boolean(),
    protectionType: z.string(),
    urls: z.object({
        mcp: z.string().optional(),
    }),
});

const workflowLinksResponseSchema = z.object({
    items: z.array(workflowLinkSchema),
});

const profileResponseSchema = z.object({
    userId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    spaces: z.array(z.object({ id: z.string(), name: z.string() })),
    teams: z.array(z.object({
        id: z.string(),
        isPrivate: z.boolean(),
        role: z.string(),
        name: z.string()
    })),
});

const aiCreditCheckoutTokenResponseSchema = z.object({
    token: z.string(),
    expirationTime: z.number(),
});
