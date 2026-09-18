export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchRequest = {
  query: string;
  maxResults: number;
};

export type WebSearchContext = { signal?: AbortSignal };

export type WebSearchBackend = {
  name: string;
  // method syntax on purpose, same reason as Tool.execute in @mg/core
  search(
    request: WebSearchRequest,
    context: WebSearchContext,
  ): Promise<WebSearchResult[]>;
};
