/**
 * The Fire TV app (firetv/) wraps the table in a WebView. It exposes `window.FireVerseApp`
 * and asks the page what Back means through `window.fireverseNative.back()`.
 */

type AppBridge = { changeTable(): void; exit(): void; version(): string };
type NativeHooks = { back(): "handled" | "exit" };

export function nativeApp(): AppBridge | null {
  return (window as unknown as { FireVerseApp?: AppBridge }).FireVerseApp ?? null;
}

/**
 * Back from the remote arrives outside the page's key events. It goes through the same
 * keydown path as Escape; if nothing claims it on `canExit()` screens, the app may close.
 */
export function registerNativeBack(canExit: () => boolean) {
  const hooks: NativeHooks = {
    back() {
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      const event = new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true });
      const claimed = !target.dispatchEvent(event);
      return !claimed && canExit() ? "exit" : "handled";
    },
  };
  (window as unknown as { fireverseNative: NativeHooks }).fireverseNative = hooks;
}
