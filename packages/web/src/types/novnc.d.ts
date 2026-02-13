/** noVNC RFB class — loaded at runtime from CDN, not bundled */
declare class RFB {
  constructor(target: HTMLElement, url: string | URL, options?: {
    shared?: boolean;
    credentials?: { password?: string };
    wsProtocols?: string[];
  });

  scaleViewport: boolean;
  resizeSession: boolean;
  showDotCursor: boolean;
  compressionLevel: number;
  qualityLevel: number;
  viewOnly: boolean;
  focusOnClick: boolean;
  clipViewport: boolean;

  disconnect(): void;
  sendCredentials(credentials: { password?: string }): void;
  sendKey(keysym: number, code: string | null, down?: boolean): void;
  focus(): void;
  blur(): void;

  addEventListener(type: "connect", listener: (e: CustomEvent) => void): void;
  addEventListener(type: "disconnect", listener: (e: CustomEvent<{ clean: boolean }>) => void): void;
  addEventListener(type: "credentialsrequired", listener: (e: CustomEvent) => void): void;
  addEventListener(type: "clipboard", listener: (e: CustomEvent<{ text: string }>) => void): void;
  addEventListener(type: "desktopname", listener: (e: CustomEvent<{ name: string }>) => void): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}
