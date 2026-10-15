"use client";

import { useEffect, useState } from "react";

const KEY = "pickpocket-passcode";

/** A remembered passcode is a per-device convenience; the server still checks it. */
export function usePasscode() {
  const [passcode, setPasscode] = useState("");
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setPasscode(saved);
    } catch {}
  }, []);

  const keep = () => {
    try {
      if (remember) localStorage.setItem(KEY, passcode);
      else localStorage.removeItem(KEY);
    } catch {}
  };

  return { passcode, setPasscode, remember, setRemember, keep };
}

export function PasscodeRow({ pc, writable, pending, label, invalid }) {
  return (
    <div className="wide passrow">
      <label>
        Passcode
        <input
          type="password"
          autoComplete="current-password"
          value={pc.passcode}
          onChange={(e) => pc.setPasscode(e.target.value)}
          className={invalid ? "field-err" : undefined}
          disabled={!writable}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={pc.remember} onChange={(e) => pc.setRemember(e.target.checked)} />
        Remember on this device
      </label>
      <button type="submit" disabled={!writable || pending}>
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}
