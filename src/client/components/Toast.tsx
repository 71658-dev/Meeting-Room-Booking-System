import { CircleAlert, CircleCheck, Info, X } from 'lucide-preact';
import { toast } from '../state';

const ICONS = {
  success: { Icon: CircleCheck, color: 'text-success' },
  error: { Icon: CircleAlert, color: 'text-danger' },
  info: { Icon: Info, color: 'text-accent' },
};

/**
 * Glass notification pill. Sits above the mobile tab bar rather than over it, and in the
 * bottom-right corner on desktop.
 */
export function Toast() {
  const currentToast = toast.value;
  if (!currentToast) return null;

  const { Icon, color } = ICONS[currentToast.type];

  return (
    <div
      role={currentToast.type === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      class="glass-sheet fixed z-[70] left-4 right-4 bottom-[calc(max(16px,env(safe-area-inset-bottom))+76px)] md:left-auto md:right-6 md:bottom-6 md:max-w-md flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-[22px] font-semibold text-[15px] text-black"
    >
      <Icon size={22} class={`flex-none ${color}`} aria-hidden="true" />
      <span class="flex-1 leading-snug">{currentToast.message}</span>
      <button
        type="button"
        onClick={() => (toast.value = null)}
        class="btn btn-plain btn-icon w-8 h-8 text-label-2"
        aria-label="關閉通知"
      >
        <X size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}
