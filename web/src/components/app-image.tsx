import type { ImgHTMLAttributes } from "react";

type AppImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  unoptimized?: boolean;
};

export function AppImage({ unoptimized: _unoptimized, ...props }: AppImageProps) {
  return <img {...props} />;
}
