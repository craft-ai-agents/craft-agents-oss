export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchProvider {
  /** Display name shown in search results attribution (e.g. "Google", "OpenAI") */
  name: string;
  /** Execute a web search and return structured results. */
  search(query: string, count: number): Promise<WebSearchResult[]>;
}
