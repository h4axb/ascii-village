// The workshop's popup for when the crafting AI can't be reached. The title
// names the cause in a few plain words, the player's prompt and token are
// kept, and it retries once on its own after AI_RETRY_MS. If it fails again,
// or still fails after the page was reloaded, it asks the player to tell
// their host. The technical error stays in one small line for the host.
// CraftModal owns the state.
import type { AiDown } from './llm';
import { Panel } from './ui';

export const AI_RETRY_MS = 2 * 60 * 1000;

// Remembers a failure across a reload (this tab only), so a player who
// reloads and still can't craft is told to ask the host straight away.
const FLAG = 'asciia-ai-down';
export function noteAiDown(): boolean {
  try {
    const before = sessionStorage.getItem(FLAG) === '1';
    sessionStorage.setItem(FLAG, '1');
    return before;
  } catch {
    return false;
  }
}
export function clearAiDown(): void {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    // storage blocked: nothing to clear
  }
}

// The cause, in words a player understands
function causeOf(info: AiDown): { title: string; text: string } {
  if (/not configured|api key|LLM_API_KEY|asciia-bay-crafting/i.test(info.detail))
    return {
      title: 'Loading problem',
      text: 'The system is having trouble right now. Please try again in a few minutes. If the problem continues, notify your host.',
    };
  switch (info.failure) {
    case 'network':
      return typeof navigator !== 'undefined' && navigator.onLine === false
        ? {
            title: 'No internet connection',
            text: 'Your device appears to be offline. Check your internet connection and try again.',
          }
        : {
            title: 'Connection problem',
            text: 'The system could not connect right now. Please try again in a few moments.',
          };
    case 'timeout':
      return {
        title: 'Loading is taking too long',
        text: 'The system is taking longer than expected. Please wait a moment and try again.',
      };
    case 'auth':
      return {
        title: 'Access problem',
        text: 'The system could not connect properly. Please try again. If the problem continues, notify your host.',
      };
    case 'busy':
      return {
        title: 'System is busy',
        text: 'The system is handling too many requests right now. Please try again in a few minutes.',
      };
    case 'server':
      return {
        title: 'Temporary system problem',
        text: 'Something went wrong on the system side. Please try again in a few minutes.',
      };
    case 'setup':
      return {
        title: 'System setup problem',
        text: 'The system is not available right now. Please try again later. If it still doesn’t work, notify your host.',
      };
  }
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function AiDownPopup({
  info,
  attempt,
  retryAt,
  retrying,
  now,
  onRetry,
  onLeave,
}: {
  info: AiDown;
  attempt: number; // 1: the first failure (an automatic retry follows); 2+: still failing, or failing again after a reload
  retryAt: number | null;
  retrying: boolean;
  now: number;
  onRetry: () => void;
  onLeave: () => void;
}) {
  const stillDown = attempt > 1;
  const cause = causeOf(info);
  return (
    <Panel title={cause.title} className="ai-down">
      <p className="ds-panel-text">{cause.text}</p>
      {stillDown ? (
        <p className="ds-panel-text ai-down-host">It still doesn’t work, so please tell your host.</p>
      ) : (
        <>
          <p className="ds-panel-text">
            Your token is safe.{' '}
            {retrying ? 'Trying again…' : retryAt ? `I’ll try again in ${clock(retryAt - now)}.` : null}
          </p>
          {!/notify your host/.test(cause.text) && (
            <p className="ds-panel-text ds-muted">If it still doesn’t work after reloading the page, please tell your host.</p>
          )}
        </>
      )}
      <div className="ds-actions ai-down-actions">
        <button className="ds-action go" onClick={onRetry} disabled={retrying}>
          <span>{retrying ? 'Trying…' : 'Try again'}</span>
        </button>
        <button className="ds-action" onClick={onLeave}>
          <span>Leave the workshop</span>
        </button>
      </div>
      <p className="ai-down-detail">
        {info.status ? `Error ${info.status}: ` : 'Error: '}
        {info.detail || info.failure}
      </p>
    </Panel>
  );
}
