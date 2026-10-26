import { type ChainFamily, NETWORKS, type NetworkId } from "@minthouse/shared";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChainDot } from "@/components/ui/ChainBadge";
import { cn } from "@/lib/cn";

type ExploreToolbarProps = {
  query: string | undefined;
  network: NetworkId | undefined;
  networks: readonly NetworkId[];
  onSearch: (query: string | undefined) => void;
  onNetworkChange: (network: NetworkId | undefined) => void;
};

export function ExploreToolbar({ query, network, networks, onSearch, onNetworkChange }: ExploreToolbarProps) {
  const { t } = useTranslation("explore");

  const submitSearch = (formData: FormData) => {
    const value = formData.get("q");
    const trimmed = typeof value === "string" ? value.trim() : "";
    onSearch(trimmed === "" ? undefined : trimmed);
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <form role="search" action={submitSearch} className="relative w-full md:max-w-sm">
        <label htmlFor="token-search" className="sr-only">
          {t("search.label")}
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <input
          // Remount when the URL changes so the field always mirrors the active search.
          key={query ?? ""}
          id="token-search"
          name="q"
          type="search"
          defaultValue={query}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("search.placeholder")}
          className="h-11 w-full rounded-lg border border-line-strong bg-surface pr-20 pl-9 text-sm placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
          {query ? (
            <button
              type="button"
              onClick={() => {
                onSearch(undefined);
              }}
              aria-label={t("search.clear")}
              className="inline-flex size-8 items-center justify-center rounded-md text-fg-subtle hover:bg-sunken hover:text-fg"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          <button type="submit" className="h-8 rounded-md px-2.5 text-sm font-medium text-fg-muted hover:bg-sunken hover:text-fg">
            {t("search.submit")}
          </button>
        </div>
      </form>

      <fieldset className="min-w-0">
        <legend className="sr-only">{t("filters.label")}</legend>
        <div className="flex flex-wrap gap-1.5">
          <FilterOption checked={network === undefined} label={t("filters.all")} onSelect={() => { onNetworkChange(undefined); }} />
          {networks.map((id) => (
            <FilterOption
              key={id}
              checked={network === id}
              label={NETWORKS[id].label}
              family={NETWORKS[id].family}
              onSelect={() => {
                onNetworkChange(id);
              }}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

type FilterOptionProps = {
  checked: boolean;
  label: string;
  family?: ChainFamily;
  onSelect: () => void;
};

function FilterOption({ checked, label, family, onSelect }: FilterOptionProps) {
  return (
    <label
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm transition-colors duration-150",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        checked ? "border-fg bg-fg text-canvas" : "border-line-strong bg-surface text-fg-muted hover:text-fg",
      )}
    >
      <input type="radio" name="network-filter" value={label} checked={checked} onChange={onSelect} className="size-3.5 accent-accent" />
      {family ? <ChainDot family={family} /> : null}
      {label}
    </label>
  );
}
