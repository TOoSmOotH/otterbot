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
