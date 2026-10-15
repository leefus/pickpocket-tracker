"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDeck } from "@/app/actions";
import { checkDeck } from "@/lib/decklist.mjs";
import { ARCHETYPES, COLORS, FORMATS, STATUSES } from "@/lib/meta.mjs";
import { PasscodeRow, usePasscode } from "./usePasscode";

export default function DeckForm({ writable }) {
  const router = useRouter();
  const pc = usePasscode();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);
  const [badField, setBadField] = useState(null);
  const [main, setMain] = useState("");
  const [side, setSide] = useState("");

  // Live count so mistakes show before you hit save.
  const check = useMemo(() => checkDeck(main, side), [main, side]);
  const errCls = (f) => (badField === f ? "field-err" : undefined);

  function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("passcode", pc.passcode);
    setMsg(null);
    setBadField(null);
    startTransition(async () => {
      const res = await addDeck(fd);
      if (res?.error) {
        setMsg({ text: res.error, err: true });
        setBadField(res.field ?? null);
        return;
      }
      pc.keep();
      router.push(`/?deck=${res.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="wide">
        Deck name
        <input id="d-name" name="name" type="text" required placeholder="e.g. Orzhov Pickpocket" className={errCls("name")} />
      </label>
      <label>
        Format
        <select id="d-format" name="format" defaultValue={FORMATS[0]}>
          {FORMATS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select id="d-status" name="status" defaultValue={STATUSES[0]}>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        Archetype
        <select id="d-arch" name="archetype" defaultValue="">
          <option value="">Not set</option>
          {ARCHETYPES.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      <fieldset className="wide colors">
        <legend>Colors</legend>
        {COLORS.map((c) => (
          <label key={c} className="check">
            <input type="checkbox" name="colors" value={c} /> {c}
          </label>
        ))}
      </fieldset>
      <label className="wide">
        Main deck
        <textarea
          id="d-main"
          name="main"
          rows={12}
          required
          value={main}
          onChange={(e) => setMain(e.target.value)}
          placeholder={"4 Lich's Relic\n3 Requiting Hex\n5 Swamp\n…"}
          className={`mono ${errCls("main") ?? ""}`}
        />
        <span className={`count ${check.main.count >= 60 ? "ok" : ""}`}>{check.main.count} cards</span>
      </label>
      <label className="wide">
        Sideboard
        <textarea
          id="d-side"
          name="side"
          rows={6}
          value={side}
          onChange={(e) => setSide(e.target.value)}
          placeholder={"4 Get Lost\n3 Duress\n…"}
          className="mono"
        />
        <span className={`count ${check.side.count <= 15 ? "ok" : ""}`}>{check.side.count} / 15</span>
      </label>
      {check.errors.length > 0 && (main || side) && (
        <ul className="wide checklist">
          {check.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <label className="wide">
        Sideboard guide <span className="hint">one opponent per line: Opponent | In | Out. Put your two hardest matchups first.</span>
        <textarea
          id="d-guide"
          name="guide"
          rows={5}
          placeholder={"Boros Dragons | 4 Get Lost, 2 Shoot the Sheriff | 3 Requiting Hex, 3 Duress"}
          className="mono"
        />
      </label>
      <label>
        Testing gate (matches)
        <input id="d-gm" name="gateMatches" type="number" min={5} max={500} defaultValue={30} className={errCls("gateMatches")} />
      </label>
      <label>
        Gate win rate (%)
        <input id="d-gp" name="gatePct" type="number" min={1} max={99} step="0.5" defaultValue={45} className={errCls("gatePct")} />
      </label>
      <label className="wide">
        Notes
        <textarea id="d-notes" name="notes" rows={2} placeholder="The plan, the fallback list, anything Claude should know when reviewing." />
      </label>
      <PasscodeRow pc={pc} writable={writable} pending={pending} label="Save deck" invalid={badField === "passcode"} />
      {(msg || !writable) && (
        <p className={`msg wide${msg?.err ? " err" : ""}`} role="status">
          {msg ? msg.text : "Saving is off until the Notion variables and TRACKER_PASSCODE are set in Vercel."}
        </p>
      )}
    </form>
  );
}
