import { StudioGallery } from "../studios/StudioGallery";
import { videoConfig } from "../studios/video-config";

export function VideoStudio() {
  return <StudioGallery config={videoConfig} />;
}
