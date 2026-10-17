"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toCardInfo } from "@/lib/cardinfo.mjs";

/**
 * Tap any card name to see the card: its image from Scryfall and its rules text.
 * Cards in the deck come from the data the page already loaded; anything else
 * (an opponent's card, a sideboard idea) is looked up on Scryfall when you tap it.
 */
const Ctx = createContext(null);

export function CardInfoProvider({ cards = {}, children }) {
  const [open, setOpen] = useState(null); // card name
  const [info, setInfo] = useState(null);
  const [state, setState] = useState("idle"); // idle | loading | ready | missing
  const [view, setView] = useState("image"); // image | text
  const [face, setFace] = useState(0);
  const lookups = useRef(new Map());

  const show = useCallback(
    async (name) => {
      setOpen(name);
      setFace(0);
      const key = name.toLowerCase();
      const known = cards[key] ?? lookups.current.get(key);
      if (known) {
        setInfo(known);
        setState("ready");
        setView(known.image ? "image" : "text");
        return;
      }
      setInfo(null);
      setState("loading");
      try {
        const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const c = toCardInfo(await res.json());
        lookups.current.set(key, c);
        setInfo(c);
        setState("ready");
        setView(c.image ? "image" : "text");
      } catch {
        setState("missing");
      }
    },
    [cards],
  );

  return (
    <Ctx.Provider value={show}>
      {children}
      {open && (
        <CardDialog
          name={open}
          info={info}
          state={state}
          view={view}
          setView={setView}
          face={face}
          setFace={setFace}
          onClose={() => setOpen(null)}
        />
      )}
    </Ctx.Provider>
  );
}

/** A card name you can tap. Outside a provider it renders as plain text. */
export function CardName({ name, children, className }) {
  const show = useContext(Ctx);
  if (!show || !name) return <>{children ?? name}</>;
  return (
    <button type="button" className={`cardlink${className ? ` ${className}` : ""}`} onClick={() => show(name)} title={`Show ${name}`}>
      {children ?? name}
    </button>
  );
}

function CardDialog({ name, info, state, view, setView, face, setFace, onClose }) {
  const closeRef = useRef(null);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => setImgFailed(false), [info, face]);

  const faces = info?.faces?.length ? info.faces : info ? [info] : [];
  const f = faces[Math.min(face, faces.length - 1)];
  const image = f?.image ?? info?.image;
  const showImage = view === "image" && image && !imgFailed;

  return (
    <div className="cardmodal" role="presentation" onClick={onClose}>
      <div className="cardsheet" role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()}>
        <div className="cardhead">
          <b>{info?.name ?? name}</b>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {state === "loading" && <p className="sub">Looking up the card…</p>}
        {state === "missing" && <p className="msg">Couldn&apos;t find &ldquo;{name}&rdquo; on Scryfall. Check the spelling, or you may be offline.</p>}

        {state === "ready" && info && (
          <>
            <div className="seg" role="tablist" aria-label="Show">
              <button type="button" role="tab" aria-selected={view === "image"} className={view === "image" ? "on" : undefined} onClick={() => setView("image")} disabled={!image}>
                Image
              </button>
              <button type="button" role="tab" aria-selected={view === "text"} className={view === "text" ? "on" : undefined} onClick={() => setView("text")}>
                Text
              </button>
              {faces.length > 1 && (
                <button type="button" className="flip" onClick={() => setFace((face + 1) % faces.length)}>
                  Flip ({face + 1}/{faces.length})
                </button>
              )}
            </div>

            {showImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="cardimg" src={image} alt={`${f.name}: ${f.type}. ${f.text}`} onError={() => setImgFailed(true)} />
            ) : (
              <div className="cardtext">
                {view === "image" && (imgFailed || !image) && <p className="sub small">No image available, so here&apos;s the text.</p>}
                {(faces.length > 1 ? faces : [info]).map((x, i) => (
                  <div key={i} className={faces.length > 1 && i !== face ? "otherface" : undefined}>
                    <div className="ctitle">
                      <b>{x.name}</b> <span className="num">{x.cost}</span>
                    </div>
                    <div className="sub small">{x.type}</div>
                    {x.text && <p className="rules">{x.text}</p>}
                    {x.pt && <div className="num small">{x.pt}</div>}
                  </div>
                ))}
              </div>
            )}
            {info.uri && (
              <a className="small" href={info.uri} target="_blank" rel="noreferrer">
                Open on Scryfall ↗
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
