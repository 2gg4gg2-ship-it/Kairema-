/**
 * A compact notice for "the provider you chose is not answering right now".
 *
 * It is deliberately not a modal, not fullscreen and not a blocking overlay. A provider outage is
 * information the user may want to keep reading past, so the page keeps working: the composer stays
 * visible, the sidebar and history stay usable, and a fallback that is already in progress continues
 * in the background. Anything that covered the page would be a worse answer to a temporary problem
 * than the problem itself.
 *
 * It sits below the vertical centre rather than at the top, so it reads as an aside to the
 * conversation instead of a banner that pushes the transcript down, and it is anchored horizontally
 * with a max-width so a long reason never stretches across a wide monitor.
 *
 * Colours come from the existing `--k-*` tokens, which carry a separate step for the light and the
 * dark theme. The status hues are the reserved `--k-warn` pair, not violet or blue, so this
 * inherits the same theme handling as the providers page and the theme toggle repaints it.
 */

import { AlertTriangle } from "lucide-react";

export type ProviderUnavailableNoticeProps = {
  /**
   * True while the turn is being handed to another provider the user connected. The wording changes
   * because the user's question is still being answered and only the source of the answer changed.
   */
  switching: boolean;
  /** A plain-language reason. Never an env var, a key name, a header or a raw upstream body. */
  reason: string;
};

const SWITCHING_TEXT = "Сейчас провайдер временно недоступен, мы автоматически переключаемся на следующий доступный вам провайдер.";
const STOPPED_TEXT = "Сейчас провайдер временно недоступен.";

export function ProviderUnavailableNotice({ switching, reason }: ProviderUnavailableNoticeProps) {
  return (
    <div
      className={`kairema-provider-notice${switching ? " kairema-provider-notice-switching" : ""}`}
      role="status"
      aria-live="polite"
      data-testid="provider-unavailable-notice"
      data-switching={switching ? "true" : "false"}
    >
      <AlertTriangle className="kairema-provider-notice-icon" aria-hidden="true" />
      <div className="kairema-provider-notice-body">
        <p className="kairema-provider-notice-text">{switching ? SWITCHING_TEXT : STOPPED_TEXT}</p>
        <p className="kairema-provider-notice-reason" data-testid="provider-unavailable-reason">
          Причина: {reason}
        </p>
      </div>
    </div>
  );
}
