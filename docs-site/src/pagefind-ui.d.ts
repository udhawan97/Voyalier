/** `@pagefind/default-ui` ships no type definitions. */
declare module "@pagefind/default-ui" {
  export class PagefindUI {
    constructor(options: Record<string, unknown>);
    triggerSearch(term: string): void;
    destroy(): void;
  }
}
