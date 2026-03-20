import { StudioGallery } from "../studios/StudioGallery";
import { gameConfig } from "../studios/game-config";

export function GameStudio() {
  return <StudioGallery config={gameConfig} />;
}
