import { useState, useEffect, useRef } from 'preact/hooks';
import { api } from '../api';
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
    // Full-bleed on mobile: 手機版 gives the login screen the whole viewport with no card,
    // no bar and no poster — the title block carries the branding instead.
    <div class="min-h-screen md:min-h-[calc(100vh-5rem)] flex items-stretch md:items-center justify-center p-0 md:p-8 bg-[#f3f2f2] md:bg-[#dedbd5]">
      <div class="md:mcard max-w-[1120px] w-full overflow-hidden md:border md:border-[#201e1d]/35 md:shadow-lg bg-[#f3f2f2]">
        <div class="grid grid-cols-1 md:grid-cols-2 md:min-h-[620px]">
          {/* Left Poster Banner (1a design) — desktop only */}
          <div class="hidden md:flex bg-[#9e3526] text-white p-8 sm:p-11 flex-col justify-between gap-8">
            <div class="mono-label text-white/90 text-xs tracking-[0.14em]">
              HSINCHU CITY HEALTH BUREAU
            </div>
            <div>
              <div class="font-extrabold text-5xl sm:text-[76px] leading-[0.95] tracking-tight">
                會議室<br />預約系統
              </div>
              <div class="h-0.5 bg-white my-7 w-28"></div>
              <div class="font-medium text-base sm:text-[17px] leading-[1.7] max-w-[34ch] text-white/95">
                登入後可查詢空檔、發起預約、匯出行事曆。公開排程無需登入即可查看。
              </div>
            </div>
            <div class="font-medium text-sm text-white/85">
              v2.0 · 新竹市衛生局
            </div>
          </div>

          {/* Right Login Form (1a design) / the whole screen on 手機版 */}
          <div class="px-6 pt-7 pb-10 md:p-11 min-h-screen md:min-h-0 flex flex-col justify-center gap-6 md:gap-7 bg-[#f3f2f2]">
            {/* Mobile title block — stands in for the desktop poster panel. */}
            <div class="md:hidden">
              <div class="mono-label text-[11px] normal-case">新竹市衛生局 · v2.0</div>
              <h1 class="mt-3 mb-0 font-extrabold text-[34px] leading-[1.12] tracking-tight text-[#201e1d]">
                會議室
                <br />
                預約系統
              </h1>
            </div>

            <div class="hidden md:block">
              <h2 class="m-0 font-extrabold text-3xl sm:text-[34px] leading-[1.2] text-[#201e1d]">
                同仁登入
              </h2>
              <p class="mt-2.5 mb-0 font-normal text-base text-[#605d5d]">
                請使用人事工號登入。連續失敗將暫時鎖定帳號。
              </p>
            </div>

            <div class="h-0.5 bg-[#201e1d]/40"></div>

            {errorMsg && (
              <div class="p-3.5 bg-[#fff2ef] border-2 border-[#9e3526] text-[#71261b] text-sm font-semibold flex items-center gap-2">
                <span>⚠️</span> {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} class="flex flex-col gap-5">
              <div>
                <label class="block font-bold text-xs tracking-wider text-[#444141] mb-2">
                  工號 / 帳號
                </label>
                <input
                  type="text"
                  required
                  value={id}
                  onInput={(e) => setId((e.target as HTMLInputElement).value)}
                  class="w-full border md:border-2 border-[#201e1d] p-3.5 bg-white font-normal text-base text-[#201e1d] outline-none focus:border-[#9e3526]"
                />
              </div>

              <div>
                <label class="block font-bold text-xs tracking-wider text-[#444141] mb-2">
                  密碼
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                  placeholder="請輸入登入密碼"
                  class="w-full border md:border-2 border-[#201e1d] p-3.5 bg-white font-normal text-base text-[#201e1d] outline-none focus:border-[#9e3526]"
                />
              </div>

              {turnstileSiteKey ? (
                // The widget is a fixed 300px wide and does not scale down. The column's
                // px-6 gutter plus this box's own padding left only 288px on a 360px
                // phone, clipping it; below md the box therefore bleeds to the screen
                // edges (-mx-6 cancels the gutter) so even a 320px viewport fits.
                <div
                  ref={turnstileBoxRef}
                  id="turnstile-container"
                  class="my-1 min-h-[65px] flex justify-center items-center border border-[#d7d3d3] bg-[#eae9e9] py-3 px-0 md:px-3 -mx-6 md:mx-0"
                ></div>
              ) : (
                <div class="border border-[#d7d3d3] bg-[#eae9e9] p-4 text-sm text-[#605d5d]">
                  Cloudflare Turnstile 人機驗證
                </div>
              )}

              <div class="flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  class="bg-[#9e3526] hover:bg-[#71261b] text-white p-4 font-bold text-base border-none cursor-pointer text-left transition-colors flex-1"
                >
                  {loading ? '安全驗證中...' : '登入系統'}
                </button>
                <button
                  type="button"
                  onClick={() => (currentView.value = 'public')}
                  class="border border-[#201e1d] bg-white text-[#201e1d] hover:bg-[#eae9e9] p-4 font-semibold text-base cursor-pointer text-left transition-colors"
                >
                  查看公開排程
                </button>
              </div>
            </form>

            <p class="m-0 font-normal text-xs text-[#7d7979] leading-relaxed">
              公務安全提醒：請定期變更密碼，且勿將帳號借予他人使用。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
