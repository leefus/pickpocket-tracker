"use client";

import { useEffect, useState } from "react";

/**
 * Registers the service worker and, where the browser supports it (Android
 * Chrome, desktop Chrome/Edge), offers a one-tap install. iPhone Safari never
 * fires beforeinstallprompt; there it's Share → Add to Home Screen.
 */
export default function PWA() {
  const [deferred, setDeferred] = useState(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker registration failed", e));
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (standalone) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("pp-install-dismissed") === "1";
    } catch {}
    if (dismissed) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    if (isIos) {
      setIos(true);
      setHidden(false);
    }
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem("pp-install-dismissed", "1");
    } catch {}
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    close();
  };

  if (hidden || (!deferred && !ios)) return null;

  return (
    <div className="install" role="dialog" aria-label="Install the app">
      <div>
        <b>Put Deck Stats on your home screen</b>
        <p>{ios ? "In Safari, tap Share, then Add to Home Screen." : "Opens like an app and shows your last stats with no signal."}</p>
      </div>
      {!ios && (
        <button type="button" onClick={install}>
          Install
        </button>
      )}
      <button type="button" className="ghost" onClick={close} aria-label="Not now">
        Not now
      </button>
    </div>
  );
}
