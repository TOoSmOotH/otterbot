import type { EnvironmentAsset } from "@otterbot/shared";

interface CategoryDef {
  id: string;
  label: string;
  pattern: RegExp;
}

const CATEGORIES: CategoryDef[] = [
  { id: "walls", label: "Walls", pattern: /^Wall/ },
  { id: "floors", label: "Floors", pattern: /^Floor/ },
  { id: "doors", label: "Doors", pattern: /^Door/ },
  { id: "building", label: "Building Blocks", pattern: /^Primitive_/ },
  { id: "structural", label: "Structural", pattern: /^Pillar/ },
  { id: "furniture", label: "Furniture", pattern: /^(Pallet|table)/i },
  { id: "storage", label: "Storage", pattern: /^(Barrel|Box|Can)/ },
];

export interface CategorizedAssets {
  id: string;
  label: string;
  assets: EnvironmentAsset[];
}

export function categorizeAssets(assets: EnvironmentAsset[]): CategorizedAssets[] {
  const buckets = new Map<string, EnvironmentAsset[]>();
  const decorative: EnvironmentAsset[] = [];

  for (const cat of CATEGORIES) {
    buckets.set(cat.id, []);
  }

  for (const asset of assets) {
    let matched = false;
    for (const cat of CATEGORIES) {
      if (cat.pattern.test(asset.id)) {
        buckets.get(cat.id)!.push(asset);
        matched = true;
        break;
      }
    }
    if (!matched) {
      decorative.push(asset);
    }
  }

  const result: CategorizedAssets[] = [];
  for (const cat of CATEGORIES) {
    const items = buckets.get(cat.id)!;
    if (items.length > 0) {
      result.push({ id: cat.id, label: cat.label, assets: items });
    }
  }
  if (decorative.length > 0) {
    result.push({ id: "decorative", label: "Decorative", assets: decorative });
  }

  return result;
}
