/**
 * HOTFIX-K1 §B — Continuous-voice loop decision helper.
 *
 * VoiceInputButton's continuous mode auto-restarts the recorder after
 * each successful transcript so the shopkeeper speaks prices back-to-back
 * without tapping per item. The restart-vs-stop decision is extracted
 * here as a pure function so it is unit-testable without mounting the
 * component (which pulls in `expo-audio` and can't run in the Node test
 * env — same isolation pattern as catalogBrowseHelpers).
 *
 * IDLE_TIMEOUT_SEC is the forgotten-mic safety net: if no new utterance
 * arrives within this window after a capture, the loop stops on its own
 * so a pocketed phone doesn't record + drain battery indefinitely.
 */

export const IDLE_TIMEOUT_SEC = 8;

export type VoiceLoopEvent =
  /** A transcript came back successfully from the server. */
  | { type: 'result' }
  /** The parent set stopSignal true (stop-word or stop button). */
  | { type: 'stopSignal' }
  /** No speech for IDLE_TIMEOUT_SEC between captures. */
  | { type: 'idleTimeout' };

export type VoiceLoopDecision =
  | { action: 'restart' }
  | { action: 'stop'; errorCode?: 'idle_timeout' };

/**
 * Decide what the recorder loop should do next.
 *
 * - Not continuous → always stop (preserves single-shot behavior).
 * - stopSignal latched → stop.
 * - continuous + result → restart for the next utterance.
 * - continuous + idleTimeout → stop, surfacing the 'idle_timeout' code
 *   so the caller can inform the user the mic auto-stopped.
 */
export function decideVoiceLoop(
  event: VoiceLoopEvent,
  opts: { continuous: boolean; stopSignal: boolean },
): VoiceLoopDecision {
  if (!opts.continuous) return { action: 'stop' };
  if (opts.stopSignal) return { action: 'stop' };
  switch (event.type) {
    case 'result':
      return { action: 'restart' };
    case 'idleTimeout':
      return { action: 'stop', errorCode: 'idle_timeout' };
    case 'stopSignal':
      return { action: 'stop' };
  }
}
