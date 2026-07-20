"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

// A free-text input with a lightweight, self-contained suggestions dropdown -
// used instead of the native <input list> + <datalist> combo, which has
// spotty/inconsistent support (notably on mobile Safari) and doesn't
// reliably show Hebrew suggestions everywhere. Typing a value not in
// `suggestions` is always allowed and never blocked; clicking a suggestion
// just fills the input, it doesn't "select" anything exclusive. Shared by
// HorseFeedingSection (hay/concentrate types) and the riding lesson note
// editor (lesson topic, session horse).
// forwardRef exposes only .focus() (via useImperativeHandle) so a caller can
// drive focus into this input without reaching into its internal DOM
// structure - existing callers that don't pass a ref are unaffected.
//
// onCommit (optional) signals an EXPLICIT commit gesture - distinct from the
// per-keystroke onChange - so a caller that needs to react only when the user
// deliberately settles on a value (not while typing) can do so: it fires when a
// suggestion is clicked ("suggestion"), when Enter is pressed ("enter"), and on
// blur ("blur"). onChange still fires for every keystroke AND immediately before
// a suggestion-click commit. Callers that don't pass onCommit (the pre-existing
// hay/concentrate and lesson-note editors) are entirely unaffected.
export const SuggestInput = forwardRef<{ focus: () => void }, {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  onCommit?: (value: string, source: "suggestion" | "enter" | "blur") => void;
}>(function SuggestInput({ value, onChange, suggestions, placeholder, onCommit }, forwardedRef) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(forwardedRef, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q
      ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      : suggestions;
    return list.slice(0, 8);
  }, [value, suggestions]);

  return (
    <div ref={containerRef} className="relative min-w-0 w-full">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(e) => {
          // Only intercept Enter for a commit-consuming caller. Without onCommit
          // (HorseFeedingSection, the lesson-note editor) Enter is left ENTIRELY
          // untouched, preserving the consumer's implicit form submit-on-Enter.
          if (e.key === "Enter" && onCommit) {
            e.preventDefault();
            setIsOpen(false);
            onCommit(value, "enter");
          }
        }}
        onBlur={() => onCommit?.(value, "blur")}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm"
      />
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(s);
                setIsOpen(false);
                onCommit?.(s, "suggestion");
              }}
              className="block w-full px-3 py-2 text-right text-sm hover:bg-muted"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
