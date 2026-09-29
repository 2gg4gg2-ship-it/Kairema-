import { ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * One catalog entry, as the server normalized it from the provider's live response. `id` is the
 * provider's real model id and is what a request must send; `displayName` is the same name
 * without the author prefix, and `isFree` comes from the catalog's own pricing.
 */
export type ModelMenuOption = { id: string; name?: string | null; displayName?: string | null; isFree?: boolean; acceptsImage?: boolean };

export function modelMenuTitle(model: ModelMenuOption) {
  return model.displayName?.trim() || model.name?.trim() || model.id;
}

/**
 * Free is whatever the provider's own catalog priced at zero. The client never guesses it from
 * a model name, and it never keeps a list of "known free" models of its own.
 */
function isFreeModel(model: ModelMenuOption) {
  return model.isFree === true;
}

type MenuPlacement = { top: number; left: number; width: number; maxHeight: number };

/**
 * Places a menu panel next to its trigger and closes it the way a menu should behave: Escape or
 * a click outside. The panel is portaled to the body with fixed coordinates, so the control keeps
 * its own clipping and the menu can never widen the page, be cut off by its container or grow past
 * the viewport.
 */
export function useAnchoredMenu(open: boolean, triggerRef: React.RefObject<HTMLElement | null>, panelRef: React.RefObject<HTMLElement | null>, setOpen: (value: boolean) => void) {
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
      const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
      const width = Math.min(360, Math.max(220, viewportWidth - 24));
      const left = Math.min(Math.max(8, rect.right - width), Math.max(8, viewportWidth - width - 8));
      const below = viewportHeight - rect.bottom - 16;
      const above = rect.top - 16;
      // Near the bottom of the viewport the panel opens upward instead of off-screen.
      const flipUp = below < 220 && above > below;
      const maxHeight = Math.max(160, Math.min(340, flipUp ? above : below));
      setPlacement({ top: flipUp ? Math.max(8, rect.top - 6 - maxHeight) : rect.bottom + 6, left, width, maxHeight });
    };
    place();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, triggerRef, panelRef, setOpen]);
  return placement;
}

export function menuPanelStyle(placement: MenuPlacement | null) {
  return placement ? { top: `${placement.top}px`, left: `${placement.left}px`, width: `${placement.width}px`, maxHeight: `${placement.maxHeight}px` } : undefined;
}

export type ModelMenuLabels = { search: string; free: string; paid: string; empty: string; badge: string; loading: string; placeholder: string };

/**
 * The one model picker: a searchable, grouped, dark panel over a provider's own live catalog.
 *
 * It is shared by the chat header and by the provider settings so the two cannot drift apart. It
 * never lists a model the client invented, the ids it hands back are the provider's real ids, and
 * `triggerClassName` is the only thing that differs between the two call sites.
 */
export function ModelMenu({ value, models, disabled, ariaLabel, labels, placeholder, onSelect, triggerClassName, triggerTextClassName }: {
  value: string;
  models: readonly ModelMenuOption[];
  disabled: boolean;
  ariaLabel: string;
  labels: ModelMenuLabels;
  /** Shown on the trigger while the catalog has not been read yet. */
  placeholder?: string;
  onSelect: (id: string) => void;
  triggerClassName?: string;
  triggerTextClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const placement = useAnchoredMenu(open, triggerRef, panelRef, setOpen);

  const selected = models.find((model) => model.id === value) ?? null;
  const term = query.trim().toLowerCase();
  // Search matches what the user reads and what the request needs: the display name and the id.
  const matched = term ? models.filter((model) => model.id.toLowerCase().includes(term) || modelMenuTitle(model).toLowerCase().includes(term)) : models;
  // With no search the saved model always stays in the list, even when the provider's catalog no
  // longer offers it; while searching, only real matches show so "no models found" is truthful.
  const visible = term ? matched : (matched.some((model) => model.id === value) ? matched : [...matched, { id: value, name: selected?.name ?? "", displayName: selected?.displayName ?? null, isFree: selected?.isFree }]);
  const freeModels = visible.filter(isFreeModel);
  const paidModels = visible.filter((model) => !isFreeModel(model));

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const triggerText = selected ? modelMenuTitle(selected) : value;

  const renderGroup = (title: string, items: readonly ModelMenuOption[]) => items.length === 0 ? null : (
    <div className="kairema-model-menu-group" role="group" aria-label={title} key={title}>
      <div className="kairema-model-menu-group-title">{title}</div>
      {items.map((model) => {
        const isActive = model.id === value;
        const title2 = modelMenuTitle(model);
        return <button
          key={model.id}
          type="button"
          role="option"
          aria-selected={isActive}
          title={model.id}
          className={`kairema-model-menu-item ${isActive ? "kairema-model-menu-item-active" : ""}`}
          onClick={() => { setOpen(false); onSelect(model.id); }}>
          <span className="kairema-model-menu-item-copy">
            <span className="kairema-model-menu-item-title">{title2}</span>
            {title2 !== model.id && <span className="kairema-model-menu-item-id">{model.id}</span>}
          </span>
          {isFreeModel(model) && <span className="kairema-model-menu-badge">{labels.badge}</span>}
        </button>;
      })}
    </div>
  );

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={triggerClassName ?? "kairema-binding-select kairema-binding-trigger"}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => setOpen((value) => !value)}>
      {/* The model alone: the provider is chosen in its own menu, so its name is not repeated. */}
      <span className={triggerTextClassName ?? "kairema-binding-trigger-text"}>{selected ? triggerText : (placeholder ?? triggerText)}</span>
      <ChevronDown className="kairema-model-menu-caret" aria-hidden="true" />
    </button>
    {open && typeof document !== "undefined" && createPortal(
      <div
        ref={panelRef}
        className="kairema-model-menu"
        style={menuPanelStyle(placement)}>
        <div className="kairema-model-menu-search">
          <Search className="kairema-model-menu-search-icon" aria-hidden="true" />
          <input
            className="kairema-model-menu-search-input"
            type="search"
            value={query}
            autoFocus
            placeholder={labels.search}
            aria-label={labels.search}
            onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="kairema-model-menu-list" role="listbox" aria-label={ariaLabel}>
          {renderGroup(labels.free, freeModels)}
          {renderGroup(labels.paid, paidModels)}
          {visible.length === 0 && <p className="kairema-model-menu-empty">{labels.empty}</p>}
        </div>
      </div>,
      document.body)}
  </>;
}

export const MODEL_MENU_LABELS: Record<"ru" | "en", ModelMenuLabels> = {
  ru: { search: "Поиск моделей", free: "Free", paid: "Paid", empty: "Ничего не найдено", badge: "Free", loading: "Загружаем модели…", placeholder: "Модель не выбрана" },
  en: { search: "Search models", free: "Free", paid: "Paid", empty: "No models found", badge: "Free", loading: "Loading models…", placeholder: "No model selected" },
};
