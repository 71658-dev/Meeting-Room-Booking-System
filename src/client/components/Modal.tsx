import { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useId, useRef } from 'preact/hooks';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /**
   * 'top' stacks the dialog above another overlay that is already on screen — the
   * reservation form runs its own z-50 overlay, so a dialog raised from inside it needs
   * to sit higher rather than rely on DOM order between two z-50 siblings.
   */
  layer?: 'base' | 'top';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ isOpen, onClose, title, children, maxWidth = 'md', layer = 'base' }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Move focus into the dialog on open and hand it back on close, and keep Tab inside
  // while it is open (WAI-ARIA dialog pattern). Without this, tabbing walks off into
  // the page behind the overlay, which is unusable with a keyboard or screen reader.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel)?.focus();

    // Stop the page behind from scrolling under the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Prefixed with `md:` because below that the dialog is a full-bleed sheet (手機版) —
  // written out in full rather than composed at runtime so Tailwind's scanner sees them.
  const maxWidthMap = {
    sm: 'md:max-w-sm',
    md: 'md:max-w-md',
    lg: 'md:max-w-lg',
    xl: 'md:max-w-xl',
    '2xl': 'md:max-w-2xl',
  };

  // Modernist dialog: ink-filled title bar (改版設計 option 1g), 2px ink border,
  // zero radius, flat overlay. No blur or rounding — the system forbids both.
  const overlay = (
    <div
      class={`fixed inset-0 ${
        layer === 'top' ? 'z-[60]' : 'z-50'
      } overflow-y-auto bg-[#2d2b2b]/50 flex items-stretch md:items-center justify-center p-0 md:p-4`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        class={`bg-[#f3f2f2] w-full h-full md:h-auto ${maxWidthMap[maxWidth]} flex flex-col border-0 md:border-2 border-[#201e1d] overflow-hidden shadow-[0_12px_32px_rgba(45,43,43,0.3)] outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex-none px-5 md:px-6 py-4 bg-[#201e1d] flex items-center justify-between">
          <h3 id={titleId} class="m-0 font-extrabold text-lg md:text-xl leading-tight text-white">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            class="text-white/70 hover:text-white p-1 text-lg font-bold border-none bg-transparent cursor-pointer transition-colors"
            aria-label="關閉對話視窗"
          >
            ✕
          </button>
        </div>
        <div class="flex-1 px-5 md:px-6 py-5 md:max-h-[82vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );

  // Rendered into <body> rather than in place.
  //
  // `position: fixed` resolves against the nearest ancestor that establishes a
  // containing block — which includes any ancestor carrying a transform, filter or
  // backdrop-filter. Several wrappers here carry one (`.mcell`'s hover lift, the
  // month view's sliding date panel), so a modal rendered inside them was laid out
  // against that container and clipped inside it instead of covering the viewport.
  // Portalling to <body> makes the modal independent of wherever it is used.
  return createPortal(overlay, document.body);
}
