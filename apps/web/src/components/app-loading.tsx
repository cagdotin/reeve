import { Spinner } from "@reeve/ui/components/spinner";
import { WindowDragArea } from "@/components/window-drag-area";

/** The window before the frame exists, while the server and the book answer. */
export function AppLoading() {
  return (
    <div className="flex h-svh items-center justify-center">
      <WindowDragArea />
      <Spinner />
    </div>
  );
}
