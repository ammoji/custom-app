/**
 * HOTFIX-K1 §B — VoiceInputButton continuous-mode logic tests.
 *
 * VoiceInputButton itself pulls in `expo-audio` and can't render in the
 * pure-Node test env, so the continuous-loop decision (restart vs stop)
 * is extracted into the pure `decideVoiceLoop` helper (voiceLoopHelpers).
 * This suite pins the four behaviors the component relies on:
 *
 *   1. continuous=false (default)         → never auto-restart
 *   2. continuous=true + result           → auto-restart
 *   3. continuous=true + stopSignal latched → stop (no restart)
 *   4. continuous=true + idle timeout      → stop, code 'idle_timeout'
 */

import {
  decideVoiceLoop,
  IDLE_TIMEOUT_SEC,
} from '../../src/utils/voiceLoopHelpers';

describe('VoiceInputButton §B — decideVoiceLoop (continuous mode)', () => {
  it('continuous=false (default) → no auto-restart after a result', () => {
    const decision = decideVoiceLoop(
      { type: 'result' },
      { continuous: false, stopSignal: false },
    );
    expect(decision.action).toBe('stop');
  });

  it('continuous=true → auto-restarts the recorder after a result', () => {
    const decision = decideVoiceLoop(
      { type: 'result' },
      { continuous: true, stopSignal: false },
    );
    expect(decision.action).toBe('restart');
  });

  it('continuous=true + stopSignal latched → loop exits (no restart)', () => {
    const decision = decideVoiceLoop(
      { type: 'result' },
      { continuous: true, stopSignal: true },
    );
    expect(decision.action).toBe('stop');
  });

  it("continuous=true + idle timeout → stop with code 'idle_timeout'", () => {
    const decision = decideVoiceLoop(
      { type: 'idleTimeout' },
      { continuous: true, stopSignal: false },
    );
    expect(decision.action).toBe('stop');
    if (decision.action === 'stop') {
      expect(decision.errorCode).toBe('idle_timeout');
    }
  });

  it('idle timeout window is the documented 8 seconds', () => {
    expect(IDLE_TIMEOUT_SEC).toBe(8);
  });
});
