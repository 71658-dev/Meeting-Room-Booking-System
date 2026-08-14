import { toast } from '../state';

export function Toast() {
  const currentToast = toast.value;
  if (!currentToast) return null;

  // Modernist has no semantic green/red: the palette is ink plus one brick accent.
  // Errors take the accent, everything else stays ink, and a flush-left rule
  // carries the distinction instead of hue.
  const bgStyles = {
    success: 'bg-[#201e1d] text-white border-l-4 border-[#9e3526]',
    error: 'bg-[#9e3526] text-white border-l-4 border-[#201e1d]',
    info: 'bg-[#201e1d] text-white border-l-4 border-[#605d5d]',
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      class={`fixed z-[70] bottom-4 left-4 right-4 md:left-auto md:bottom-5 md:right-5 px-4 py-3.5 flex items-center justify-between md:justify-start gap-3 font-bold text-sm shadow-[0_12px_32px_rgba(45,43,43,0.22)] ${
        bgStyles[currentToast.type]
      }`}
    >
      <span>{currentToast.message}</span>
      <button
        onClick={() => (toast.value = null)}
        class="ml-2 text-white/70 hover:text-white p-0.5 border-none bg-transparent cursor-pointer font-bold"
        aria-label="關閉通知"
      >
        ✕
      </button>
    </div>
  );
}
