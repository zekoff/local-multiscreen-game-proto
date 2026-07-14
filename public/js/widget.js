// Portable console-widget abstraction.
//
// New architecture principle (this pass): a console widget is a SELF-CONTAINED
// unit. It owns its own DOM (built in `mount`, with no shared element ids), its
// own render slice, its own event wiring, and its own edge-state. A console page
// becomes a *layout list* of widgets plus a tiny host loop that calls
// `render(state)` on each. Moving a function between consoles is then moving a
// widget between two layout arrays — no re-architecting.
//
// This works because of two facts already true of the engine:
//   1. The server broadcasts the COMPLETE serialized state to every seat, so any
//      display widget can run on any console with zero server change.
//   2. Actions are validated per seat server-side, so an ACTION widget only
//      needs its host seat authorized for its action kind (see game.ts action()).
//      That server-side seat gate is the one coupling a widget carries with it.
//
// A widget is `{ id, label?, hint?, accent?, seats?, mount(ctx) -> instance }`
// where `instance = { render(state), destroy?() }` and
// `ctx = { net, intents, audio, root, card, seat }`.
//   - `root`  : the element to build DOM into (the widget body).
//   - `card`  : the outer widget card (for accent/emphasis toggles).
//   - `net`   : send actions via `net.action({ kind, ... })`.
//   - `intents`: the optimistic store (createIntents) — optional per widget.
//   - `audio` : the shared audio module (optional).
//   - `seat`  : the host console's seat id (a widget can adapt if shared).
//   - `label` : declared on the widget so its caption TRAVELS with it (the
//               owner's "self-documenting labels" ask) rather than living as
//               loose sibling DOM in whichever page hosts it.

export function defineWidget(def) {
  if (!def || typeof def.mount !== 'function') throw new Error('widget needs a mount(ctx) function');
  return def;
}

// Mount a layout list of widgets into `container` and return a host with
// `render(state)` / `destroy()`. Each widget gets its own titled card.
export function mountWidgets(container, widgets, ctx) {
  const mounted = widgets.map((w) => {
    const card = document.createElement('section');
    card.className = 'widget panel';
    if (w.accent) card.style.setProperty('--accent', w.accent);
    if (w.label) {
      const h = document.createElement('h2');
      h.className = 'widget-label';
      h.textContent = w.label;
      card.appendChild(h);
    }
    const body = document.createElement('div');
    body.className = 'widget-body';
    card.appendChild(body);
    // Small self-documenting hint line under the widget body (optional).
    if (w.hint) {
      const hint = document.createElement('div');
      hint.className = 'widget-hint';
      hint.textContent = w.hint;
      card.appendChild(hint);
    }
    container.appendChild(card);
    const inst = w.mount({ ...ctx, root: body, card }) || {};
    return { w, inst };
  });
  return {
    render(state) {
      for (const m of mounted) { try { m.inst.render && m.inst.render(state); } catch (e) { /* one widget's failure never blanks the console */ console.error('widget render failed:', m.w.id, e); } }
    },
    destroy() { for (const m of mounted) m.inst.destroy && m.inst.destroy(); },
  };
}

// --- Small DOM helpers shared by widgets (keeps each widget's mount terse) ---
export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
