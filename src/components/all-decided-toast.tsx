"use client";

import { useCallback, useEffect, useState } from "react";
import { ALL_DECIDED_MESSAGE, NOTHING_TO_SEND_MESSAGE, TOAST_ACTION, Toast } from "./toast";

/**
 * Shown on the review page right after the action that decided the last
 * pending finding. The server marks that moment with ?decided=all in the URL;
 * this removes the marker once shown, so reloading the page does not announce
 * it a second time.
 */
export function AllDecidedToast({ nothingToSend }: { nothingToSend: boolean }) {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("decided");
    window.history.replaceState(null, "", url);
  }, []);

  if (!open) {
    return null;
  }
  return (
    <Toast
      message={nothingToSend ? NOTHING_TO_SEND_MESSAGE : ALL_DECIDED_MESSAGE}
      onDone={close}
      action={
        <a href="#publish" className={TOAST_ACTION} onClick={close}>
          {nothingToSend ? "Approve" : "Publish"}
        </a>
      }
    />
  );
}
