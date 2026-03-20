import { StudioGallery } from "../studios/StudioGallery";
import { appConfig } from "../studios/app-config";

export function AppStudio() {
  return <StudioGallery config={appConfig} />;
}
