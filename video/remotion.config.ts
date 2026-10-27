import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);

// Les compositions vivent à la racine du site (../remotion-compositions.tsx) :
// on indique à webpack de résoudre `remotion` et `react` depuis video/node_modules.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    modules: [path.join(process.cwd(), "node_modules"), "node_modules"],
  },
}));
