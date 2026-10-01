import { useState, useEffect, useRef } from 'preact/hooks';
import { api } from '../api';
import { ShieldCheck, TriangleAlert } from 'lucide-preact';
import { currentUser, currentView, showToast, isPasswordModalOpen } from '../state';

export function LoginView() {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');

  const turnstileBoxRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    api.getConfig().then((cfg) => {
      if (cfg && cfg.TURNSTILE_SITEKEY) {
        setTurnstileSiteKey(cfg.TURNSTILE_SITEKEY);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey) return;

    let cancelled = false;
    let pollTimer: number | undefined;
    const deadline = Date.now() + 20000;

    const renderWidget = () => {
      const turnstile = (window as any).turnstile;
      if (cancelled || !turnstile || !turnstileBoxRef.current) return;
      // render() throws if the container already holds a widget.
      if (widgetIdRef.current !== null) return;
      try {
        widgetIdRef.current = turnstile.render(turnstileBoxRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => {
            setTurnstileToken(token);
            setErrorMsg('');
          },
          // A Turnstile token is valid for 300s. Without this the component kept a
          // stale token in state, submitted it, and the server rejected it as a failed
          // human check — routine on a phone, where fetching a password from another
          // app easily takes longer than five minutes.
          'expired-callback': () => {
            setTurnstileToken('');
            setErrorMsg('人機驗證已逾時，請重新完成驗證');
          },
          'timeout-callback': () => setTurnstileToken(''),
          'error-callback': () => {
            setTurnstileToken('');
            setErrorMsg('人機驗證載入失敗，請確認網路連線後重試');
          },
        });
      } catch (e) {
        console.warn('Turnstile render error:', e);
      }
    };

    // api.js is loaded async+defer, so window.turnstile may not exist yet when the
    // sitekey arrives from /api/config. The previous code checked once and, if the
    // script had not landed, never retried — the box stayed empty and every login
    // attempt failed on "請先完成人機驗證". The API call almost always wins that race
    // on a phone, where the cross-origin script is the slower of the two.
    // Do not route this through turnstile.ready(): it throws
    // "Remove async/defer from the Turnstile api.js script tag" when api.js carries
    // those attributes, which index.html does deliberately (a blocking third-party
    // script on the login page is worse). Once window.turnstile exists the API is
    // already usable, so polling for it is both sufficient and correct here.
    const waitForScript = () => {
      if (cancelled) return;
      const turnstile = (window as any).turnstile;
      if (turnstile) {
        renderWidget();
        return;
      }
      if (Date.now() > deadline) {
        setErrorMsg('人機驗證元件載入逾時，請重新整理頁面');
        return;
      }
      pollTimer = window.setTimeout(waitForScript, 100);
    };
    waitForScript();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      const turnstile = (window as any).turnstile;
      if (turnstile && widgetIdRef.current !== null) {
        try {
          turnstile.remove(widgetIdRef.current);
        } catch (e) {
          /* widget already gone */
        }
      }
      widgetIdRef.current = null;
    };
  }, [turnstileSiteKey]);

  /**
   * Turnstile tokens are single-use, and routes/auth.ts verifies the token *before* it
   * checks the password — so a mistyped password burns the token at Cloudflare. Without
   * this reset the widget still showed its green tick while every retry failed the human
   * check, which reads as "驗證無法通過" with no way out but a full page reload.
   */
  const resetTurnstile = () => {
    setTurnstileToken('');
    const turnstile = (window as any).turnstile;
    if (turnstile && widgetIdRef.current !== null) {
      try {
        turnstile.reset(widgetIdRef.current);
      } catch (e) {
        console.warn('Turnstile reset error:', e);
      }
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!id.trim() || !password) {
      setErrorMsg('請輸入工號與密碼');
      return;
    }

    if (!turnstileToken || !turnstileToken.trim()) {
      setErrorMsg('請先完成 Cloudflare 人機驗證 (Turnstile)');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await api.login(id.trim(), password, turnstileToken);
      if (res.success && res.user) {
        currentUser.value = res.user;
        showToast(`歡迎回來，${res.user.name} 同仁`, 'success');
        if (res.user.must_change_password) {
          isPasswordModalOpen.value = true;
        }
      } else {
        resetTurnstile();
      }
    } catch (err: any) {
      setErrorMsg(err.message || '登入失敗，請檢查帳號密碼');
      // The token was spent on this attempt whatever went wrong; the next one needs a
      // fresh challenge.
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  return (
    // Desktop: brand copy beside a floating glass card (D1). Phone: the whole screen,
    // with the app tile and title standing in for the copy column (M1).
    <div class="min-h-screen md:min-h-[calc(100vh-88px)] flex items-stretch md:items-center justify-center gap-24 px-5 md:px-8 pt-12 pb-10 md:py-10">
      {/* Brand copy — desktop */}
      <div class="hidden lg:flex max-w-[420px] flex-col gap-4">
        <div class="text-[15px] font-semibold text-accent">新竹市衛生局</div>
        <div class="text-[56px] leading-[62px] font-bold tracking-[-0.01em]">
          會議室
          <br />
          預約系統
        </div>
        <div class="text-[17px] leading-[26px] text-label-2">
          登入後可查詢空檔、發起預約、匯出行事曆。公開排程無需登入即可查看。
        </div>
      </div>

      <div class="w-full md:w-[420px] flex flex-col gap-6 md:gap-5 md:glass-sheet md:rounded-[32px] md:p-8">
        {/* Phone title block */}
        <div class="md:hidden flex flex-col gap-6">
          <div class="w-[72px] h-[72px] rounded-[18px] bg-accent text-white text-[34px] font-bold flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_10px_24px_rgba(0,136,255,.3)]">
            衛
          </div>
          <div>
            <div class="text-[15px] font-semibold text-accent">新竹市衛生局 · v2.0</div>
            <h1 class="m-0 lg-title-1">會議室預約系統</h1>
            <p class="mt-1.5 mb-0 text-[15px] leading-5 text-label-2">
              請使用人事工號登入。連續失敗將暫時鎖定帳號。
            </p>
          </div>
        </div>

        <div class="hidden md:block">
          <h2 class="m-0 text-[28px] leading-[34px] font-bold">同仁登入</h2>
          <p class="mt-1.5 mb-0 text-[15px] leading-5 text-label-2">
            請使用人事工號登入。連續失敗將暫時鎖定帳號。
          </p>
        </div>

        {errorMsg && (
          <div role="alert" class="flex items-start gap-2.5 px-4 py-3 rounded-2xl bg-danger/10 text-[15px] font-semibold text-danger-ink">
            <TriangleAlert size={18} class="flex-none mt-0.5 text-danger" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} class="flex flex-col gap-5 flex-1 md:flex-none">
          {/* Inset grouped fields: label and input share a row, iOS Settings style. */}
          <div class="grouped max-md:glass max-md:rounded-[20px]">
            <label class="flex items-center h-[52px] px-4 gap-3">
              <span class="w-14 md:w-[76px] flex-none text-[17px]">工號</span>
              <input
                type="text"
                required
                autoComplete="username"
                value={id}
                onInput={(e) => setId((e.target as HTMLInputElement).value)}
                placeholder="例如 30607"
                class="flex-1 min-w-0 h-full bg-transparent border-none outline-none text-[17px] placeholder:text-label-3"
              />
            </label>
            <label class="flex items-center h-[52px] px-4 gap-3">
              <span class="w-14 md:w-[76px] flex-none text-[17px]">密碼</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                placeholder="請輸入登入密碼"
                class="flex-1 min-w-0 h-full bg-transparent border-none outline-none text-[17px] placeholder:text-label-3"
              />
            </label>
          </div>

          {turnstileSiteKey ? (
            // The widget is a fixed 300px wide and does not scale down, so the box carries
            // no horizontal padding: on a 320px phone the 20px gutters leave 280px, and
            // the negative margin below md gives the widget the full screen width back.
            <div
              ref={turnstileBoxRef}
              id="turnstile-container"
              class="min-h-[65px] flex justify-center items-center rounded-2xl bg-fill py-2 -mx-5 md:mx-0"
            ></div>
          ) : (
            <div class="h-[65px] rounded-2xl bg-fill flex items-center justify-center gap-2 text-[13px] text-label-2">
              <ShieldCheck size={16} aria-hidden="true" />
              Cloudflare Turnstile 人機驗證
            </div>
          )}

          <div class="flex-1 md:hidden"></div>

          <div class="flex flex-col gap-2.5">
            <button type="submit" disabled={loading} class="btn btn-primary btn-lg w-full">
              {loading ? '安全驗證中…' : '登入系統'}
            </button>
            <button
              type="button"
              onClick={() => (currentView.value = 'public')}
              class="btn btn-tinted btn-lg w-full max-md:glass"
            >
              查看公開排程
            </button>
          </div>
        </form>

        <p class="m-0 text-xs leading-4 text-label-2 text-center">
          公務安全提醒：請定期變更密碼，且勿將帳號借予他人使用。
        </p>
      </div>
    </div>
  );
}
