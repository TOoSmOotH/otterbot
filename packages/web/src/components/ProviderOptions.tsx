import type { ProviderInfo } from "@otterbot/shared";

/**
 * `<option>` elements for a provider `<select>`, derived from the provider
 * catalog. Keeps the current value selectable even while the catalog loads or
 * if it names a provider no longer in the catalog.
 */
export function ProviderOptions({ list, current }: { list: ProviderInfo[]; current: string }) {
  return (
    <>
      {current && !list.some((p) => p.id === current) && (
        <option value={current}>{current}</option>
      )}
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </>
  );
}
