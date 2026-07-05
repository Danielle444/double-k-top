"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
}

// A small, dependency-free combobox: a single text input that shows the
// selected option's label when closed, and a live-filtered search box when
// open. Always controlled (value/onChange), matching the existing native
// <select> usages it replaces one-for-one - the caller still owns the
// selected value and still includes an empty-value option (e.g.
// { value: "", label: "הכל" }) if a clearable/"all" choice is wanted, the
// same way the native selects it replaces already do.
export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "בחר...",
  searchPlaceholder = "הקלידו לחיפוש...",
  emptyMessage = "לא נמצאו תוצאות",
  disabled = false,
  className = "",
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  const filteredOptions = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, searchText]);

  useEffect(() => {
    const firstEnabledIndex = filteredOptions.findIndex((o) => !o.disabled);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightedIndex(firstEnabledIndex === -1 ? 0 : firstEnabledIndex);
  }, [filteredOptions]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchText("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function openDropdown() {
    if (disabled) return;
    setIsOpen(true);
    setSearchText("");
  }

  function closeDropdown() {
    setIsOpen(false);
    setSearchText("");
  }

  function selectOption(option: SearchableSelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    closeDropdown();
  }

  function moveHighlight(direction: 1 | -1) {
    if (filteredOptions.length === 0) return;
    setHighlightedIndex((prev) => {
      let next = prev;
      for (let i = 0; i < filteredOptions.length; i++) {
        next = (next + direction + filteredOptions.length) % filteredOptions.length;
        if (!filteredOptions[next]?.disabled) break;
      }
      return next;
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option) selectOption(option);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown();
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-controls={listboxId}
        value={isOpen ? searchText : selectedLabel}
        onChange={(e) => {
          if (!isOpen) setIsOpen(true);
          setSearchText(e.target.value);
        }}
        onFocus={openDropdown}
        onBlur={closeDropdown}
        onKeyDown={handleKeyDown}
        placeholder={isOpen ? searchPlaceholder : placeholder}
        disabled={disabled}
        autoComplete="off"
        className={`w-full rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50 ${className}`}
      />
      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
        >
          {filteredOptions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</li>
          ) : (
            filteredOptions.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled}
                // mousedown (not click) fires before the input's onBlur, so
                // the selection registers before the click-outside/blur
                // close logic would otherwise dismiss the dropdown first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(option);
                }}
                onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                className={`px-3 py-2 text-sm ${
                  option.disabled
                    ? "cursor-not-allowed text-muted-foreground opacity-60"
                    : `cursor-pointer ${
                        index === highlightedIndex
                          ? "bg-secondary text-secondary-foreground"
                          : "text-card-foreground hover:bg-muted"
                      }`
                }`}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
