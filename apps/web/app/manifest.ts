import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const appName = "Schedule Solver";
  const appShortName = "Schedule";
  const appDescription = "Surgery center scheduling workspace";
  const themeColor = "#0f766e";
  const backgroundColor = "#f8fafc";

  return {
    name: appName,
    short_name: appShortName,
    description: appDescription,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: backgroundColor,
    theme_color: themeColor,
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/maskable-icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
