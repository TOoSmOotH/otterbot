export interface ModelPack {
  id: string;
  name: string;
  characterUrl: string;
  thumbnailUrl: string;
  animations: {
    idle: string;
    action: string;
  };
}

/** Map of gear mesh names to visibility. Missing key = visible, `false` = hidden. */
export type GearConfig = Record<string, boolean>;
